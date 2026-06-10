'use strict';

const crypto = require('crypto');
require('../lib/env');

const auditCache = require('../lib/audit-cache');
const paidReports = require('../lib/paid-reports');
const { formatFetchError } = require('../lib/supabase-client');

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { orderId, paymentId, signature, auditId: clientAuditId, email } = req.body || {};

  if (!orderId || !paymentId || !signature || !clientAuditId || !email) {
    return res.status(400).json({ error: 'orderId, paymentId, signature, auditId, email all required' });
  }

  const auditId = await auditCache.resolveAuditIdFromOrder(orderId, clientAuditId);
  if (!auditId) {
    return res.status(400).json({ error: 'Could not resolve auditId from payment order' });
  }

  if (!auditCache.isValidAuditId(auditId)) {
    return res.status(400).json({
      error: `Invalid auditId format: "${auditId}" (expected tdm_<timestamp>_<random>)`,
      code: 'INVALID_AUDIT_ID',
      cache_key: auditId,
    });
  }

  console.log(`[verify] using auditId=${auditId} (client sent ${clientAuditId})`);

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) return res.status(500).json({ error: 'RAZORPAY_KEY_SECRET not configured' });

  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  if (expected !== signature) {
    console.error(`[verify] signature mismatch  orderId: ${orderId}  paymentId: ${paymentId}`);
    return res.status(400).json({ error: 'Payment signature invalid — possible tampered request' });
  }

  console.log(`[verify] payment verified ✓  orderId: ${orderId}  auditId: ${auditId}  email: ${email}`);

  const cacheResult = await auditCache.getDetailed(auditId);
  if (!cacheResult.hit || !cacheResult.data) {
    const diagnostic = auditCache.formatDiagnostic(cacheResult);
    console.error('[verify] audit_cache unavailable BEFORE report:', JSON.stringify(diagnostic));
    return res.status(503).json({
      ok: false,
      error: cacheResult.message,
      code: cacheResult.code,
      diagnostic,
      hint:
        'Payment was received. Support can locate this order by cache_key and re-trigger report generation.',
    });
  }

  console.log(
    `[verify] audit_cache HIT source=${cacheResult.source} cache_key=${cacheResult.cache_key} ` +
    `doctor=${cacheResult.data.doctorName || '(unknown)'}`
  );

  await paidReports.updateStatus(auditId, {
    status: 'generating',
    stripe_session_id: orderId,
  });

  const { generateReport, RateLimitError } = require('./report');
  const { isRateLimitError } = require('../lib/claude-client');

  try {
    await generateReport({ auditId, email });
    return res.json({ ok: true, message: 'Payment verified. Your report PDF has been emailed.' });
  } catch (err) {
    console.error('[verify] generateReport failed:', formatFetchError(err));

    if (err.name === 'AuditCacheError') {
      return res.status(503).json({
        ok: false,
        error: err.message,
        code: err.code,
        diagnostic: auditCache.formatDiagnostic(err.details),
      });
    }

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
