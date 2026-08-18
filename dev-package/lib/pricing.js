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
    report:  { amount: 182800, display: '₹1,828' },        // one-time report (paise)
    monitor: { amount: 471500, display: '₹4,715/month' },  // subscription (paise)
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
// These are PLACEHOLDER prices (TBD) and are NOT wired to any checkout or UI —
// nothing reads them yet. The existing $19 report / $49 monitor flows (TIERS
// above) are untouched. Amounts here are MAJOR units (whole dollars / rupees),
// unlike TIERS which are minor units; they'll be normalized when a real
// multi-doctor checkout is wired in a later phase.
const ORG_PLANS = {
  solo:     { profileLimit: 1,  usd: null, inr: null   },                 // existing free/solo
  clinic:   { profileLimit: 10, usd: 150,  inr: 11999  },                 // PLACEHOLDER, TBD
  hospital: { profileLimit: 25, usd: null, inr: null   },                 // Phase 4
  agency:   { profileLimit: 10, usd: 150,  inr: 11999  },                 // PLACEHOLDER, TBD
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
  return {
    tier,
    currency: TIERS[tier].currency,
    symbol:   TIERS[tier].symbol,
    report:  { amount: report.amount,  display: report.display,  bare: report.display.split('/')[0] },
    monitor: { amount: monitor.amount, display: monitor.display, bare: monitor.display.split('/')[0] },
  };
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
