'use strict';

const crypto = require('crypto');
require('../lib/env');

const auditCache  = require('../lib/audit-cache');
const paidReports = require('../lib/paid-reports');
const { triggerReportGeneration } = require('../lib/report-trigger');

// $19 Visibility Audit — anonymous, no account, no session, no dashboard
// Flow: payment verified → mark generating → trigger background worker → respond.
// Report (Claude prompts + PDF + email) runs in /api/generate-report, NOT here,
// so this request returns in a couple of seconds and never hits the Vercel 60s cap.
async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { orderId, paymentId, signature, auditId: clientAuditId, email } = req.body || {};

  if (!orderId || !paymentId || !signature || !clientAuditId || !email) {
    return res.status(400).json({
      error: 'orderId, paymentId, signature, auditId, email all required',
    });
  }

  // ── 1. Resolve canonical auditId from Razorpay order notes (tamper-proof) ──
  const auditId = await auditCache.resolveAuditIdFromOrder(orderId, clientAuditId);
  if (!auditId) {
    return res.status(400).json({ error: 'Could not resolve auditId from payment order' });
  }

  if (!auditCache.isValidAuditId(auditId)) {
    return res.status(400).json({
      error:     `Invalid auditId format: "${auditId}" (expected tdm_<timestamp>_<random>)`,
      code:      'INVALID_AUDIT_ID',
      cache_key: auditId,
    });
  }

  console.log(`[verify] using auditId=${auditId} (client sent ${clientAuditId})`);

  // ── 2. Verify Razorpay HMAC-SHA256 signature ──────────────────────────────
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) return res.status(500).json({ error: 'RAZORPAY_KEY_SECRET not configured' });

  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  if (expected !== signature) {
    console.error(
      `[verify] signature MISMATCH  orderId=${orderId}  paymentId=${paymentId}`
    );
    return res.status(400).json({
      error: 'Payment signature invalid — possible tampered request',
    });
  }

  console.log(
    `[verify] payment verified ✓  orderId=${orderId}  auditId=${auditId}  email=${email}`
  );

  // ── 3. Confirm audit data is present before triggering PDF generation ──────
  const cacheResult = await auditCache.getDetailed(auditId);
  if (!cacheResult.hit || !cacheResult.data) {
    const diagnostic = auditCache.formatDiagnostic(cacheResult);
    console.error(
      '[verify] audit_cache MISS BEFORE report:',
      JSON.stringify(diagnostic)
    );
    return res.status(503).json({
      ok:         false,
      error:      cacheResult.message,
      code:       cacheResult.code,
      diagnostic,
      hint:       'Payment was received. Support can locate this order by cache_key and re-trigger report generation.',
    });
  }

  console.log(
    `[verify] audit_cache HIT  source=${cacheResult.source}  cache_key=${cacheResult.cache_key}  ` +
    `doctor=${cacheResult.data.doctorName || '(unknown)'}`
  );

  // Mark as generating (non-fatal — paid_reports is a secondary record)
  await paidReports.updateStatus(auditId, {
    status:            'generating',
    stripe_session_id: orderId,
  });

  // ── 4. Trigger background report generation (does NOT block this response) ──
  // The worker (/api/generate-report) runs the Claude prompts + PDF + email in its
  // own invocation. This avoids the Vercel 60s timeout on the payment request.
  await triggerReportGeneration(req, { auditId, email, userId: null });

  // ── 5. Respond immediately ─────────────────────────────────────────────────
  return res.json({
    ok:         true,
    generating: true,
    emailSent:  false,
    message:    'Payment verified! Your full report is being generated and will be emailed within a couple of minutes.',
  });
}

module.exports = handler;
