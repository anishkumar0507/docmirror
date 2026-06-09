'use strict';

require('../lib/env');

const Razorpay   = require('razorpay');
const { createClient } = require('@supabase/supabase-js');
const auditCache = require('../lib/audit-cache');

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

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
    // Unique key — full ID lives in notes.auditId, NOT in receipt (receipt may truncate)
    const auditId = `tdm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    console.log(`[checkout] created auditId=${auditId}`);

    const cityRaw = (auditData.cityState || '').split(',');
    const city    = (cityRaw[0] || '').trim();
    const state   = (cityRaw[1] || '').trim();

    // Persist before payment — memory + Supabase (survives Vercel cold starts)
    await auditCache.set(auditId, auditData);
    console.log(`[checkout] cached auditId=${auditId} before Razorpay order`);

    const supabase = db();
    const { error: paidErr } = await supabase.from('paid_reports').insert({
      audit_id: auditId,
      email,
      status:   'pending',
    });
    if (paidErr) console.warn('[checkout] paid_reports insert warn:', paidErr.message);

    const amountUnits = parseInt(process.env.RAZORPAY_AMOUNT_UNITS || '1900', 10);

    // Short receipt for Razorpay internal ref — NEVER use receipt as auditId lookup
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
    console.error('[checkout] error:', err.message);
    return res.status(500).json({ error: 'Checkout failed: ' + err.message });
  }
}

module.exports = handler;
