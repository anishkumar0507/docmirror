'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Shared authenticated-subscription checkout + verify — the ONE place both the
// org (agency) plan and the single-doctor Monitor plan create and verify a
// Razorpay subscription. Modelled directly on routes/agency.js's proven-safe
// shape (see that file's header comment for why), generalised over tierId/
// region instead of being agency-only:
//
//   • The account must exist and be LOGGED IN before checkout. Nothing here
//     ever creates an account, resets a password, or trusts an email from the
//     request body — the only identity is req.user.id from a verified Bearer
//     token, checked at the call site.
//   • checkout binds the subscription to the caller's user id via Razorpay
//     notes, written server-side and read back FROM Razorpay at verify — a
//     browser cannot forge them or claim someone else's subscription.
//   • verify is gated on facts read from Razorpay AFTER the HMAC check, never
//     on the browser's say-so: status, the PLAN's actual amount/currency, and
//     that the plan belongs to the tier the caller says they are verifying.
//
// This module does NOT touch the database — createTierSubscription/
// verifyTierSubscription return data; the caller (routes/agency.js,
// routes/checkout-monitor.js, routes/webhook-razorpay.js) does its own
// idempotent provisioning, because what gets provisioned (an org vs a solo
// profile upgrade) differs per product.
// ─────────────────────────────────────────────────────────────────────────────

const pricing   = require('../pricing');
const payments  = require('./index');
const planGuard = require('./plan-guard');

const REGIONS = ['IN', 'US', 'INTL'];
const ACCEPTED_STATUSES = ['active', 'authenticated', 'charged'];

/**
 * Create a Razorpay subscription for tierId in region, bound to userId.
 * Throws (caller catches) on missing config; returns { ok:false, ... } on a
 * plan-guard rejection (price/mode mismatch — never silently bills the wrong
 * amount).
 */
async function createTierSubscription({ region, country, tierId, userId, email, label }) {
  const tier = pricing.getTier(region, tierId);
  if (tier.type !== 'subscription') {
    return { ok: false, reason: 'not_a_subscription' };
  }
  if (!tier.planId) {
    return { ok: false, reason: 'plan_not_configured', planIdEnv: tier.planIdEnv };
  }

  const check = await planGuard.verifyPlan(tier.planId, tier.amountMinor, tier.currency, label || `checkout-${tierId}`);
  if (!check.ok) {
    return { ok: false, reason: check.reason };
  }

  const sub = await payments.get('razorpay').createSubscription({
    email,
    auditId: null,
    regionTier: region,
    country: country || '',
    planId: tier.planId,
    expectedUnits: tier.amountMinor,
    expectedCurrency: tier.currency,
    // Binds the subscription to this user AND this exact product. Read back
    // from Razorpay (not trusted from the request) at verify time.
    planKind: tierId,
    userId,
  });

  return { ok: true, subscriptionId: sub.subscriptionId, shortUrl: sub.shortUrl, tier };
}

/**
 * Verify a subscription payment for expectedTierId, bound to userId.
 * expectedTierId is chosen by the ROUTE (never read from the request body) —
 * routes/checkout-monitor.js always passes 'single_doctor_monthly',
 * routes/agency.js always passes 'org_monthly'. This is the same shape as
 * agency.js checking `sub.plan_id !== planId()` today, just table-driven
 * across all three regions instead of one hardcoded env var.
 *
 * @returns {Promise<{ok:true, tier, subscriptionId}|{ok:false, reason, failed?}>}
 */
async function verifyTierSubscription({ expectedTierId, userId, subscriptionId, paymentId, signature }) {
  const rz = payments.get('razorpay');

  // ── 0. HMAC over `${paymentId}|${subscriptionId}` ──────────────────────────
  const sig = await rz.verifySubscription({ subscriptionId, paymentId, signature });
  if (!sig.ok) return { ok: false, reason: sig.reason };

  // ── Read the truth from Razorpay. Nothing below trusts the request body. ───
  let sub, plan;
  try {
    sub  = await rz.fetchSubscription(subscriptionId);
    plan = await rz.fetchPlan(sub.plan_id);
  } catch (e) {
    return { ok: false, reason: 'razorpay_unreachable', detail: (e.error && e.error.description) || e.message };
  }

  // ── Binding: this subscription must be the one WE created for THIS user ────
  const notedUser = sub.notes && sub.notes.userId;
  if (notedUser && notedUser !== userId) {
    return { ok: false, reason: 'user_mismatch' };
  }

  return matchAndCheckTier({ expectedTierId, sub, plan });
}

/**
 * The plan-matching + three-factor check, WITHOUT the per-call HMAC/binding
 * steps above — shared with routes/webhook-razorpay.js, which already has its
 * OWN signature verification (over the whole webhook payload, not a single
 * subscription) and does binding via notes.userId itself before calling this.
 *
 * Matches Razorpay's own plan_id against our tier table across ALL regions,
 * rather than trusting a region passed in — a webhook has no "caller's current
 * region" to re-resolve, and this is exactly as trustworthy for the client-
 * callback path too (see verifyTierSubscription above).
 */
function matchAndCheckTier({ expectedTierId, sub, plan }) {
  let tier = null;
  for (const region of REGIONS) {
    let candidate;
    try { candidate = pricing.getTier(region, expectedTierId); } catch { continue; }
    if (candidate.planId && candidate.planId === sub.plan_id) { tier = candidate; break; }
  }
  if (!tier) {
    return { ok: false, reason: 'wrong_plan' };
  }

  const factors = {
    status:   ACCEPTED_STATUSES.includes(sub.status),
    amount:   plan.item && plan.item.amount === tier.amountMinor,
    currency: plan.item && plan.item.currency === tier.currency,
  };
  if (!factors.status || !factors.amount || !factors.currency) {
    return { ok: false, reason: 'verification_failed', failed: Object.keys(factors).filter((k) => !factors[k]) };
  }

  return { ok: true, tier, subscriptionId: sub.id, planAmount: plan.item.amount, planCurrency: plan.item.currency };
}

module.exports = { createTierSubscription, verifyTierSubscription, matchAndCheckTier, ACCEPTED_STATUSES };
