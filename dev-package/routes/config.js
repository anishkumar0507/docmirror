'use strict';

require('../lib/env');

const { resolveRegion } = require('../lib/region');
const pricing = require('../lib/pricing');
const company = require('../lib/company');

function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  // CRITICAL: never cache this response. It carries region-specific prices, so a
  // cached copy could serve one region's currency/amount to a buyer in another
  // region — exactly the display-vs-charge mismatch this whole change fixes.
  res.setHeader('Cache-Control', 'no-store');

  const { tier, country, source } = resolveRegion(req);

  res.json({
    supabaseUrl:     process.env.NEXT_PUBLIC_SUPABASE_URL     || '',
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    region:    tier,
    country:   country || null,
    geoSource: source,
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
