'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Background report generation trigger.
//
// Vercel serverless functions cannot run work after responding and cannot run
// >60s synchronously. So payment verification must NOT generate the report inline.
// Instead it fires a request to the dedicated /api/generate-report worker, which
// runs as its OWN invocation (its own 60s budget) while the payment request
// returns immediately. The call is fire-and-forget; we give it a brief moment to
// flush so the request is dispatched before the caller's lambda suspends.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

/** HMAC so only callers that know the Razorpay secret can spend Claude credits. */
function jobToken(auditId, email) {
  const secret = process.env.RAZORPAY_KEY_SECRET || process.env.INTERNAL_JOB_SECRET || 'dev-secret';
  return crypto.createHmac('sha256', secret).update(`${auditId}|${email}`).digest('hex');
}

/** Resolve the public base URL for an internal self-call. */
function baseUrlFromReq(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  if (process.env.VERCEL_URL)      return `https://${process.env.VERCEL_URL}`;
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0] || req.protocol || 'http';
  const host  = req.headers.host;
  return `${proto}://${host}`;
}

// Pipeline stages, in order. Each is its OWN serverless invocation with its own
// 60s budget, so no single stage can exceed the Vercel limit. Each stage triggers
// the next on success; /api/reconcile re-drives any stage whose trigger was dropped.
const STAGE_ROUTES = {
  insights: '/api/generate-report',   // 9 Claude prompts → persist insights
  pdf:      '/api/render-pdf',         // Puppeteer render → upload → pdf_url
  email:    '/api/send-report-email',  // email the PDF
};

/**
 * Fire-and-forget trigger of a pipeline stage worker. Returns quickly (≤ ~800ms) —
 * never waits for the stage to finish. The brief await only ensures the outbound
 * request is flushed before the caller's lambda can freeze.
 */
async function triggerStage(req, stage, { auditId, email, userId = null }) {
  const route = STAGE_ROUTES[stage];
  if (!route) throw new Error(`Unknown pipeline stage: ${stage}`);
  const base = baseUrlFromReq(req);
  const url  = `${base}${route}`;
  const body = JSON.stringify({ auditId, email, userId, token: jobToken(auditId, email) });

  let dispatched = false;
  try {
    const p = fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      .then(() => { dispatched = true; })
      .catch((e) => { console.warn(`[trigger] ${stage} dispatch warn:`, e.message); });
    await Promise.race([p, new Promise((r) => setTimeout(r, 800))]);
  } catch (e) {
    console.warn(`[trigger] ${stage} error:`, e.message);
  }
  console.log(`[trigger] stage=${stage} dispatched=${dispatched} auditId=${auditId} url=${url}`);
  return { url, dispatched };
}

/** Back-compat: kick off the pipeline at the first (insights) stage. */
async function triggerReportGeneration(req, payload) {
  return triggerStage(req, 'insights', payload);
}

module.exports = { triggerStage, triggerReportGeneration, jobToken, baseUrlFromReq, STAGE_ROUTES };
