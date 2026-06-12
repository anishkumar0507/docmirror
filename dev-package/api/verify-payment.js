'use strict';

const crypto = require('crypto');
require('../lib/env');

const auditCache  = require('../lib/audit-cache');
const paidReports = require('../lib/paid-reports');
const { formatFetchError } = require('../lib/supabase-client');

// $19 Visibility Audit — anonymous, no account, no session, no dashboard
// Flow: payment verified → generate PDF → email PDF → thank-you page
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

  // ── 4. Generate PDF + email (synchronous for $19: user needs download link) ─
  // $19 is NOT a SaaS product — no account, no session, no dashboard.
  // We keep PDF generation synchronous here so the response includes pdfUrl
  // for the immediate "Download PDF Now" button on the thank-you page.
  const { generateReport, RateLimitError } = require('./report');
  const { isRateLimitError }               = require('../lib/claude-client');

  let result;
  try {
    result = await generateReport({ auditId, email, userId: null });
  } catch (err) {
    console.error('[verify] generateReport threw:', formatFetchError(err));

    if (err.name === 'AuditCacheError') {
      return res.status(503).json({
        ok:           false,
        code:         err.code,
        pdfGenerated: false,
        error:        err.message,
        diagnostic:   auditCache.formatDiagnostic(err.details),
      });
    }

    if (err instanceof RateLimitError || isRateLimitError(err)) {
      return res.status(429).json({
        ok:           false,
        code:         'RATE_LIMIT',
        pdfGenerated: false,
        error:
          'Payment received, but our AI is busy. Your report will be emailed within a few minutes — or tap Download PDF to retry.',
        retryAfter: err.retryAfter || 60,
      });
    }

    console.error('[verify] PDF generation FAILED:', err.message);
    return res.status(500).json({
      ok:           false,
      code:         'PDF_GENERATION_FAILED',
      pdfGenerated: false,
      error:
        'Payment verified but PDF generation failed. Please contact support or use the Download PDF button to retry.',
      detail: err.message,
    });
  }

  // ── 5. Respond ─────────────────────────────────────────────────────────────
  if (result.emailSent) {
    return res.json({
      ok:           true,
      emailSent:    true,
      pdfGenerated: true,
      pdfUrl:       result.pdfUrl || null,
      message:      'Payment verified. Your report PDF has been emailed.',
    });
  }

  // PDF in storage but SMTP delivery failed
  console.warn(
    `[verify] PDF generated but email NOT sent  auditId=${auditId}  email=${email}  ` +
    `pdfUrl=${result.pdfUrl || '(not stored)'}`
  );
  return res.status(200).json({
    ok:           false,
    code:         'EMAIL_FAILED',
    emailSent:    false,
    pdfGenerated: true,
    pdfUrl:       result.pdfUrl || null,
    message:
      'Payment verified. Your PDF was generated but the email could not be delivered. ' +
      'Please use the Download PDF button on this page.',
  });
}

module.exports = handler;
