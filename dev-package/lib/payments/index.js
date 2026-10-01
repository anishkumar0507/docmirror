'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Payment-provider registry + region routing.
//
//   get(name)                  → the provider module registered under `name`
//   providerNameForRegion(reg) → SINGLE source of truth for which provider a
//                                region uses (IN → razorpay, else → cashfree)
//   forRegion(region[, kind])  → the provider module for a region
//
// Provider modules are NOT polymorphic — Razorpay and Cashfree each expose a
// provider-specific interface and have their own dedicated routes
// (routes/checkout*.js and routes/cashfree-*.js). This registry just resolves a
// name/region to the right module; callers use that module's own methods.
// ─────────────────────────────────────────────────────────────────────────────

const razorpay = require('./razorpay');

// Cashfree is WIP/on hold and not part of every deploy (see docs/cashfree/) —
// loaded lazily so a deploy that omits lib/payments/cashfree.js still boots;
// it only throws if something actually tries to use the cashfree provider,
// which production never should once INTL_PAYMENT_PROVIDER=razorpay is set
// (see providerFor() in lib/pricing.js).
let _cashfree; // undefined = not yet attempted, null = attempted and unavailable
function loadCashfree() {
  if (_cashfree === undefined) {
    try {
      _cashfree = require('./cashfree');
    } catch (e) {
      _cashfree = null;
      console.warn(`[payments] cashfree module unavailable (${e.message}) — fine as long as INTL_PAYMENT_PROVIDER=razorpay`);
    }
  }
  return _cashfree;
}

// SINGLE routing switch. India (INR) → Razorpay always. Everything else (USD)
// defaults to Cashfree (on hold — see docs/cashfree/) UNLESS
// INTL_PAYMENT_PROVIDER=razorpay, which routes US/INTL to Razorpay's own USD
// checkout (routes/checkout*.js + lib/pricing.js US/INTL tiers) instead. Read
// from env on every call, not cached, so flipping the switch needs no restart.
//
// PayPal is deliberately NOT on this default path — Cashfree/Razorpay-USD
// supersede it. A PayPal provider would only ever be used if explicitly
// requested by name via get('paypal'). (No PayPal module currently exists.)
const PROVIDER_BY_REGION = {
  IN: 'razorpay',
};

function intlDefaultProvider() {
  return (process.env.INTL_PAYMENT_PROVIDER || '').toLowerCase() === 'razorpay'
    ? 'razorpay'
    : 'cashfree';
}

/** The provider NAME for a region — the one place region→provider is decided. */
function providerNameForRegion(region) {
  return PROVIDER_BY_REGION[region] || intlDefaultProvider();
}

function get(name) {
  if (name === 'razorpay') return razorpay;
  // 'cashfree_intl' is pricing.js's TIERS label for the USD tiers' back-compat name.
  if (name === 'cashfree' || name === 'cashfree_intl') {
    const cf = loadCashfree();
    if (!cf) throw new Error('cashfree payment provider is not available in this deployment');
    return cf;
  }
  throw new Error(`unknown payment provider: ${name}`);
}

/** Resolve the provider MODULE for a region. `kind` is accepted for call-site
 *  clarity but does not change selection — a region maps to one provider. */
function forRegion(region, kind) { // eslint-disable-line no-unused-vars
  return get(providerNameForRegion(region));
}

module.exports = { get, forRegion, providerNameForRegion, PROVIDER_BY_REGION, intlDefaultProvider };
