'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Region-aware pricing — single source of truth for prices AND currency.
//
// The old model DISPLAYED USD but CHARGED INR, which fails US-card 3DS (the
// issuer sees a foreign merchant charging INR). The fix is structural: price
// and currency are now BOTH derived from the buyer's region tier, so the amount
// shown always equals the amount charged.
//
// AMOUNTS ARE STORED IN MINOR UNITS EVERYWHERE (paise for INR, cents for USD).
// Provider modules are responsible for converting to whatever unit their API
// wants: Razorpay takes MINOR units (paise), Cashfree takes MAJOR units
// (rupees/dollars). Never pre-convert here — hand provider code the minor value.
//
// Change prices without a redeploy via env overrides (see envAmount/envDisplay).
// ─────────────────────────────────────────────────────────────────────────────

// Per-tier pricing. provider.oneTime / provider.subscription name the payment
// provider that SHOULD handle each product for that tier. This phase does NOT
// wire new providers — Razorpay stays the only live provider — but the mapping
// is declared now so the next phase can route on it.
const TIERS = {
  // India — charged in INR via Razorpay (live mode today).
  IN: {
    currency: 'INR', symbol: '₹',
    report:  { amount: 99900,  display: '₹999' },          // one-time report (paise)
    monitor: { amount: 199900, display: '₹1,999/month' },  // subscription (paise)
    provider: { oneTime: 'razorpay', subscription: 'razorpay' },
  },
  // US + Canada — charged in USD.
  US: {
    currency: 'USD', symbol: '$',
    report:  { amount: 1900, display: '$19' },        // cents
    monitor: { amount: 4900, display: '$49/month' },  // cents
    provider: { oneTime: 'cashfree_intl', subscription: 'cashfree_intl' },
  },
  // Rest-of-world (non-EU, see lib/region.js). Same as US FOR NOW, but kept a
  // SEPARATE tier on purpose so it can diverge later without touching US.
  INTL: {
    currency: 'USD', symbol: '$',
    report:  { amount: 1900, display: '$19' },
    monitor: { amount: 4900, display: '$49/month' },
    provider: { oneTime: 'cashfree_intl', subscription: 'cashfree_intl' },
  },
};

const PRODUCTS = ['report', 'monitor'];

// ── Organization plan tiers (multi-doctor) — CONSTANTS ONLY ──────────────────
// profileLimit = how many doctor_profiles an org on this plan may hold.
// NOT wired to any checkout, route or UI yet — nothing reads these. The report /
// monitor flows (TIERS above) are untouched. The agency checkout is a later phase;
// this block exists so the price has ONE home when that phase arrives.
//
// SAME SHAPE AND UNITS AS TIERS: keyed by currency, { amount, display }, amount in
// MINOR units (paise/cents). This used to be `{ usd: 450, inr: 35999 }` in MAJOR
// units — two shapes for the same concept is how a display/charge mismatch gets
// in, so the two now match and a value can move between them without conversion.
//
// INR is HAND-SET, never converted from USD — display currency must equal the
// charged currency (a USD-priced-but-INR-charged order fails 3DS on US banks).
// USD is still the PLACEHOLDER $450/month from before, unchanged in value and
// pending the next phase; only its units were normalised (450 → 45000 cents).
//
// clinic + agency each SPREAD a FRESH copy (clinicPricing() is a factory, not a
// shared object) — separate objects, so editing one plan's price or limit can
// never leak into the other, which `agency: ORG_PLANS.clinic` would.
const clinicPricing = () => ({
  INR: { amount: 799900, display: '₹7,999/month' },  // ₹7,999/month (paise)
  USD: { amount:  45000, display: '$450/month'  },   // PLACEHOLDER, TBD (cents)
});
const ORG_PLANS = {
  solo:     { profileLimit: 1,  INR: null, USD: null, label: 'Solo' },      // existing free/solo
  clinic:   { profileLimit: 10, ...clinicPricing(), label: 'Clinic' },
  hospital: { profileLimit: 25, INR: null, USD: null, label: 'Hospital' },  // Phase 4
  agency:   { profileLimit: 10, ...clinicPricing(), label: 'Agency' },      // same price as clinic, own objects
};

/** First positive integer among the given env var names, else null. */
function envUnits(...names) {
  for (const name of names) {
    const v = parseInt(process.env[name] || '', 10);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

// Env override for a charged amount (minor units). A generic per-tier name works
// for every tier; the legacy Razorpay/India names are preserved so an existing
// deployment mid-rollout keeps working without renaming env vars.
function envAmount(tier, product) {
  const generic = envUnits(`PRICE_${tier}_${product.toUpperCase()}_UNITS`);
  if (generic) return generic;
  if (tier === 'IN' && product === 'report')  return envUnits('RAZORPAY_STARTER_AMOUNT_UNITS', 'RAZORPAY_AMOUNT_UNITS');
  if (tier === 'IN' && product === 'monitor') return envUnits('RAZORPAY_MONITOR_AMOUNT_UNITS');
  return null;
}

// Optional env override for the display string, so an emergency price change can
// keep the shown text in sync with the charged amount without a redeploy.
function envDisplay(tier, product) {
  return process.env[`PRICE_${tier}_${product.toUpperCase()}_DISPLAY`] || null;
}

function assertTier(tier) {
  if (!TIERS[tier]) throw new Error(`unknown pricing tier: ${tier}`);
}

/**
 * Price for one product in one tier.
 * @returns {{ amount:number, display:string, currency:string, symbol:string }}
 *   amount is in MINOR units (paise/cents) — hand this straight to Razorpay.
 */
function priceFor(tier, product) {
  assertTier(tier);
  if (!PRODUCTS.includes(product)) throw new Error(`unknown product: ${product}`);
  const t = TIERS[tier];
  return {
    amount:   envAmount(tier, product)  || t[product].amount,
    display:  envDisplay(tier, product) || t[product].display,
    currency: t.currency,
    symbol:   t.symbol,
  };
}

/**
 * Which provider handles this product for this tier.
 * @param {string} kind 'oneTime' (report) | 'subscription' (monitor)
 */
function providerFor(tier, kind) {
  assertTier(tier);
  const p = TIERS[tier].provider[kind];
  if (!p) throw new Error(`unknown provider kind: ${kind}`);
  return p;
}

/**
 * Everything the frontend needs to render prices for a tier. `bare` is the
 * symbol+amount without any "/month" suffix, for UIs that render the period
 * separately.
 */
function displayPrices(tier) {
  assertTier(tier);
  const report  = priceFor(tier, 'report');
  const monitor = priceFor(tier, 'monitor');
  const out = {
    tier,
    currency: TIERS[tier].currency,
    symbol:   TIERS[tier].symbol,
    report:  { amount: report.amount,  display: report.display,  bare: report.display.split('/')[0] },
    monitor: { amount: monitor.amount, display: monitor.display, bare: monitor.display.split('/')[0] },
  };
  // Agency (multi-doctor) plan, in this tier's currency, straight from ORG_PLANS
  // so the pricing page never hardcodes it. Omitted for a currency the plan has
  // no price in yet — the card then keeps its in-HTML default rather than
  // showing a wrong or empty number.
  const agency = orgPlanPrice('agency', TIERS[tier].currency);
  if (agency) {
    out.agency = {
      amount:       agency.amount,
      display:      agency.display,
      bare:         agency.display.split('/')[0],
      profileLimit: ORG_PLANS.agency.profileLimit,
    };
  }
  return out;
}

/**
 * Price of an org (multi-doctor) plan in one currency, or null if that plan has
 * no price set for it. Same { amount, display } shape as priceFor(); amount is
 * in MINOR units. This is the ONLY way anything outside this file should read an
 * ORG_PLANS price — checkout and UI both go through it, so the number has one home.
 */
function orgPlanPrice(plan, currency) {
  const p = ORG_PLANS[plan];
  if (!p) throw new Error(`unknown org plan: ${plan}`);
  const price = p[currency];
  if (!price || typeof price.amount !== 'number') return null;
  return { amount: price.amount, display: price.display, currency, profileLimit: p.profileLimit };
}

// ── Backward-compat shims ────────────────────────────────────────────────────
// Existing callers (routes/checkout.js, routes/checkout-subscription.js) used
// the old India-only exports. Keep them working, resolved against the IN tier,
// so nothing breaks in this commit. New code should use priceFor()/providerFor().
function toMinorUnits(rupees) { return Math.round(rupees * 100); }
function reportAmountUnits()  { return priceFor('IN', 'report').amount; }
function monitorAmountUnits() { return priceFor('IN', 'monitor').amount; }
function billingCurrency()    { return process.env.RAZORPAY_CURRENCY || TIERS.IN.currency; }

module.exports = {
  // new region-aware API
  TIERS,
  ORG_PLANS,          // multi-doctor org plan constants (not wired yet)
  priceFor,
  providerFor,
  orgPlanPrice,
  displayPrices,
  envUnits,
  // backward-compatible shims (India tier)
  DISPLAY_REPORT_PRICE:  TIERS.IN.report.display,
  DISPLAY_MONITOR_PRICE: TIERS.IN.monitor.display,
  REPORT_AMOUNT_INR:     TIERS.IN.report.amount / 100,
  MONITOR_AMOUNT_INR:    TIERS.IN.monitor.amount / 100,
  BILLING_CURRENCY:      TIERS.IN.currency,
  toMinorUnits,
  reportAmountUnits,
  monitorAmountUnits,
  billingCurrency,
};
