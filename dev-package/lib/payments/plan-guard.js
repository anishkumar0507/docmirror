'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Razorpay subscription-plan pre-flight — mode + price guard.
//
// Two ways a subscription checkout goes wrong, both silent until a buyer hits it:
//
//   1. MODE MISMATCH. Razorpay TEST and LIVE are separate worlds — a plan created
//      in one is simply absent for the other's keys. subscriptions.create then
//      fails with a bare "The id provided does not exist", which surfaced to the
//      buyer as a raw 500 with nothing actionable in it.
//
//   2. PRICE MISMATCH. The recurring amount lives on the Razorpay PLAN, not in
//      our code — our pricing is only what we DISPLAY. If the two drift, the page
//      says ₹1,999 and the card is billed ₹4,715. This is the exact failure this
//      whole region-aware pricing model exists to prevent, so it must never be
//      possible to create a subscription that bills something else.
//
// Both BLOCK: refusing checkout is strictly better than billing a wrong amount.
// A transient Razorpay error fails OPEN — a flaky pre-flight must not take down
// checkout, and a genuinely bad plan still fails at create.
//
// Memoised per planId, successes ONLY, for the life of the process: one API call
// per cold start. A failure is never cached, so a fixed config recovers on the
// next request; an env change still needs a restart (as it always did).
// ─────────────────────────────────────────────────────────────────────────────

require('../env');
const payments = require('./index');

const _ok = new Map();

function keyMode() {
  return (process.env.RAZORPAY_KEY_ID || '').startsWith('rzp_live') ? 'live' : 'test';
}

/**
 * @param {string} planId            Razorpay plan id from env (never from a request)
 * @param {number} expectedUnits     what we display, in MINOR units (paise/cents)
 * @param {string} expectedCurrency  ISO code we display
 * @param {string} [label]           log prefix, e.g. 'checkout-sub' | 'agency'
 * @returns {Promise<{ok:boolean, reason?:string, plan?:object, mode?:string, unverified?:boolean}>}
 */
async function verifyPlan(planId, expectedUnits, expectedCurrency, label = 'plan-guard') {
  if (_ok.has(planId)) return _ok.get(planId);

  const mode = keyMode();
  let plan;
  try {
    plan = await payments.get('razorpay').fetchPlan(planId);
  } catch (err) {
    const status = err && err.statusCode;
    const desc   = (err && err.error && err.error.description) || (err && err.message) || '';
    if (status === 400 || status === 404) {
      console.error(
        `[${label}] PLAN NOT FOUND in ${mode} mode: planSuffix=${planId.slice(-4)} — ` +
        `RAZORPAY_KEY_ID is ${mode}, so this plan was almost certainly created in the other mode. ` +
        `Razorpay test and live plans are separate; set the keys and the plan id to the SAME mode.`
      );
      return { ok: false, reason: 'plan_mode_mismatch', mode };
    }
    console.warn(`[${label}] plan pre-flight could not run (${desc}) — continuing to create`);
    return { ok: true, unverified: true };   // fail open on a transient error
  }

  const amount   = plan.item && plan.item.amount;
  const currency = plan.item && plan.item.currency;

  // The price check applies only when we expect to be billed in the plan's own
  // currency (the India tier today). Other tiers already warn-and-proceed at the
  // call site; provider routing for them is a later phase.
  if (expectedCurrency === currency && amount !== expectedUnits) {
    console.error(
      `[${label}] PLAN PRICE MISMATCH: plan "${plan.item.name}" (suffix=${planId.slice(-4)}) charges ` +
      `${amount} ${currency}, but we display ${expectedUnits} ${expectedCurrency}. Refusing to create a ` +
      `subscription that would bill a different amount than the page shows. Create a new Razorpay plan ` +
      `at ${expectedUnits} and update the plan id in env.`
    );
    return { ok: false, reason: 'plan_price_mismatch', planAmount: amount, planCurrency: currency };
  }

  console.log(
    `[${label}] plan verified: "${plan.item.name}" ${amount} ${currency} ` +
    `${plan.period}/${plan.interval} mode=${mode}`
  );
  const result = { ok: true, plan, mode };
  _ok.set(planId, result);   // memoise successes only
  return result;
}

// User-facing copy for a blocked checkout. Deliberately says nothing about plan
// ids or modes (that is operator detail, already in the server log) and always
// states that no money moved.
function blockedMessage(reason) {
  return reason === 'plan_price_mismatch'
    ? 'Subscriptions are temporarily unavailable while we finish a price update. Please try again shortly — you have not been charged.'
    : 'Subscriptions are temporarily unavailable. Please try again shortly — you have not been charged.';
}

module.exports = { verifyPlan, blockedMessage, keyMode };
