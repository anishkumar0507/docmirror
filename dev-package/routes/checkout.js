'use strict';

require('../lib/env');

const pricing    = require('../lib/pricing');
const payments   = require('../lib/payments');
const { resolveRegion } = require('../lib/region');
const auditCache = require('../lib/audit-cache');
const paidReports = require('../lib/paid-reports');
const { verifyAuditCacheTable, getSupabaseClient } = require('../lib/supabase-client');
const { optionalAuth } = require('../lib/auth-middleware');

// Extract user from Bearer token if present (never blocks the request)
async function getOptionalUser(req) {
  return new Promise(resolve => {
    req._optResolve = resolve;
    optionalAuth(req, {}, () => resolve(req.user || null));
  });
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let { email, auditData } = req.body || {};

  // Resolve logged-in user (optional — backward compatible with the anonymous
  // scan-first flow, where auditData is always present).
  const user   = await getOptionalUser(req);
  const userId = user?.id || null;

  // Two shapes:
  //   • auditData present  — the ANONYMOUS scan-first report purchase (unchanged):
  //     a free scan already ran, its result is cached now, the report is
  //     auto-generated the instant the payment verifies. No login required.
  //   • auditData absent   — the buy-first, redeem-later report credit
  //     (lib/report-credits.js): nothing to cache yet, no doctor chosen yet.
  //     Requires a logged-in account (never anonymous — a credit has to belong
  //     to someone) so verify-payment.js can grant the credit to a real user.
  if (!auditData) {
    if (!user) return res.status(401).json({ error: 'Sign in to buy a report credit.', code: 'AUTH_REQUIRED' });
    if (!email) email = user.email || '';
  }
  if (!email) return res.status(400).json({ error: 'email is required' });

  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return res.status(500).json({ error: 'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not configured' });
  }

  try {
    if (auditData) {
      const tableCheck = await verifyAuditCacheTable();
      if (!tableCheck.ok) {
        console.error('[checkout] audit_cache not ready:', tableCheck.message);
        return res.status(503).json({
          error: 'Audit storage temporarily unavailable. Please try again in a moment.',
          code: tableCheck.code || 'TABLE_INACCESSIBLE',
        });
      }
    }

    const auditId = `tdm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    console.log(`[checkout] created auditId=${auditId} format_valid=${auditCache.isValidAuditId(auditId)} hasAuditData=${!!auditData}`);

    if (auditData) {
      // MUST complete before Razorpay order — throws if Supabase write fails
      const cached = await auditCache.set(auditId, auditData);
      console.log(
        `[checkout] audit_cache persisted cache_key=${cached.cache_key} doctor=${cached.doctorName || '(unknown)'}`
      );
    }

    // Amount + currency + provider now all depend on the buyer's region, so the
    // displayed price always equals the charged price (fixes US-card 3DS
    // failures) and the right gateway is used. tierId is accepted from the
    // client for forward-compatibility (STEP 4) but there is only one one-time
    // tier today, so an absent/wrong value just falls back to it rather than
    // failing a request nothing currently sends a tierId on.
    const region  = resolveRegion(req);
    const tierId  = (req.body && req.body.tierId) || 'report_onetime';
    let tier;
    try {
      tier = pricing.getTier(region.tier, tierId);
    } catch (e) {
      return res.status(400).json({ error: 'Unknown pricing tier', code: 'UNKNOWN_TIER' });
    }
    if (tier.type !== 'one_time') {
      return res.status(400).json({ error: 'That tierId is not a one-time purchase', code: 'WRONG_TIER_TYPE' });
    }
    const amountUnits = tier.amountMinor;
    const currency    = tier.currency;

    // This route is Razorpay-only. For a region whose provider is Cashfree (see
    // lib/payments/index.js providerNameForRegion — the default for US/INTL
    // unless INTL_PAYMENT_PROVIDER=razorpay), the frontend calls
    // /api/payments/cashfree/create-order instead and never reaches here; this
    // is a defensive check against a stale frontend or a direct API call, so a
    // request never gets charged on the wrong gateway.
    const provider = payments.providerNameForRegion(region.tier);
    if (provider !== 'razorpay') {
      return res.status(409).json({
        error: `This region (${region.tier}) is served by ${provider}, not Razorpay.`,
        code: 'WRONG_PROVIDER',
        provider,
      });
    }

    console.log(
      `[checkout] pricing region=${region.tier} country=${region.country || '?'} ` +
      `source=${region.source} tierId=${tierId} amount=${amountUnits} currency=${currency}`
    );

    // Record what we are about to sell BEFORE creating the Razorpay order, so
    // verify-payment.js has an authoritative (server-written, not client-
    // suppliable) expected amount/currency to compare Razorpay's own payment
    // record against — the three-factor check.
    await paidReports.insertPending({
      auditId, email, userId,
      tierId, currency, amountUnits,
      regionTier: region.tier, country: region.country || null,
    });

    // Razorpay order creation lives in lib/payments/razorpay.js (same SDK call,
    // same notes).
    const order = await payments.get('razorpay').createOrder({
      amountUnits,
      currency,
      auditId,
      email,
      customer: { region: region.tier, country: region.country || '' },
    });

    console.log(
      `[checkout] Razorpay order=${order.orderId} auditId=${auditId} ` +
      `receipt=${order.receipt} email=${email}`
    );

    return res.json({
      orderId:    order.orderId,
      amount:     order.amountUnits,
      currency:   order.currency,
      keyId,
      auditId,
      region:     region.tier,
      doctorName: (auditData && auditData.doctorName) || '',
    });

  } catch (err) {
    if (err.name === 'AuditCacheError') {
      console.error(`[checkout] audit_cache error code=${err.code}:`, err.message);
      return res.status(503).json({
        error: 'Could not save audit data before payment. Please retry.',
        code: err.code,
        cache_key: err.details?.cache_key,
        detail: err.message,
      });
    }
    console.error('[checkout] error:', err.message);
    return res.status(500).json({ error: 'Checkout failed: ' + err.message });
  }
}

module.exports = handler;
