'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Single-doctor Monitor plan (₹1,999/mo IN, $29/mo US/INTL): checkout → verify
// → upgrade the logged-in account to 'monitor'.
//
// This is the region-aware, authenticated REPLACEMENT flow for the single-
// doctor subscription — modelled on routes/agency.js (see that file's header
// for the full reasoning), NOT on routes/verify-subscription-payment.js, which
// creates the account AFTER payment and resets an existing account's password.
// Nothing here does that:
//
//   • The account must already exist and be logged in. checkout/verify both
//     require a verified Bearer token; no email/password ever appears in a
//     request body here, so there is nothing to reset.
//   • routes/checkout-subscription.js + routes/verify-subscription-payment.js
//     (the anonymous, INR-only, pay-then-create-account flow) are UNCHANGED
//     and keep working exactly as they do today — this is an additional path,
//     not a replacement of that one, so nothing already linked to it breaks.
//
// Provisioning is gated on the same three independent facts read from Razorpay
// after the HMAC check that routes/agency.js uses: status, amount, currency —
// see lib/payments/subscription-flow.js, shared by both routes.
// ─────────────────────────────────────────────────────────────────────────────

require('../lib/env');

const { resolveRegionForUser } = require('../lib/region');
const { getSupabaseClient } = require('../lib/supabase-client');
const subscriptionFlow = require('../lib/payments/subscription-flow');
const planGuard = require('../lib/payments/plan-guard');
const { isMissingColumnError: isMissingColumn } = require('../lib/paid-reports');

const TIER_ID = 'single_doctor_monthly';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/monitor/checkout   (requireAuth)
// Creates the Razorpay subscription for the AUTHENTICATED user, in THEIR region.
// ─────────────────────────────────────────────────────────────────────────────
async function checkout(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const keyId  = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !secret) return res.status(500).json({ error: 'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not configured' });

  const userId = req.user.id;
  const email  = req.user.email || '';
  const region = await resolveRegionForUser(req, userId, getSupabaseClient());

  const result = await subscriptionFlow.createTierSubscription({
    region: region.tier, country: region.country, tierId: TIER_ID, userId, email, label: 'monitor-checkout',
  });

  if (!result.ok) {
    if (result.reason === 'plan_not_configured') {
      return res.status(500).json({ error: `${result.planIdEnv} not configured — create the Monitor plan for this region in the Razorpay dashboard first` });
    }
    return res.status(503).json({ error: planGuard.blockedMessage(result.reason), code: result.reason });
  }

  console.log(
    `[monitor-checkout] userId=${userId} region=${region.tier} source=${region.source} ` +
    `planSuffix=${(result.tier.planId || '').slice(-4)} created subscription=${result.subscriptionId} ` +
    `expected=${result.tier.amountMinor} ${result.tier.currency}`
  );

  return res.json({
    subscriptionId: result.subscriptionId,
    shortUrl:       result.shortUrl,
    keyId,
    amount:         result.tier.amountMinor,
    currency:       result.tier.currency,
    display:        result.tier.displayPrice,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/monitor/verify   { subscriptionId, paymentId, signature }   (requireAuth)
// ─────────────────────────────────────────────────────────────────────────────
async function verify(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const subscriptionId = String(req.body?.subscriptionId || '').trim();
  const paymentId      = String(req.body?.paymentId || '').trim();
  const signature      = String(req.body?.signature || '').trim();
  const userId         = req.user.id;

  if (!subscriptionId || !paymentId || !signature) {
    return res.status(400).json({ error: 'subscriptionId, paymentId and signature are required' });
  }

  const result = await subscriptionFlow.verifyTierSubscription({
    expectedTierId: TIER_ID, userId, subscriptionId, paymentId, signature,
  });

  if (!result.ok) {
    console.error(`[monitor-verify] REJECTED subId=${subscriptionId} userId=${userId} reason=${result.reason} failed=${(result.failed || []).join(',')}`);
    if (result.reason === 'no_secret') return res.status(500).json({ error: 'RAZORPAY_KEY_SECRET not configured' });
    if (result.reason === 'signature_mismatch') return res.status(400).json({ error: 'Payment signature invalid — possible tampered request' });
    if (result.reason === 'razorpay_unreachable') return res.status(502).json({ error: 'Could not confirm the payment with Razorpay. Please refresh in a moment.' });
    if (result.reason === 'user_mismatch') return res.status(403).json({ error: 'This subscription belongs to a different account.' });
    if (result.reason === 'wrong_plan') return res.status(400).json({ error: 'That payment is not for the Monitor plan.' });
    return res.status(400).json({
      error: (result.failed || []).includes('status')
        ? 'Your subscription is not active yet. If you were charged, refresh in a minute or contact support.'
        : 'The subscription does not match the Monitor plan price. Nothing has been activated — please contact support.',
      code: 'VERIFICATION_FAILED',
      failed: result.failed,
    });
  }

  console.log(`[monitor-verify] subId=${subscriptionId} userId=${userId} verified tier=${result.tier.id} ${result.tier.currency}`);

  const provisionResult = await provisionMonitor({
    userId, subscriptionId, razorpayPlanId: result.tier.planId, currency: result.tier.currency,
  });

  if (!provisionResult.ok) {
    return res.status(500).json({
      ok: false,
      error: 'Payment confirmed, but we could not finish activating your Monitor plan. ' +
             'Your subscription is active — press Retry, or contact support with this id.',
      code: 'PROVISIONING_FAILED',
      failedStep: provisionResult.failedStep,
      subscriptionId,
      retryable: true,
    });
  }

  return res.json({ ok: true, plan: 'monitor', redirect: '/dashboard' });
}

// ─────────────────────────────────────────────────────────────────────────────
// provisionMonitor — the only writer of a monitor upgrade for an already-
// authenticated account. IDEMPOTENT and ordered the same way provisionAgencyOrg
// is: the step that has to work (subscriptions row) before the one that gates
// every entitlement check (profiles.plan), so a retry only ever finishes what
// is still missing.
// ─────────────────────────────────────────────────────────────────────────────
async function provisionMonitor({ userId, subscriptionId, razorpayPlanId, currency }) {
  const supabase = getSupabaseClient();
  const ctx = `userId=${userId} subId=${subscriptionId}`;
  if (!supabase) return { ok: false, failedStep: 'db_client' };

  // ── 1. subscriptions — razorpay_subscription_id is UNIQUE, a retry collides,
  //      which means the row is already there. That is success. ─────────────
  try {
    const row = {
      user_id: userId, plan: 'monitor', status: 'active',
      razorpay_subscription_id: subscriptionId,
      razorpay_plan_id: razorpayPlanId,
      start_date: new Date().toISOString(),
      currency, tier_id: TIER_ID,
    };
    let { error } = await supabase.from('subscriptions').insert(row);
    if (error && isMissingColumn(error)) {
      const { currency: _c, tier_id: _t, ...minimal } = row;
      ({ error } = await supabase.from('subscriptions').insert(minimal));
    }
    if (error && !/duplicate|unique|23505/i.test(`${error.code} ${error.message}`)) {
      console.error(`[monitor-provision] STEP FAILED step=subscriptions ${ctx} code=${error.code} message=${error.message}`);
      return { ok: false, failedStep: 'subscriptions' };
    }
    console.log(`[monitor-provision] ✓ subscription row ${error ? '(already present)' : 'inserted'} ${ctx}`);
  } catch (e) {
    console.error(`[monitor-provision] STEP FAILED step=subscriptions ${ctx}: ${e.message}`);
    return { ok: false, failedStep: 'subscriptions' };
  }

  // ── 2. profiles.plan + billing_currency lock — LAST, the gate every
  //      entitlement check reads. ─────────────────────────────────────────────
  try {
    const update = { plan: 'monitor', billing_currency: currency, updated_at: new Date().toISOString() };
    let { data, error } = await supabase.from('profiles').update(update).eq('id', userId).select('id, plan');
    if (error && isMissingColumn(error)) {
      ({ data, error } = await supabase.from('profiles')
        .update({ plan: 'monitor', updated_at: new Date().toISOString() }).eq('id', userId).select('id, plan'));
    }
    if (error || !data || !data.length) {
      console.error(`[monitor-provision] STEP FAILED step=profiles_plan ${ctx} ${error ? error.message : 'no row matched'}`);
      return { ok: false, failedStep: 'profiles_plan' };
    }
    console.log(`[monitor-provision] ✓ profiles.plan=monitor billing_currency=${currency} ${ctx}`);
  } catch (e) {
    console.error(`[monitor-provision] STEP FAILED step=profiles_plan ${ctx}: ${e.message}`);
    return { ok: false, failedStep: 'profiles_plan' };
  }

  return { ok: true };
}

module.exports = { checkout, verify, provisionMonitor };
