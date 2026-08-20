'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// org-resolve — map a user to the org + doctor_profile to stamp onto a NEW audit.
//
// Kept separate from lib/entitlements.js on purpose:
//   • getEntitlement() does NOT expose a doctor_profile_id (only a count), so it
//     cannot supply what the write path needs.
//   • getEntitlement() also reads profiles.plan + paid_reports — work the write
//     path doesn't need on every insert.
//   • A dedicated helper keeps reports-store / paid-reports free of any dependency
//     on the entitlement layer (no import cycle risk).
//
// Contract: BEST-EFFORT. Never throws. Returns { orgId:null, doctorProfileId:null }
// on anonymous / no org / any error, so report generation is NEVER blocked by org
// resolution — one org bug must not stop every audit from being written.
// ─────────────────────────────────────────────────────────────────────────────

const { getSupabaseClient } = require('./supabase-client');

const NONE = { orgId: null, doctorProfileId: null };

/**
 * @param {string|null} userId    server-side user id (from a verified token upstream)
 * @param {object}      [supabase] optional existing client (callers pass theirs)
 * @returns {Promise<{orgId:string|null, doctorProfileId:string|null}>}
 */
async function resolveOrgForUser(userId, supabase) {
  if (!userId) return { ...NONE };
  try {
    const db = supabase || getSupabaseClient();
    if (!db) return { ...NONE };

    // Resolve the user's org (prefer the one they own — their solo org today).
    const { data: mems, error: mErr } = await db
      .from('org_members').select('org_id, role').eq('user_id', userId);
    if (mErr || !mems || !mems.length) return { ...NONE };
    const chosen = mems.find(m => m.role === 'owner') || mems[0];
    const orgId = chosen.org_id || null;
    if (!orgId) return { ...NONE };

    // Active doctor_profiles in this org. Solo → exactly one → stamp it.
    // Multiple → leave doctorProfileId null (which profile an audit belongs to is
    // a multi-profile-selection decision for Phase 3). limit(2) is enough to tell
    // "exactly one" from "more than one".
    const { data: profs, error: pErr } = await db
      .from('doctor_profiles').select('id')
      .eq('org_id', orgId).eq('status', 'active').limit(2);
    if (pErr || !profs) return { orgId, doctorProfileId: null };

    const doctorProfileId = (profs.length === 1) ? profs[0].id : null;
    return { orgId, doctorProfileId };
  } catch (e) {
    console.warn('[org-resolve] warn userId=%s: %s', userId, e && e.message);
    return { ...NONE };
  }
}

module.exports = { resolveOrgForUser };
