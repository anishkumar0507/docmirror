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

/**
 * @param {string|null} userId  server-verified auth user id (never client-supplied)
 * @returns {Promise<{tier,canGenerateReport,canDownloadPdf,hasMonitorFeatures,reason}>}
 */
async function getEntitlement(userId) {
  if (!userId) return { ...NONE, reason: 'anonymous' };

  const supabase = getSupabaseClient();
  if (!supabase) return { ...NONE, reason: 'no_db' };

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

module.exports = { getEntitlement };
