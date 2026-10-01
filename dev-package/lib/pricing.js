'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Region-aware pricing — single source of truth for prices, currency AND the
// Razorpay plan id each subscription tier charges against.
//
// AMOUNTS ARE STORED IN MINOR UNITS EVERYWHERE (paise for INR, cents for USD).
// Razorpay takes MINOR units directly for both orders.create and its Plans —
// never pre-convert here, hand the checkout code the minor value as-is.
//
// getTiersForRegion(region) / getTier(region, tierId) are the primary API: a
// tierId identifies ONE product in ONE region ('single_doctor_monthly',
// 'org_monthly', 'report_onetime'). Checkout/verify code should look products up by
// tierId, never by re-deriving an amount from a product name + region.
//
// The older priceFor()/orgPlanPrice()/displayPrices() functions are kept
// (unchanged call signatures and return shapes) as thin views over the SAME
// tier list, so existing callers (routes/config.js, routes/checkout*.js,
// routes/agency.js, lib/payments/cashfree.js) needed no changes for this phase.
//
// Change prices without a redeploy via env overrides — see envAmount/envDisplay.
// ─────────────────────────────────────────────────────────────────────────────

const CURRENCY_SYMBOL = { INR: '₹', USD: '$' };

// Each tier entry's shape (STEP 1):
//   id              stable product id, e.g. 'single_doctor_monthly'
//   type            'subscription' | 'one_time'
//   currency        ISO 4217
//   amountMinor     paise/cents — env-overridable via envAmount()
//   planIdEnv       (subscription only) env var name holding the Razorpay Plan id
//   entitlementKey  the profiles.plan value this product grants ('monitor'/'agency');
//                   'audit' for the one-time report (not a profiles.plan value —
//                   see lib/entitlements.js — but the same "what did they buy" key)
//   displayPrice    env-overridable via envDisplay()
//   envKey          which PRICE_<TIER>_<envKey>_* override this entry reads
//   profileLimit    (org tier only) doctor_profiles cap, from ORG_PLANS
//
// IN keeps the legacy env var names it shipped with (RAZORPAY_STARTER_AMOUNT_UNITS
// etc.) as an ADDITIONAL fallback, tried before the entry's own default — see
// envAmount(). US/INTL are new and have no legacy names to preserve.
function buildTiers(currency, {
  report, monitor, org,
  monitorPlanEnv, orgPlanEnv,
}) {
  return [
    {
      id: 'report_onetime', type: 'one_time', currency,
      amountMinor: report.amount, displayPrice: report.display,
      entitlementKey: 'audit', envKey: 'REPORT',
    },
    {
      id: 'single_doctor_monthly', type: 'subscription', currency,
      amountMinor: monitor.amount, displayPrice: monitor.display,
      entitlementKey: 'monitor', envKey: 'MONITOR',
      planIdEnv: monitorPlanEnv, profileLimit: 1,
    },
    {
      id: 'org_monthly', type: 'subscription', currency,
      amountMinor: org.amount, displayPrice: org.display,
      entitlementKey: 'agency', envKey: 'ORG',
      planIdEnv: orgPlanEnv, profileLimit: 10,
    },
  ];
}

const TIER_DEFS = {
  // India — charged in INR via Razorpay (live mode today).
  IN: buildTiers('INR', {
    report:  { amount: 99900,  display: '₹999' },
    monitor: { amount: 199900, display: '₹1,999/month' },
    org:     { amount: 799900, display: '₹7,999/month' },
    monitorPlanEnv: 'RAZORPAY_MONITOR_PLAN_ID',
    orgPlanEnv:     'RAZORPAY_AGENCY_PLAN_ID',
  }),
  // US + Canada — charged in USD via Razorpay (international payment gateway).
  US: buildTiers('USD', {
    report:  { amount: 4900, display: '$49' },
    monitor: { amount: 2900, display: '$29/month' },
    org:     { amount: 9900, display: '$99/month' },
    monitorPlanEnv: 'RAZORPAY_PLAN_USD_SINGLE',
    orgPlanEnv:     'RAZORPAY_PLAN_USD_ORG',
  }),
  // Rest-of-world (non-EU, see lib/region.js). Same product/price as US FOR NOW,
  // kept a SEPARATE tier on purpose so it can diverge later (its own plan ids,
  // its own price) without touching the US tier. buildTiers() is a factory, so
  // this is an independent set of objects, not a shared reference to US's.
  INTL: buildTiers('USD', {
    report:  { amount: 4900, display: '$49' },
    monitor: { amount: 2900, display: '$29/month' },
    org:     { amount: 9900, display: '$99/month' },
    monitorPlanEnv: 'RAZORPAY_PLAN_USD_SINGLE',
    orgPlanEnv:     'RAZORPAY_PLAN_USD_ORG',
  }),
};

// Legacy product name -> tierId, for the priceFor()/providerFor() shims below.
const LEGACY_PRODUCT_TO_TIER_ID = { report: 'report_onetime', monitor: 'single_doctor_monthly' };
const PRODUCTS = Object.keys(LEGACY_PRODUCT_TO_TIER_ID);

/** First positive integer among the given env var names, else null. */
function envUnits(...names) {
  for (const name of names) {
    const v = parseInt(process.env[name] || '', 10);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

// Env override for a charged amount (minor units). Generic `PRICE_<TIER>_<envKey>_UNITS`
// works for every tier/product; the legacy India-only Razorpay names are tried
// FIRST for report/monitor so an existing deployment's env vars keep working
// unchanged (RAZORPAY_STARTER_AMOUNT_UNITS, RAZORPAY_MONITOR_AMOUNT_UNITS).
function envAmount(tier, envKey) {
  if (tier === 'IN' && envKey === 'REPORT') {
    const legacy = envUnits('RAZORPAY_STARTER_AMOUNT_UNITS', 'RAZORPAY_AMOUNT_UNITS');
    if (legacy) return legacy;
  }
  if (tier === 'IN' && envKey === 'MONITOR') {
    const legacy = envUnits('RAZORPAY_MONITOR_AMOUNT_UNITS');
    if (legacy) return legacy;
  }
  return envUnits(`PRICE_${tier}_${envKey}_UNITS`);
}

// Optional env override for the display string, so an emergency price change can
// keep the shown text in sync with the charged amount without a redeploy.
function envDisplay(tier, envKey) {
  return process.env[`PRICE_${tier}_${envKey}_DISPLAY`] || null;
}

function assertTier(tier) {
  if (!TIER_DEFS[tier]) throw new Error(`unknown pricing tier: ${tier}`);
}

/**
 * Every product available in one region, env overrides applied and the
 * subscription plan id resolved from its env var. Never cached — an env change
 * (and restart) takes effect on the next call, same as every other price read.
 * @returns {Array<{id,type,currency,amountMinor,displayPrice,entitlementKey,planId?,planIdEnv?,profileLimit?}>}
 */
function getTiersForRegion(region) {
  assertTier(region);
  return TIER_DEFS[region].map((t) => {
    const out = {
      id:             t.id,
      type:           t.type,
      currency:       t.currency,
      symbol:         CURRENCY_SYMBOL[t.currency] || '',
      amountMinor:    envAmount(region, t.envKey) || t.amountMinor,
      displayPrice:   envDisplay(region, t.envKey) || t.displayPrice,
      entitlementKey: t.entitlementKey,
    };
    if (t.planIdEnv) {
      out.planId = process.env[t.planIdEnv] || null;
      out.planIdEnv = t.planIdEnv; // kept for error messages ("set X in env")
    }
    if (t.profileLimit) out.profileLimit = t.profileLimit;
    return out;
  });
}

/**
 * One product in one region, by tierId. Throws if the region or tierId is
 * unknown — callers pass a tierId from a trusted source (their own request
 * validation against this same list), never directly from an unchecked client
 * value without first confirming it exists.
 */
function getTier(region, tierId) {
  const tier = getTiersForRegion(region).find((t) => t.id === tierId);
  if (!tier) throw new Error(`unknown tierId "${tierId}" for region ${region}`);
  return tier;
}

/**
 * Price for one legacy product name ('report' | 'monitor') in one tier.
 * @returns {{ amount:number, display:string, currency:string, symbol:string }}
 *   amount is in MINOR units (paise/cents) — hand this straight to Razorpay.
 */
function priceFor(tier, product) {
  if (!PRODUCTS.includes(product)) throw new Error(`unknown product: ${product}`);
  const t = getTier(tier, LEGACY_PRODUCT_TO_TIER_ID[product]);
  return { amount: t.amountMinor, display: t.displayPrice, currency: t.currency, symbol: t.symbol };
}

/**
 * Which provider handles this product for this tier.
 *   IN is always Razorpay. US/INTL default to Cashfree (lib/payments/cashfree.js,
 *   on hold) unless INTL_PAYMENT_PROVIDER=razorpay routes them to Razorpay too —
 *   the single switch lib/payments/index.js's providerNameForRegion() also reads.
 * @param {string} kind 'oneTime' (report) | 'subscription' (monitor)
 */
function providerFor(tier, kind) {
  assertTier(tier);
  if (kind !== 'oneTime' && kind !== 'subscription') throw new Error(`unknown provider kind: ${kind}`);
  if (tier === 'IN') return 'razorpay';
  return (process.env.INTL_PAYMENT_PROVIDER || '').toLowerCase() === 'razorpay' ? 'razorpay' : 'cashfree_intl';
}

/**
 * Everything the frontend needs to render prices for a tier. `bare` is the
 * symbol+amount without any "/month" suffix, for UIs that render the period
 * separately.
 */
function displayPrices(tier) {
  const list = getTiersForRegion(tier);
  const byId = Object.fromEntries(list.map((t) => [t.id, t]));
  const report  = byId.report_onetime;
  const monitor = byId.single_doctor_monthly;
  const agency  = byId.org_monthly;
  const out = {
    tier,
    currency: report.currency,
    symbol:   report.symbol,
    report:  { amount: report.amountMinor,  display: report.displayPrice,  bare: report.displayPrice.split('/')[0] },
    monitor: { amount: monitor.amountMinor, display: monitor.displayPrice, bare: monitor.displayPrice.split('/')[0] },
  };
  if (agency) {
    out.agency = {
      amount:       agency.amountMinor,
      display:      agency.displayPrice,
      bare:         agency.displayPrice.split('/')[0],
      profileLimit: agency.profileLimit,
    };
  }
  return out;
}

/**
 * Price of the org (multi-doctor) plan in one currency, or null if no region
 * charges the org plan in that currency. Same { amount, display } shape as
 * priceFor(); amount is in MINOR units. `plan` must be 'agency' (the only org
 * plan wired to a checkout) — anything else throws, so a typo fails loudly
 * instead of silently returning no price.
 */
function orgPlanPrice(plan, currency) {
  if (plan !== 'agency') throw new Error(`unknown org plan: ${plan}`);
  // IN is checked first so an INR result is preferred when (hypothetically) more
  // than one region shared a currency — today only one region maps to INR anyway.
  for (const region of ['IN', 'US', 'INTL']) {
    if (TIER_DEFS[region][0].currency !== currency) continue;
    const t = getTier(region, 'org_monthly');
    return { amount: t.amountMinor, display: t.displayPrice, currency, profileLimit: t.profileLimit };
  }
  return null;
}

// ── Backward-compat shims ────────────────────────────────────────────────────
// toMinorUnits/reportAmountUnits/monitorAmountUnits/billingCurrency are kept for
// any script or log line still calling them; nothing in the checkout/verify path
// uses billingCurrency() to decide a charge currency any more — that always
// comes from the resolved tier (see getTier()/priceFor() above).
function toMinorUnits(rupees) { return Math.round(rupees * 100); }
function reportAmountUnits()  { return priceFor('IN', 'report').amount; }
function monitorAmountUnits() { return priceFor('IN', 'monitor').amount; }
function billingCurrency()    { return TIER_DEFS.IN[0].currency; }

module.exports = {
  // new region-aware API — use this for anything new
  getTiersForRegion,
  getTier,
  // previous API — unchanged call signatures/return shapes, now views over the
  // same tier list above
  priceFor,
  providerFor,
  orgPlanPrice,
  displayPrices,
  envUnits,
  // backward-compatible shims (India tier)
  DISPLAY_REPORT_PRICE:  TIER_DEFS.IN[0].displayPrice,
  DISPLAY_MONITOR_PRICE: TIER_DEFS.IN[1].displayPrice,
  REPORT_AMOUNT_INR:     TIER_DEFS.IN[0].amountMinor / 100,
  MONITOR_AMOUNT_INR:    TIER_DEFS.IN[1].amountMinor / 100,
  BILLING_CURRENCY:      TIER_DEFS.IN[0].currency,
  toMinorUnits,
  reportAmountUnits,
  monitorAmountUnits,
  billingCurrency,
};
