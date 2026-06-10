'use strict';

require('../lib/env');

const Razorpay   = require('razorpay');
const auditCache = require('../lib/audit-cache');
const paidReports = require('../lib/paid-reports');
const { verifyAuditCacheTable } = require('../lib/supabase-client');

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, auditData } = req.body || {};
  if (!email)     return res.status(400).json({ error: 'email is required' });
  if (!auditData) return res.status(400).json({ error: 'auditData is required' });

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

    await paidReports.insertPending({ auditId, email });

    const amountUnits = parseInt(process.env.RAZORPAY_AMOUNT_UNITS || '1900', 10);
    const receipt = `rpt_${Date.now()}`.slice(0, 40);

    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const order    = await razorpay.orders.create({
      amount:   amountUnits,
      currency: process.env.RAZORPAY_CURRENCY || 'USD',
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
