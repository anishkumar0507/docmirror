'use strict';

require('../lib/env');

const Razorpay   = require('razorpay');
const pricing    = require('../lib/pricing');
const { resolveRegion } = require('../lib/region');
const auditCache = require('../lib/audit-cache');

// $49 Monitor subscription — ANONYMOUS at this stage.
// No account is created before payment. The account is created in
// verify-subscription-payment.js only after the payment signature is confirmed.
async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const planId    = process.env.RAZORPAY_MONITOR_PLAN_ID;

  if (!keyId || !keySecret) {
    return res.status(500).json({ error: 'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not configured' });
  }
  if (!planId) {
    return res.status(500).json({ error: 'RAZORPAY_MONITOR_PLAN_ID not configured — create a plan in Razorpay dashboard first' });
  }

  // Safe diagnostics: enough to confirm WHICH plan the running instance picked up
  // without printing the value. If production still bills the old price, the
  // suffix here is the fastest way to prove the env var did not roll out.
  console.log(`[checkout-sub] monitor plan configured: ${Boolean(planId)} suffix=${planId.slice(-4)} keyMode=${keyId.startsWith('rzp_live') ? 'live' : 'test'}`);

  const email     = (req.body?.email || '').trim();
  const auditData = req.body?.auditData || null;
  if (!email) return res.status(400).json({ error: 'email is required' });

  // Cache audit data if provided — generates the first report after payment
  let auditId = null;
  if (auditData) {
    try {
      auditId = `tdm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await auditCache.set(auditId, auditData);
      console.log(`[checkout-sub] audit data cached auditId=${auditId}`);
    } catch (cacheErr) {
      console.warn('[checkout-sub] audit cache set failed:', cacheErr.message);
      auditId = null;
    }
  }

  try {
    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

    // The charged amount lives on the Razorpay Plan, not here. We record the
    // region-appropriate EXPECTED price so a plan/price mismatch is visible in
    // notes and logs rather than silently billing the wrong price.
    const region        = resolveRegion(req);
    const expected      = pricing.priceFor(region.tier, 'monitor');
    const expectedUnits = expected.amount;
    const expectedCurr  = expected.currency;

    // Razorpay remains the ONLY provider this phase. The live plan is priced in
    // INR, so a non-IN buyer's expected currency will not match what the plan
    // charges. Warn clearly but still create the subscription — routing a non-IN
    // subscriber to Cashfree is the next phase.
    if (expectedCurr !== 'INR') {
      console.warn(
        `[checkout-sub] region=${region.tier} country=${region.country || '?'} expects ` +
        `${expectedCurr}, but the Razorpay plan charges INR — attempting anyway (provider routing pending)`
      );
    }

    const sub = await razorpay.subscriptions.create({
      plan_id:        planId,
      total_count:    120, // up to 10 years, cancel anytime
      quantity:       1,
      customer_notify: 1,
      notes: {
        plan:        'monitor',
        paymentType: 'subscription',
        email,
        auditId: auditId || '',
        region:  region.tier,
        country: region.country || '',
        expected_amount_units: String(expectedUnits),
        expected_currency:     expectedCurr,
      },
    });

    console.log(
      `[checkout-sub] created monitor subscription: ${sub.id} planSuffix=${planId.slice(-4)} ` +
      `region=${region.tier} country=${region.country || '?'} source=${region.source} ` +
      `expected=${expectedUnits} ${expectedCurr} (account created after payment)`
    );

    return res.json({
      subscriptionId: sub.id,
      shortUrl:       sub.short_url || null,
      keyId,
      email,
      auditId,
      region:   region.tier,
      currency: expectedCurr,
    });

  } catch (err) {
    console.error('[checkout-sub] error:', err.message);
    return res.status(500).json({ error: 'Subscription creation failed: ' + err.message });
  }
}

module.exports = handler;
