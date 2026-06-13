'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Reliable post-response background work on Vercel.
//
// On Vercel a serverless function is FROZEN the instant it sends its response, so
// any promise still in flight (a fire-and-forget fetch, a DB write) is killed
// mid-execution. That is exactly why the old self-call chain logged
// "dispatched=true" yet never reached the email step.
//
// `waitUntil(promise)` (from @vercel/functions) tells the runtime to keep the
// invocation alive until the promise settles — bounded by maxDuration (60s). We
// use it to run the full report pipeline in the background of the payment
// response, so the user gets an instant redirect AND the work actually finishes.
//
// Off Vercel (local dev / tests) the process stays alive on its own, so we just
// run the promise. The require is guarded so a missing dep never crashes a route.
// ─────────────────────────────────────────────────────────────────────────────

let _waitUntil = null;
try {
  _waitUntil = require('@vercel/functions').waitUntil;
} catch (_) {
  _waitUntil = null;
}

/**
 * Run a background task that must outlive the HTTP response.
 * @param {() => Promise<any>} factory  produces the work promise
 * @param {string} label                for logging
 */
function afterResponse(factory, label = 'bg-task') {
  const p = Promise.resolve()
    .then(factory)
    .catch((err) => {
      console.error(`[after-response] ${label} failed:`, err && err.message ? err.message : err);
    });

  if (typeof _waitUntil === 'function') {
    try {
      _waitUntil(p);
      console.log(`[after-response] ${label} registered with waitUntil`);
    } catch (e) {
      console.warn(`[after-response] waitUntil unavailable for ${label}:`, e.message);
    }
  } else {
    console.log(`[after-response] ${label} running without waitUntil (local/non-vercel)`);
  }
  return p;
}

module.exports = { afterResponse, hasWaitUntil: () => typeof _waitUntil === 'function' };
