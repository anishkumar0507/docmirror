'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for what a user is entitled to.
//
// Every gate (report generation, PDF/report unlock, Monitor features) resolves
// through getEntitlement(userId) — no duplicate inline checks, no reading
// paid_reports in one place and subscriptions in another.
//
// The authoritative "is this an active subscriber" signal is `profiles.plan`,
// exactly what the Settings page reads (the one gate that already works).
// profiles.plan is materialised from the subscription on activation
// (verify-subscription-payment.js + webhook subscription.activated), so it is the
// same source of truth end to end.
//
// Rules:
//   monitor (active subscription) → unlimited generation + full PDF + Monitor
//                                   features. Never a payment prompt.
//   audit   (one-time $19 buyer)  → download access to their purchased report(s);
//                                   NOT unlimited generation.
//   free                          → existing paywall.
//
// ── Phase 2 (org-level) ──────────────────────────────────────────────────────
// The plan fields (plan/hasMonitorFeatures/canGenerateReport/canDownloadPdf/tier)
// are UNCHANGED and still come from profiles.plan. We additionally resolve the
// user's organization to expose profile-limit info (orgId/orgType/profileLimit/
// profilesUsed/canCreateProfile/isMultiProfile). We deliberately DO NOT read
// organizations.plan — plan lives on profiles.plan (written in 6 places); reading
// a second, un-written plan source would reintroduce the split-source drift bug.
// Migrating plan onto organizations is Phase 3.
//
// userId MUST come from a server-verified auth token. Never pass a user id,
// email, plan or tier from a request body/query into here.
// ─────────────────────────────────────────────────────────────────────────────

const { getSupabaseClient } = require('./supabase-client');

const NONE = Object.freeze({
  tier: 'free',
  canGenerateReport: false,
  canDownloadPdf: false,
  hasMonitorFeatures: false,
  reason: 'anonymous',
});

// Org fields when the user has no resolvable org (or anonymous). profileLimit
// defaults to 1 and canCreateProfile is false — a user with no org cannot create
// additional doctor profiles.
const ORG_NONE = Object.freeze({
  orgId: null,
  orgType: null,
  profileLimit: 1,
  profilesUsed: 0,
  canCreateProfile: false,
  isMultiProfile: false,
});

// Merge the (unchanged) plan entitlement with the org info into the public shape.
// `plan` is exposed as an explicit alias of the effective tier (additive; the
// existing `tier` field is kept untouched).
function finalize(base, org) {
  return { ...base, plan: base.tier, ...org };
}

// ── Plan entitlement — UNCHANGED behaviour, reads profiles.plan only ─────────
async function resolvePlanEntitlement(supabase, userId) {
  // profiles.plan — same source the working Settings gate uses.
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    // Fail CLOSED — never grant access on a lookup error.
    console.warn('[entitlements] profile lookup error userId=%s: %s', userId, error.message);
    return { ...NONE, reason: 'lookup_error' };
  }

  const plan = (profile && profile.plan) || 'free';

  if (plan === 'monitor') {
    return {
      tier: 'monitor',
      canGenerateReport: true,
      canDownloadPdf: true,
      hasMonitorFeatures: true,
      reason: 'active_subscription',
    };
  }

  if (plan === 'audit') {
    return {
      tier: 'audit',
      canGenerateReport: false,
      canDownloadPdf: true,
      hasMonitorFeatures: false,
      reason: 'one_time_purchase',
    };
  }

  // plan === 'free' — but a paid report may exist that hasn't upgraded the plan yet
  // (anonymous $19 buy linked by user_id but plan still 'free'). Treat as audit tier.
  const { data: paid } = await supabase
    .from('paid_reports')
    .select('id')
    .eq('user_id', userId)
    .in('status', ['generating', 'generated', 'delivered'])
    .limit(1);

  if (paid && paid.length) {
    return {
      tier: 'audit',
      canGenerateReport: false,
      canDownloadPdf: true,
      hasMonitorFeatures: false,
      reason: 'one_time_purchase',
    };
  }

  return { tier: 'free', canGenerateReport: false, canDownloadPdf: false, hasMonitorFeatures: false, reason: 'free' };
}

// ── Org info — NEW, additive. Never affects plan/access. Fails soft to ORG_NONE.
//    Reads org_members → organizations(id,type,profile_limit) → count(doctor_profiles).
//    organizations.plan is intentionally NOT read (see header).
async function resolveOrgInfo(supabase, userId) {
  try {
    const { data: mems, error: mErr } = await supabase
      .from('org_members')
      .select('org_id, role')
      .eq('user_id', userId);
    if (mErr || !mems || !mems.length) return { ...ORG_NONE };

    // Prefer the org the user owns (their solo org today); else the first membership.
    const chosen = mems.find(m => m.role === 'owner') || mems[0];
    const orgId = chosen.org_id;
    if (!orgId) return { ...ORG_NONE };

    const { data: org, error: oErr } = await supabase
      .from('organizations')
      .select('id, type, profile_limit')       // NOTE: plan deliberately not selected
      .eq('id', orgId)
      .maybeSingle();
    if (oErr || !org) return { ...ORG_NONE };

    const profileLimit = Number.isFinite(org.profile_limit) ? org.profile_limit : 1;

    const { count, error: cErr } = await supabase
      .from('doctor_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'active');
    const profilesUsed = cErr ? 0 : (count || 0);

    return {
      orgId,
      orgType: org.type || null,
      profileLimit,
      profilesUsed,
      canCreateProfile: profilesUsed < profileLimit,
      isMultiProfile: profileLimit > 1,
    };
  } catch (e) {
    // Org info is never an access gate — degrade to ORG_NONE, never throw.
    console.warn('[entitlements] org resolve warn userId=%s: %s', userId, e.message);
    return { ...ORG_NONE };
  }
}

/**
 * @param {string|null} userId  server-verified auth user id (never client-supplied)
 * @returns {Promise<{
 *   plan, tier, canGenerateReport, canDownloadPdf, hasMonitorFeatures, reason,
 *   orgId, orgType, profileLimit, profilesUsed, canCreateProfile, isMultiProfile
 * }>}
 */
async function getEntitlement(userId) {
  if (!userId) return finalize({ ...NONE, reason: 'anonymous' }, ORG_NONE);

  const supabase = getSupabaseClient();
  if (!supabase) return finalize({ ...NONE, reason: 'no_db' }, ORG_NONE);

  // Plan (unchanged) and org info are resolved independently; org info never
  // changes the plan/access fields.
  const base = await resolvePlanEntitlement(supabase, userId);
  const org  = await resolveOrgInfo(supabase, userId);
  return finalize(base, org);
}

module.exports = { getEntitlement };
