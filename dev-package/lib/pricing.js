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
const REPORT_AMOUNT_INR  = 1599;  // one-time Doctor Visibility Report
const MONITOR_AMOUNT_INR = 4199;  // Monitor subscription / month (amount is defined by the Razorpay live plan)

// India-only live mode. Do NOT use the USD flow right now.
const BILLING_CURRENCY = 'INR';

// Razorpay charges in the smallest currency unit (paise for INR).
function toMinorUnits(rupees) { return Math.round(rupees * 100); }

/**
 * One-time report order amount, in the smallest currency unit (paise).
 * Env override (RAZORPAY_AMOUNT_UNITS) wins so ops can adjust without a deploy;
 * otherwise it is derived from REPORT_AMOUNT_INR. Never falls back to a test value.
 */
function reportAmountUnits() {
  const env = parseInt(process.env.RAZORPAY_AMOUNT_UNITS || '', 10);
  return Number.isFinite(env) && env > 0 ? env : toMinorUnits(REPORT_AMOUNT_INR);
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
  billingCurrency,
};
