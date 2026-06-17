'use strict';

const crypto = require('crypto');
require('../lib/env');

const auditCache  = require('../lib/audit-cache');
const paidReports = require('../lib/paid-reports');
const reportsStore = require('../lib/reports-store');
const { getSupabaseClient } = require('../lib/supabase-client');
const { afterResponse } = require('../lib/after-response');

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

  // ── 4. Save a report PLACEHOLDER row immediately ───────────────────────────
  // Score/reviews/competitors come straight from the audit data, so the dashboard
  // has real numbers on its very first poll — before any Claude/PDF work finishes.
  // (Non-fatal: the pipeline also writes this row in the insights stage.)
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const placeholder = reportsStore.reportFromAuditData(auditId, cacheResult.data, {});
      const r = await reportsStore.upsertReport(supabase, placeholder);
      console.log(`[verify] report placeholder ${r.action || r.reason} audit_id=${auditId}`);
    } catch (e) {
      console.warn('[verify] placeholder write warn:', e.message);
    }
  }

  // Mark as in-pipeline (non-fatal — paid_reports is a secondary record).
  // Uses 'generating' (an allowed status) — the pipeline keeps this value through
  // the insights + pdf stages; reconcile keys off produced artifacts, not status.
  await paidReports.updateStatus(auditId, {
    status:            'generating',
    stripe_session_id: orderId,
  });

  // ── 5. Run the full pipeline in the background of THIS response ─────────────
  // waitUntil keeps the Vercel invocation alive until insights → pdf → storage →
  // email all complete (≈37s, well under the 60s cap) — no fragile HTTP self-call
  // chain to drop. /api/reconcile is the backstop if this invocation is killed.
  const { runReportPipeline } = require('./report');
  afterResponse(() => runReportPipeline({ auditId, email, userId: null }), `audit-report:${auditId}`);

  // ── 6. Respond immediately so the browser can redirect to the dashboard ─────
  return res.json({
    ok:         true,
    generating: true,
    emailSent:  false,
    auditId,
    message:    'Payment verified! Your report is being generated — your dashboard will fill in within a minute and the PDF will be emailed shortly.',
  });
}

module.exports = handler;
