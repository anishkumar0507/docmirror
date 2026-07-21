'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Centralized pricing config — single source of truth for prices.
//
// DISPLAY prices are MARKETING ONLY (the USD figures shown on the website
// pricing cards). BILLING amounts are what Razorpay actually charges (INR,
// India live mode). They are intentionally DECOUPLED: until international (USD)
// payments are enabled, the site DISPLAYS USD but CHARGES INR via Razorpay.
//
// To switch regions later (India → INR  /  International → USD) change ONLY this
// file — no UI component and no route logic needs to change.
// ─────────────────────────────────────────────────────────────────────────────

// Display price (marketing) — must match the pricing cards on the website.
const DISPLAY_REPORT_PRICE  = '$19';
const DISPLAY_MONITOR_PRICE = '$49/month';

// Actual India billing (Razorpay live, INR).
const REPORT_AMOUNT_INR  = 1828;  // one-time Doctor Visibility Report ($19 plan)
// Monitor subscription / month ($49 plan). NOTE: this figure is for display,
// metadata and reconciliation only — the amount Razorpay actually charges is
// fixed on the Razorpay Plan referenced by RAZORPAY_MONITOR_PLAN_ID. Razorpay
// does not allow editing a plan's price, so changing this constant WITHOUT
// creating a new plan and updating that env var will NOT change what customers
// are billed.
const MONITOR_AMOUNT_INR = 4715;

// India-only live mode. Do NOT use the USD flow right now.
const BILLING_CURRENCY = 'INR';

// Razorpay charges in the smallest currency unit (paise for INR).
function toMinorUnits(rupees) { return Math.round(rupees * 100); }

/** First positive integer among the given env var names, else null. */
function envUnits(...names) {
  for (const name of names) {
    const v = parseInt(process.env[name] || '', 10);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

/**
 * One-time report (Starter, $19) order amount in the smallest currency unit
 * (paise). This IS the amount charged — it is sent to razorpay.orders.create.
 *
 * Precedence: RAZORPAY_STARTER_AMOUNT_UNITS, then the legacy
 * RAZORPAY_AMOUNT_UNITS (kept so an existing deployment does not break mid
 * rollout), then REPORT_AMOUNT_INR. Never falls back to a test value.
 */
function reportAmountUnits() {
  return envUnits('RAZORPAY_STARTER_AMOUNT_UNITS', 'RAZORPAY_AMOUNT_UNITS')
    || toMinorUnits(REPORT_AMOUNT_INR);
}

/**
 * Monitor ($49) subscription amount in paise.
 *
 * This is NOT sent to Razorpay — a subscription is billed at whatever price is
 * baked into its Plan. Use it for display, notes/metadata and reconciliation,
 * and keep it in sync with the live plan.
 */
function monitorAmountUnits() {
  return envUnits('RAZORPAY_MONITOR_AMOUNT_UNITS') || toMinorUnits(MONITOR_AMOUNT_INR);
}

/** Billing currency (env override wins; defaults to INR for India live mode). */
function billingCurrency() {
  return process.env.RAZORPAY_CURRENCY || BILLING_CURRENCY;
}

module.exports = {
  DISPLAY_REPORT_PRICE,
  DISPLAY_MONITOR_PRICE,
  REPORT_AMOUNT_INR,
  MONITOR_AMOUNT_INR,
  BILLING_CURRENCY,
  toMinorUnits,
  reportAmountUnits,
  monitorAmountUnits,
  billingCurrency,
};
