'use strict';

require('../lib/env');

const Razorpay   = require('razorpay');
const pricing    = require('../lib/pricing');
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

    // The charged amount lives on the Razorpay Plan, not here. We record what we
    // EXPECT so a plan/price mismatch is visible in notes and logs rather than
    // silently billing the old price.
    const expectedUnits = pricing.monitorAmountUnits();

    const sub = await razorpay.subscriptions.create({
      plan_id:        planId,
      total_count:    120, // up to 10 years, cancel anytime
      quantity:       1,
      customer_notify: 1,
      notes: {
        email,
        auditId: auditId || '',
        expected_amount_units: String(expectedUnits),
        expected_currency:     pricing.billingCurrency(),
      },
    });

    console.log(
      `[checkout-sub] created subscription=${sub.id} email=${email} plan=${planId} ` +
      `expected=${expectedUnits} ${pricing.billingCurrency()} (account created after payment)`
    );

    return res.json({
      subscriptionId: sub.id,
      shortUrl:       sub.short_url || null,
      keyId,
      email,
      auditId,
    });

  } catch (err) {
    console.error('[checkout-sub] error:', err.message);
    return res.status(500).json({ error: 'Subscription creation failed: ' + err.message });
  }
}

module.exports = handler;
