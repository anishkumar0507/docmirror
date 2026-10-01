'use strict';

require('../lib/env');

const payments    = require('../lib/payments');
const auditCache  = require('../lib/audit-cache');
const paidReports = require('../lib/paid-reports');
const reportsStore = require('../lib/reports-store');
const { getSupabaseClient } = require('../lib/supabase-client');
const { afterResponse } = require('../lib/after-response');
const reportCredits = require('../lib/report-credits');

// One-time visibility report ($49/₹999) — anonymous, no account, no session, no dashboard
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

  // ── 1+2. Resolve canonical auditId + verify Razorpay HMAC signature ────────
  // Both steps now live in lib/payments/razorpay.js (same resolveAuditIdFromOrder,
  // same HMAC over `${orderId}|${paymentId}`, same "using auditId"/MISMATCH logs).
  // Reasons are mapped back to the exact HTTP responses this route returned before.
  const verified = await payments.get('razorpay').verifyOrder({ orderId, paymentId, signature, clientAuditId });
  if (!verified.ok) {
    if (verified.reason === 'auditid_unresolved') {
      return res.status(400).json({ error: 'Could not resolve auditId from payment order' });
    }
    if (verified.reason === 'invalid_auditid') {
      return res.status(400).json({
        error:     `Invalid auditId format: "${verified.auditId}" (expected tdm_<timestamp>_<random>)`,
        code:      'INVALID_AUDIT_ID',
        cache_key: verified.auditId,
      });
    }
    if (verified.reason === 'no_secret') {
      return res.status(500).json({ error: 'RAZORPAY_KEY_SECRET not configured' });
    }
    // signature_mismatch (or any other failure)
    return res.status(400).json({ error: 'Payment signature invalid — possible tampered request' });
  }
  const auditId = verified.auditId;

  console.log(
    `[verify] payment verified ✓  orderId=${orderId}  auditId=${auditId}  email=${email}`
  );

  // ── 2b. Three-factor check: status + amount + currency ─────────────────────
  // The HMAC over orderId|paymentId proves Razorpay itself signed this payment
  // for this order, but not that the order still matches what we quoted at
  // checkout (lib/paid-reports.js records that at creation time — see
  // routes/checkout.js). Re-read the payment from Razorpay directly rather than
  // trusting anything in the request body, the same pattern routes/agency.js
  // uses for subscriptions.
  const sold = await paidReports.get(auditId);
  if (sold && sold.currency && sold.amount_units != null) {
    let payment;
    try {
      payment = await payments.get('razorpay').fetchPayment(paymentId);
    } catch (e) {
      console.error(`[verify] could not read payment from Razorpay: ${(e.error && e.error.description) || e.message}`);
      return res.status(502).json({ error: 'Could not confirm the payment with Razorpay. Please refresh in a moment.' });
    }
    const factors = {
      status:   payment.status === 'captured',
      amount:   payment.amount === sold.amount_units,
      currency: payment.currency === sold.currency,
    };
    console.log(
      `[verify] three-factor auditId=${auditId} paymentStatus=${payment.status} ` +
      `paymentAmount=${payment.amount} paymentCurrency=${payment.currency} ` +
      `expected=${sold.amount_units} ${sold.currency} factors=${JSON.stringify(factors)}`
    );
    if (!factors.status || !factors.amount || !factors.currency) {
      const failed = Object.keys(factors).filter((k) => !factors[k]);
      console.error(`[verify] REJECTED auditId=${auditId} orderId=${orderId} failed=[${failed.join(',')}]`);
      return res.status(400).json({
        error: 'Payment does not match what was quoted at checkout — possible tampered request. Nothing has been unlocked.',
        code: 'VERIFICATION_FAILED',
        failed,
      });
    }
  } else {
    // No recorded expectation (row predates migration 028, or the table write
    // was skipped) — the HMAC check above still holds; log so this is visible
    // rather than silently skipping a check that should normally run.
    console.warn(`[verify] auditId=${auditId} has no recorded tier/currency to compare — skipping three-factor check`);
  }

  // ── 3. Confirm audit data is present before triggering PDF generation ──────
  const cacheResult = await auditCache.getDetailed(auditId);
  if (!cacheResult.hit || !cacheResult.data) {
    // No scan data cached for this order — NOT an error if this is a report
    // credit purchase (routes/checkout.js skips caching audit data for those:
    // the buyer hasn't picked a doctor yet). Grant the credit instead of
    // erroring. Anonymous purchases always have auditData at checkout, so they
    // always hit the branch above this one; only an authenticated, no-scan-yet
    // purchase reaches here.
    if (sold && sold.tier_id === 'report_onetime' && sold.user_id) {
      const grant = await reportCredits.grantCredit({
        userId: sold.user_id, paymentId, orderAuditId: auditId,
        currency: sold.currency, amountUnits: sold.amount_units,
      });
      if (!grant.ok) {
        console.error(`[verify] credit grant FAILED auditId=${auditId} userId=${sold.user_id} reason=${grant.reason}`);
        return res.status(503).json({
          ok: false,
          error: 'Payment verified, but we could not record your report credit. Please contact support with this reference.',
          code: 'CREDIT_GRANT_FAILED',
          reference: auditId,
        });
      }
      await paidReports.updateStatus(auditId, { status: 'delivered', stripe_session_id: orderId, delivered_at: new Date().toISOString() });
      console.log(`[verify] report credit granted (idempotent) auditId=${auditId} userId=${sold.user_id} created=${grant.created}`);
      return res.json({
        ok: true,
        credited: true,
        redirect: '/pages/redeem-report.html',
        message: 'Payment verified — your report credit is ready. Tell us which doctor it\'s for to generate the PDF.',
      });
    }

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
