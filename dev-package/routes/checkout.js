'use strict';

require('../lib/env');

const Razorpay   = require('razorpay');
const pricing    = require('../lib/pricing');
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

    // Amount + currency come from the centralized pricing config (India live:
    // ₹1,599 in paise, INR). No test-era fallback — values are always real.
    const amountUnits = pricing.reportAmountUnits();
    const currency    = pricing.billingCurrency();
    const receipt = `rpt_${Date.now()}`.slice(0, 40);

    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const order    = await razorpay.orders.create({
      amount:   amountUnits,
      currency,
      receipt,
      notes:    { auditId, email },
    });

    console.log(
      `[checkout] Razorpay order=${order.id} auditId=${auditId} ` +
      `receipt=${receipt} email=${email}`
    );

    return res.json({
      orderId:    order.id,
      amount:     order.amount,
      currency:   order.currency,
      keyId,
      auditId,
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
