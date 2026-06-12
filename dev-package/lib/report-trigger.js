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

/**
 * Fire-and-forget trigger of the report worker. Returns quickly (≤ ~600ms) — never
 * waits for generation to complete. Safe to await from the payment handler.
 */
async function triggerReportGeneration(req, { auditId, email, userId = null }) {
  const base = baseUrlFromReq(req);
  const url  = `${base}/api/generate-report`;
  const body = JSON.stringify({ auditId, email, userId, token: jobToken(auditId, email) });

  let dispatched = false;
  try {
    const p = fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      .then(() => { dispatched = true; })
      .catch((e) => { console.warn('[trigger] worker dispatch warn:', e.message); });
    // Give the request up to 600ms to flush, then return regardless — the worker
    // continues server-side as an independent invocation.
    await Promise.race([p, new Promise((r) => setTimeout(r, 600))]);
  } catch (e) {
    console.warn('[trigger] error:', e.message);
  }
  console.log(`[trigger] report worker dispatched=${dispatched} auditId=${auditId} url=${url}`);
  return { url, dispatched };
}

module.exports = { triggerReportGeneration, jobToken, baseUrlFromReq };
