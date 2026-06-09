'use strict';

require('../lib/env');

const Razorpay         = require('razorpay');
const { createClient } = require('@supabase/supabase-js');
const auditStore       = require('../lib/audit-store');

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
    // Unique key passed through the entire payment → report flow
    const auditId = `tdm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const cityRaw = (auditData.cityState || '').split(',');
    const city    = (cityRaw[0] || '').trim();
    const state   = (cityRaw[1] || '').trim();

    // Always store in memory first — guarantees report.js can find it
    // even when Supabase is unavailable
    auditStore.set(auditId, auditData);

    // Best-effort Supabase persist (for dashboard/history)
    const supabase = db();
    const { error: cacheErr } = await supabase.from('audit_cache').insert({
      cache_key:   auditId,
      doctor_name: auditData.doctorName || '',
      specialty:   auditData.specialty  || '',
      city,
      state,
      score:       auditData.score      || 0,
      audit_data:  auditData
    });
    if (cacheErr) console.warn('[checkout] audit_cache insert warn:', cacheErr.message);

    await supabase.from('paid_reports').insert({
      audit_id: auditId,
      email,
      status:   'pending'
    });

    // Amount in smallest currency unit. For USD: cents ($19 = 1900). Override via env.
    const amountUnits = parseInt(process.env.RAZORPAY_AMOUNT_UNITS || '1900', 10);

    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const order    = await razorpay.orders.create({
      amount:   amountUnits,
      currency: process.env.RAZORPAY_CURRENCY || 'USD',
      receipt:  auditId,
      notes:    { auditId, email }
    });

    console.log(`[checkout] Razorpay order created: ${order.id}  auditId: ${auditId}  email: ${email}`);

    // Return everything the frontend needs to open the Razorpay modal
    return res.json({
      orderId:  order.id,
      amount:   order.amount,
      currency: order.currency,
      keyId,
      auditId,
      doctorName: auditData.doctorName || ''
    });

  } catch (err) {
    console.error('[checkout] error:', err.message);
    return res.status(500).json({ error: 'Checkout failed: ' + err.message });
  }
}

module.exports = handler;
