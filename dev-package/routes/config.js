'use strict';

require('../lib/env');

const { resolveRegion } = require('../lib/region');
const pricing = require('../lib/pricing');

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
  });
}

module.exports = handler;
