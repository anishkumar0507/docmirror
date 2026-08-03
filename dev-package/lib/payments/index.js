'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Payment-provider registry.
//
//   get(name)            → the provider module registered under `name`
//   forRegion(tier,kind) → the provider for a pricing tier + product kind,
//                          resolved via pricing.providerFor()
//
// Every provider module implements the same interface:
//   createOrder({ amountUnits, currency, auditId, email, customer })
//   verifyOrder({ orderId, paymentId, signature, expectedUnits, expectedCurrency })
//       → { ok, auditId, paymentId, amountUnits, currency, reason? }
//   createSubscription({ email, auditId, regionTier })
//   verifySubscription({ subscriptionId })
//   cancelSubscription(subscriptionId)
//   verifyWebhook(req, rawBody) → { ok, event }
//
// (The Razorpay module accepts a few extra optional fields on some calls — e.g.
// clientAuditId, planId, country — documented in that module; they are supersets
// of the interface, so callers written to the interface still work.)
// ─────────────────────────────────────────────────────────────────────────────

const pricing = require('../pricing');
const razorpay = require('./razorpay');

// Providers wired today. Cashfree International is intentionally NOT registered
// yet — its module is pending the Cashfree API docs (docs/cashfree/). Until then
// get('cashfree_intl') throws a clear, actionable error rather than silently
// falling back to Razorpay (which would charge the wrong currency).
const REGISTRY = {
  razorpay,
};

function get(name) {
  const provider = REGISTRY[name];
  if (provider) return provider;
  if (name === 'cashfree_intl') {
    throw new Error(
      'payment provider "cashfree_intl" is not implemented yet — pending Cashfree API docs (docs/cashfree/). ' +
      'Indian (Razorpay) checkout is unaffected.'
    );
  }
  throw new Error(`unknown payment provider: ${name}`);
}

/** Provider for a pricing tier + kind ('oneTime' | 'subscription'). */
function forRegion(tier, kind) {
  return get(pricing.providerFor(tier, kind));
}

module.exports = { get, forRegion };
