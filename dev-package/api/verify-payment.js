'use strict';

const crypto = require('crypto');
require('../lib/env');

const { createClient } = require('@supabase/supabase-js');

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { orderId, paymentId, signature, auditId, email } = req.body || {};

  if (!orderId || !paymentId || !signature || !auditId || !email) {
    return res.status(400).json({ error: 'orderId, paymentId, signature, auditId, email all required' });
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) return res.status(500).json({ error: 'RAZORPAY_KEY_SECRET not configured' });

  // Razorpay signature = HMAC-SHA256(orderId + "|" + paymentId, keySecret)
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  if (expected !== signature) {
    console.error(`[verify] signature mismatch  orderId: ${orderId}  paymentId: ${paymentId}`);
    return res.status(400).json({ error: 'Payment signature invalid — possible tampered request' });
  }

  console.log(`[verify] payment verified ✓  orderId: ${orderId}  auditId: ${auditId}  email: ${email}`);

  // Mark as paid in DB immediately so user sees confirmation
  const supabase = db();
  await supabase.from('paid_reports')
    .update({ status: 'generating', stripe_session_id: orderId })  // reuse stripe_session_id column for razorpay orderId
    .eq('audit_id', auditId);

  const { generateReport, RateLimitError } = require('./report');
  const { isRateLimitError } = require('../lib/claude-client');

  try {
    await generateReport({ auditId, email });
    return res.json({ ok: true, message: 'Payment verified. Your report PDF has been emailed.' });
  } catch (err) {
    console.error('[verify] generateReport failed:', err.message);
    if (err instanceof RateLimitError || isRateLimitError(err)) {
      return res.status(429).json({
        ok: false,
        error: 'Payment received, but our AI is busy. Your report will be emailed within a few minutes — or tap Download PDF to retry.',
        code: 'rate_limit',
        retryAfter: err.retryAfter || 60,
      });
    }
    return res.json({
      ok: true,
      message: 'Payment verified. Report generation is in progress — check your email shortly.',
    });
  }
}

module.exports = handler;
