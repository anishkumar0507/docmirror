'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Razorpay provider — implements the shared payment-provider interface
// (see lib/payments/index.js). This is a pure extraction of the logic that
// previously lived inline in routes/checkout.js, checkout-subscription.js,
// verify-payment.js, verify-subscription-payment.js and cancel-subscription.js.
//
// Behaviour is byte-for-byte identical to the old inline code: same Razorpay SDK
// calls, same HMAC-SHA256 formulas, same resolveAuditIdFromOrder usage, same log
// strings. Verification results are returned as structured objects so the routes
// can map them to the exact same HTTP responses they returned before.
//
// NOTE ON UNITS: Razorpay charges in MINOR units (paise). amountUnits is passed
// straight through — no conversion here (that is pricing's/the caller's concern).
// ─────────────────────────────────────────────────────────────────────────────

const crypto   = require('crypto');
require('../env');
const Razorpay   = require('razorpay');
const auditCache = require('../audit-cache');

const name = 'razorpay';

function client() {
  return new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

// ── one-time report order ────────────────────────────────────────────────────
// Mirrors routes/checkout.js razorpay.orders.create(...). `customer` carries the
// region/country recorded in the order notes. Returns the receipt so the caller
// can log it exactly as before.
async function createOrder({ amountUnits, currency, auditId, email, customer }) {
  const receipt = `rpt_${Date.now()}`.slice(0, 40);
  const order = await client().orders.create({
    amount:   amountUnits,
    currency,
    receipt,
    notes:    { auditId, email, region: (customer && customer.region) || '', country: (customer && customer.country) || '' },
  });
  return { orderId: order.id, amountUnits: order.amount, currency: order.currency, receipt, raw: order };
}

// ── verify a one-time report payment ─────────────────────────────────────────
// Mirrors routes/verify-payment.js steps 1–2: resolve the canonical auditId from
// the order notes, then verify the Razorpay HMAC over `${orderId}|${paymentId}`.
// The "using auditId" and "signature MISMATCH" logs are preserved at the same
// points so log ordering is unchanged. Razorpay's HMAC binds the order, so the
// amount is NOT re-fetched here — matching the previous behaviour (amountUnits/
// currency come back null; expectedUnits/expectedCurrency are accepted for
// interface parity but intentionally not re-checked for Razorpay).
async function verifyOrder({ orderId, paymentId, signature, clientAuditId }) {
  const auditId = await auditCache.resolveAuditIdFromOrder(orderId, clientAuditId);
  if (!auditId) return { ok: false, reason: 'auditid_unresolved' };
  if (!auditCache.isValidAuditId(auditId)) return { ok: false, reason: 'invalid_auditid', auditId };

  console.log(`[verify] using auditId=${auditId} (client sent ${clientAuditId})`);

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) return { ok: false, reason: 'no_secret' };

  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  if (expected !== signature) {
    console.error(`[verify] signature MISMATCH  orderId=${orderId}  paymentId=${paymentId}`);
    return { ok: false, reason: 'signature_mismatch', auditId, paymentId };
  }

  return { ok: true, auditId, paymentId, amountUnits: null, currency: null };
}

// ── monitor subscription ─────────────────────────────────────────────────────
// Mirrors routes/checkout-subscription.js razorpay.subscriptions.create(...).
// planId + expected price are resolved by the caller (kept there so the plan-not-
// configured guard and diagnostics log stay byte-for-byte); passed in here.
async function createSubscription({ email, auditId, regionTier, country, planId, expectedUnits, expectedCurrency }) {
  const sub = await client().subscriptions.create({
    plan_id:         planId,
    total_count:     120, // up to 10 years, cancel anytime
    quantity:        1,
    customer_notify: 1,
    notes: {
      plan:        'monitor',
      paymentType: 'subscription',
      email,
      auditId: auditId || '',
      region:  regionTier,
      country: country || '',
      expected_amount_units: String(expectedUnits),
      expected_currency:     expectedCurrency,
    },
  });
  return { subscriptionId: sub.id, shortUrl: sub.short_url || null, raw: sub };
}

// ── verify a subscription's first payment ────────────────────────────────────
// Mirrors routes/verify-subscription-payment.js step 1: HMAC over
// `${paymentId}|${subscriptionId}`. The MISMATCH log is preserved.
async function verifySubscription({ subscriptionId, paymentId, signature }) {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) return { ok: false, reason: 'no_secret' };

  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${paymentId}|${subscriptionId}`)
    .digest('hex');

  if (expected !== signature) {
    console.error(`[verify-sub] signature MISMATCH subId=${subscriptionId} paymentId=${paymentId}`);
    return { ok: false, reason: 'signature_mismatch' };
  }
  return { ok: true };
}

// ── cancel a subscription (immediate; keep access to cycle end) ───────────────
// Mirrors routes/cancel-subscription.js steps 2–3: fetch current_end for the
// access window, then cancel immediately, tolerating an already-cancelled sub.
// All four log strings are preserved (userId passed only for the success log).
// Throws on a hard cancel failure so the route can return its 502 unchanged.
async function cancelSubscription(subscriptionId, ctx = {}) {
  const razorpay = client();

  let accessUntil = null;
  try {
    const live = await razorpay.subscriptions.fetch(subscriptionId);
    if (live && live.current_end) {
      accessUntil = new Date(live.current_end * 1000).toISOString();
    }
  } catch (e) {
    console.warn('[cancel-subscription] Razorpay fetch warn:', e.message);
  }

  try {
    await razorpay.subscriptions.cancel(subscriptionId, false);
    console.log(`[cancel-subscription] Razorpay ${subscriptionId} cancelled (immediate) user=${ctx.userId}`);
  } catch (e) {
    const msg = (e && (e.error && e.error.description)) || (e && e.message) || String(e);
    if (/already|cancelled|not.*active|non.?active|completed/i.test(msg)) {
      console.log(`[cancel-subscription] Razorpay reports already cancelled (${msg}) — continuing`);
    } else {
      console.error('[cancel-subscription] Razorpay cancel failed:', msg);
      const err = new Error(msg);
      err.code = 'cancel_failed';
      throw err;
    }
  }

  return { ok: true, accessUntil };
}

// ── webhook signature verification (interface parity) ─────────────────────────
// Provided for the shared interface. The existing routes/webhook-razorpay.js is
// intentionally left untouched (it is not part of this refactor), so this method
// is not yet wired anywhere — it mirrors that file's verifySignature exactly.
function verifyWebhook(req, rawBody) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: 'no_secret' };

  const sig = req.headers['x-razorpay-signature'];
  if (!sig) return { ok: false, reason: 'missing_signature' };

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (expected !== sig) return { ok: false, reason: 'invalid_signature' };

  let event;
  try { event = JSON.parse(rawBody.toString()); }
  catch { return { ok: false, reason: 'invalid_json' }; }

  return { ok: true, event };
}

module.exports = {
  name,
  createOrder,
  verifyOrder,
  createSubscription,
  verifySubscription,
  cancelSubscription,
  verifyWebhook,
};
