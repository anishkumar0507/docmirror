'use strict';

require('../lib/env');

const pricing    = require('../lib/pricing');
const payments   = require('../lib/payments');
const { resolveRegion } = require('../lib/region');
const auditCache = require('../lib/audit-cache');
const paidReports = require('../lib/paid-reports');
const { verifyAuditCacheTable, getSupabaseClient } = require('../lib/supabase-client');
const { optionalAuth } = require('../lib/auth-middleware');

// Extract user from Bearer token if present (never blocks the request)
async function getOptionalUser(req) {
  return new Promise(resolve => {
    req._optResolve = resolve;
    optionalAuth(req, {}, () => resolve(req.user || null));
  });
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, auditData } = req.body || {};
  if (!email)     return res.status(400).json({ error: 'email is required' });
  if (!auditData) return res.status(400).json({ error: 'auditData is required' });

  // Resolve logged-in user (optional — backward compatible with anonymous flow)
  const user   = await getOptionalUser(req);
  const userId = user?.id || null;

  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return res.status(500).json({ error: 'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not configured' });
  }

  try {
    const tableCheck = await verifyAuditCacheTable();
    if (!tableCheck.ok) {
      console.error('[checkout] audit_cache not ready:', tableCheck.message);
      return res.status(503).json({
        error: 'Audit storage temporarily unavailable. Please try again in a moment.',
        code: tableCheck.code || 'TABLE_INACCESSIBLE',
      });
    }

    const auditId = `tdm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    console.log(`[checkout] created auditId=${auditId} format_valid=${auditCache.isValidAuditId(auditId)}`);

    // MUST complete before Razorpay order — throws if Supabase write fails
    const cached = await auditCache.set(auditId, auditData);
    console.log(
      `[checkout] audit_cache persisted cache_key=${cached.cache_key} doctor=${cached.doctorName || '(unknown)'}`
    );

    await paidReports.insertPending({ auditId, email, userId });

    // Amount + currency now depend on the buyer's region so the displayed price
    // always equals the charged price (fixes US-card 3DS failures). Amount is in
    // minor units (paise/cents) — exactly what Razorpay wants.
    const region      = resolveRegion(req);
    const price       = pricing.priceFor(region.tier, 'report');
    const amountUnits = price.amount;
    const currency    = price.currency;

    // Razorpay remains the ONLY provider this phase. A non-INR tier will resolve
    // to a currency this India account may not support; warn loudly but still
    // attempt — provider routing to Cashfree comes in the next phase.
    if (currency !== 'INR') {
      console.warn(
        `[checkout] region=${region.tier} country=${region.country || '?'} resolves to ` +
        `${currency}, which Razorpay (India) may reject — attempting anyway (provider routing pending)`
      );
    }

    console.log(
      `[checkout] pricing region=${region.tier} country=${region.country || '?'} ` +
      `source=${region.source} amount=${amountUnits} currency=${currency}`
    );

    // Razorpay order creation now lives in lib/payments/razorpay.js (same SDK
    // call, same notes). Kept explicit ('razorpay') so behaviour is unchanged;
    // region-based provider routing arrives with Cashfree.
    const order = await payments.get('razorpay').createOrder({
      amountUnits,
      currency,
      auditId,
      email,
      customer: { region: region.tier, country: region.country || '' },
    });

    console.log(
      `[checkout] Razorpay order=${order.orderId} auditId=${auditId} ` +
      `receipt=${order.receipt} email=${email}`
    );

    return res.json({
      orderId:    order.orderId,
      amount:     order.amountUnits,
      currency:   order.currency,
      keyId,
      auditId,
      region:     region.tier,
      doctorName: auditData.doctorName || '',
    });

  } catch (err) {
    if (err.name === 'AuditCacheError') {
      console.error(`[checkout] audit_cache error code=${err.code}:`, err.message);
      return res.status(503).json({
        error: 'Could not save audit data before payment. Please retry.',
        code: err.code,
        cache_key: err.details?.cache_key,
        detail: err.message,
      });
    }
    console.error('[checkout] error:', err.message);
    return res.status(500).json({ error: 'Checkout failed: ' + err.message });
  }
}

module.exports = handler;
