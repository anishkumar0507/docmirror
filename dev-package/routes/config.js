'use strict';

require('../lib/env');

const { resolveRegionForUser } = require('../lib/region');
const pricing = require('../lib/pricing');
const payments = require('../lib/payments');
const company = require('../lib/company');
const { optionalAuth } = require('../lib/auth-middleware');
const { getSupabaseClient } = require('../lib/supabase-client');

// Extract user from Bearer token if present (never blocks the request) — same
// pattern as routes/checkout.js. A logged-in returning customer then gets their
// locked billing_currency even before touching the currency switcher.
function getOptionalUser(req) {
  return new Promise((resolve) => {
    optionalAuth(req, {}, () => resolve(req.user || null));
  });
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  // CRITICAL: never cache this response. It carries region-specific prices, so a
  // cached copy could serve one region's currency/amount to a buyer in another
  // region — exactly the display-vs-charge mismatch this whole change fixes.
  res.setHeader('Cache-Control', 'no-store');

  const user = await getOptionalUser(req);
  const { tier, country, source } = await resolveRegionForUser(req, user?.id || null, getSupabaseClient());

  res.json({
    supabaseUrl:     process.env.NEXT_PUBLIC_SUPABASE_URL     || '',
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    region:    tier,
    country:   country || null,
    geoSource: source,
    // Which checkout the frontend should open for this region — the single
    // region→provider map in lib/payments (IN → razorpay, else → cashfree).
    provider:  payments.providerNameForRegion(tier),
    // Cashfree JS SDK mode (sandbox|production) — mirrors CASHFREE_ENV. Not a
    // secret; the frontend needs it to initialise the SDK.
    cashfreeMode: (process.env.CASHFREE_ENV === 'production') ? 'production' : 'sandbox',
    prices:    pricing.displayPrices(tier),
    // Owning legal entity (single source of truth: lib/company.js). The browser
    // fills [data-company] elements + the footer from this; empty address/phone
    // are carried as empty strings and MUST be omitted by the consumer.
    company: {
      legalEntity:        company.LEGAL_ENTITY,
      legalEntityDisplay: company.LEGAL_ENTITY_DISPLAY,
      supportEmail:       company.SUPPORT_EMAIL,
      registeredAddress:  company.REGISTERED_ADDRESS,
      supportPhone:       company.SUPPORT_PHONE,
    },
  });
}

module.exports = handler;
