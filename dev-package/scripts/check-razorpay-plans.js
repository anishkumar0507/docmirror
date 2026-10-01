#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// check-razorpay-plans — fetches every configured subscription plan ID (INR +
// USD, every region lib/pricing.js knows about) with the CURRENT keys and
// prints id, currency, amount and interval, or the exact Razorpay error.
//
// This answers, without guessing: is a plan ID test or live, does it belong to
// the current key's mode, and does it actually bill what lib/pricing.js says.
//
// USAGE
//   node scripts/check-razorpay-plans.js
//
// Never prints RAZORPAY_KEY_SECRET or any other secret — only the key MODE
// (test/live) and the last 4 characters of each plan id, same convention the
// rest of the payment code already uses in its logs.
// ─────────────────────────────────────────────────────────────────────────────

require('../lib/env');
const Razorpay = require('razorpay');
const pricing = require('../lib/pricing');

function client() {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

function pad(s, n) {
  s = String(s == null ? '' : s);
  return s.length >= n ? s.slice(0, n - 1) + '…' : s.padEnd(n);
}

(async () => {
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const keyMode = keyId.startsWith('rzp_live') ? 'LIVE' : keyId.startsWith('rzp_test') ? 'TEST' : '(unrecognised)';

  console.log('');
  console.log('  check-razorpay-plans');
  console.log('  key mode : ' + keyMode + (keyId ? '  (RAZORPAY_KEY_ID ends ...' + keyId.slice(-4) + ')' : '  (RAZORPAY_KEY_ID not set)'));
  console.log('');

  if (!keyId || !process.env.RAZORPAY_KEY_SECRET) {
    console.error('  RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not configured. Nothing to check.');
    process.exit(1);
  }

  const rz = client();
  const REGIONS = ['IN', 'US', 'INTL'];

  console.log('  ' + pad('Region', 8) + pad('Tier', 24) + pad('Env var', 26) + pad('Plan id (…suffix)', 20) + pad('Expected', 16) + 'Razorpay says');
  console.log('  ' + '-'.repeat(120));

  let anyFail = false;

  for (const region of REGIONS) {
    let tiers;
    try { tiers = pricing.getTiersForRegion(region); } catch (e) { console.log('  ' + region + ': ' + e.message); continue; }

    for (const tier of tiers) {
      if (tier.type !== 'subscription') continue; // one-time report has no Plan
      const expected = `${tier.amountMinor} ${tier.currency}`;
      const envVar = tier.planIdEnv || '(none)';
      const planId = tier.planId || '';

      let result;
      if (!planId) {
        result = 'NOT CONFIGURED — set ' + envVar + ' in env';
        anyFail = true;
      } else {
        try {
          const plan = await rz.plans.fetch(planId);
          const amt = plan.item && plan.item.amount;
          const cur = plan.item && plan.item.currency;
          const matches = amt === tier.amountMinor && cur === tier.currency;
          if (!matches) anyFail = true;
          result = `id=${planId} ${amt} ${cur} ${plan.period}/${plan.interval}` + (matches ? '  ✓ matches lib/pricing.js' : '  ✗ MISMATCH vs lib/pricing.js');
        } catch (err) {
          anyFail = true;
          const status = err && err.statusCode;
          const desc = (err && err.error && err.error.description) || (err && err.message) || String(err);
          if (status === 400 || status === 404) {
            result = `NOT FOUND in ${keyMode} mode (id=${planId.slice(0, 8)}…${planId.slice(-4)}) — created in the OTHER mode, or does not exist`;
          } else {
            result = `ERROR: ${desc}`;
          }
        }
      }

      console.log(
        '  ' + pad(region, 8) + pad(tier.id, 24) + pad(envVar, 26) +
        pad(planId ? '…' + planId.slice(-8) : '(unset)', 20) + pad(expected, 16) + result
      );
    }
  }

  console.log('');
  if (anyFail) {
    console.log('  ✗ One or more plans are missing, wrong-mode, or mismatched — see above.');
    process.exit(1);
  }
  console.log('  ✓ Every configured plan exists in ' + keyMode + ' mode and bills exactly what lib/pricing.js expects.');
})().catch((e) => {
  console.error('check-razorpay-plans failed:', e.message);
  process.exit(1);
});
