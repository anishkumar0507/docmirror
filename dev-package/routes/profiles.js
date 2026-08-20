'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Doctor-profile CRUD for the multi-doctor org model (Phase 3B).
//
// SECURITY (every handler):
//   • Mounted behind requireAuth (server.js) → req.user is a verified token user.
//   • The org is ALWAYS resolved server-side from req.user.id — never taken from
//     the request body/query. A client cannot act on another org's profiles:
//       - list/create scope to the caller's resolved org_id.
//       - update/archive put `.eq('org_id', <caller org>)` INSIDE the write, so a
//         row in another org simply doesn't match → 404 (no cross-org access,
//         and existence of other orgs' profiles is never revealed).
//   • create is gated by getEntitlement().canCreateProfile AND a DB-level trigger
//     (migration 025) that serialises on the org row — two parallel creates can
//     never both slip past the limit (app-level count alone is not enough).
// ─────────────────────────────────────────────────────────────────────────────

require('../lib/env');
const { getSupabaseClient } = require('../lib/supabase-client');
const { getEntitlement } = require('../lib/entitlements');
const { resolveOrgForUser } = require('../lib/org-resolve');

const EDITABLE_FIELDS = ['name', 'website', 'speciality', 'city'];

// Keep only editable fields; trim strings; allow explicit null to clear a value.
function pickEditable(body) {
  const out = {};
  for (const k of EDITABLE_FIELDS) {
    if (!body || body[k] === undefined) continue;
    out[k] = body[k] === null ? null : String(body[k]).trim();
  }
  return out;
}

// The DB limit trigger raises 'PROFILE_LIMIT_REACHED' when a create would exceed
// the org's profile_limit (the race-safe backstop behind the app-level check).
function isLimitError(err) {
  return `${(err && err.message) || ''}`.includes('PROFILE_LIMIT_REACHED');
}

// POST /api/profiles  { name, website?, speciality?, city? }
async function create(req, res) {
  const userId = req.user.id;
  const ent = await getEntitlement(userId);           // orgId + limit both server-derived
  if (!ent.orgId) {
    return res.status(403).json({ error: 'No organization is associated with this account' });
  }
  if (!ent.canCreateProfile) {
    return res.status(403).json({
      error: `Profile limit reached (${ent.profilesUsed}/${ent.profileLimit}). Archive a profile or upgrade your plan to add another.`,
      code: 'PROFILE_LIMIT_REACHED',
      profileLimit: ent.profileLimit,
      profilesUsed: ent.profilesUsed,
    });
  }

  const fields = pickEditable(req.body);
  if (!fields.name) return res.status(400).json({ error: 'name is required' });

  const supabase = getSupabaseClient();
  // org_id comes from the SERVER-resolved entitlement, never from the client.
  const insertRow = { org_id: ent.orgId, status: 'active', ...fields };
  const { data, error } = await supabase
    .from('doctor_profiles').insert(insertRow).select('*').single();

  if (error) {
    if (isLimitError(error)) {
      // Lost the race after the app-level check — DB trigger enforced the cap.
      return res.status(403).json({ error: 'Profile limit reached', code: 'PROFILE_LIMIT_REACHED' });
    }
    console.error('[profiles] create error:', error.message);
    return res.status(500).json({ error: 'Could not create profile' });
  }
  return res.status(201).json({ ok: true, profile: data });
}

// GET /api/profiles → active profiles in the caller's org
async function list(req, res) {
  const { orgId } = await resolveOrgForUser(req.user.id);
  if (!orgId) return res.json({ profiles: [] });

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('doctor_profiles')
    .select('id, org_id, name, website, speciality, city, status, created_at')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[profiles] list error:', error.message);
    return res.status(500).json({ error: 'Could not load profiles' });
  }
  return res.json({ profiles: data || [] });
}

// PATCH /api/profiles/:id  { name?, website?, speciality?, city? }
async function update(req, res) {
  const { orgId } = await resolveOrgForUser(req.user.id);
  if (!orgId) return res.status(404).json({ error: 'Profile not found' });

  const fields = pickEditable(req.body);
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'No editable fields provided (name, website, speciality, city)' });
  }
  if ('name' in fields && !fields.name) {
    return res.status(400).json({ error: 'name cannot be empty' });
  }

  const supabase = getSupabaseClient();
  // Ownership is enforced IN the query: `.eq('org_id', orgId)` means a profile in
  // any other org simply won't match. No row → 404 (never reveals other orgs).
  const { data, error } = await supabase
    .from('doctor_profiles')
    .update(fields)
    .eq('id', req.params.id)
    .eq('org_id', orgId)
    .select('*');

  if (error) {
    console.error('[profiles] update error:', error.message);
    return res.status(500).json({ error: 'Could not update profile' });
  }
  if (!data || !data.length) return res.status(404).json({ error: 'Profile not found' });
  return res.json({ ok: true, profile: data[0] });
}

// DELETE /api/profiles/:id → archive (status='archived'); row is NEVER deleted.
async function archive(req, res) {
  const { orgId } = await resolveOrgForUser(req.user.id);
  if (!orgId) return res.status(404).json({ error: 'Profile not found' });

  const supabase = getSupabaseClient();
  // Same in-query ownership guard; only an active row in the caller's org flips to
  // archived. Archiving frees a slot (profilesUsed counts status='active' only).
  const { data, error } = await supabase
    .from('doctor_profiles')
    .update({ status: 'archived' })
    .eq('id', req.params.id)
    .eq('org_id', orgId)
    .eq('status', 'active')
    .select('id');

  if (error) {
    console.error('[profiles] archive error:', error.message);
    return res.status(500).json({ error: 'Could not archive profile' });
  }
  if (!data || !data.length) return res.status(404).json({ error: 'Profile not found or already archived' });
  return res.json({ ok: true, archived: data[0].id });
}

module.exports = { create, list, update, archive };
