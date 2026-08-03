'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Region resolution — decides which pricing tier a buyer belongs to.
//
// The tier drives BOTH the price and the charge currency (see lib/pricing.js).
// Display currency must always equal charge currency, so getting the tier right
// is what fixes the US-card 3DS failure (issuer sees a foreign INR charge).
//
// Precedence (most trusted last):
//   1. Geo IP header (x-vercel-ip-country → cf-ipcountry) — a DEFAULT only.
//   2. An explicit region in req.body.region / req.query.region — ALWAYS wins,
//      because IP is wrong for VPN users, travellers and NRIs. IP is a hint,
//      never a lock. The explicit value is validated against the allowed tiers
//      before it is trusted, so a bad/hostile value silently falls back to geo.
// ─────────────────────────────────────────────────────────────────────────────

// Country (ISO 3166-1 alpha-2) → pricing tier.
//   IN   → charge INR via Razorpay (India live mode).
//   US   → charge USD (US + Canada share the USD tier for now).
//   INTL → charge USD too, but kept a SEPARATE tier so it can diverge later
//          (e.g. GBP/AUD/local pricing) without touching the US tier.
//
// NOTE: EU countries are deliberately OMITTED for now. Selling into the EU
// creates VAT/OSS collection obligations we are not set up to handle yet, so an
// EU buyer falls through to INTL (USD) rather than getting a dedicated EU tier.
// Add them here only once VAT handling exists.
const COUNTRY_TIER = {
  IN: 'IN',
  US: 'US', CA: 'US',
  GB: 'INTL', IE: 'INTL', AU: 'INTL', NZ: 'INTL',
  SG: 'INTL', AE: 'INTL', SA: 'INTL', QA: 'INTL',
};

// The tiers a client is allowed to force explicitly.
const ALLOWED_TIERS = ['IN', 'US', 'INTL'];

// Unknown / missing / unmapped country defaults here.
const DEFAULT_TIER = 'INTL';

/**
 * Raw country code from the request's geo headers, uppercased, or null.
 * Vercel sets x-vercel-ip-country; Cloudflare sets cf-ipcountry. We read
 * headers directly (not req.ip) so `trust proxy` config is irrelevant.
 */
function countryFromRequest(req) {
  const headers = (req && req.headers) || {};
  const raw = headers['x-vercel-ip-country'] || headers['cf-ipcountry'] || '';
  const code = String(raw).trim().toUpperCase();
  // Cloudflare uses 'XX' / 'T1' for unknown/Tor; treat those as no country.
  if (!code || code.length !== 2 || code === 'XX' || code === 'T1') return null;
  return code;
}

/**
 * Resolve the buyer's pricing tier.
 * @returns {{ tier: 'IN'|'US'|'INTL', country: string|null, source: string }}
 *   source ∈ 'explicit' | 'geo' | 'default'
 */
function resolveRegion(req) {
  const country = countryFromRequest(req);

  // Explicit override (body wins over query) — validated against ALLOWED_TIERS.
  const explicitRaw =
    (req && req.body && req.body.region) ||
    (req && req.query && req.query.region) || '';
  const explicit = String(explicitRaw).trim().toUpperCase();
  if (explicit && ALLOWED_TIERS.includes(explicit)) {
    return { tier: explicit, country, source: 'explicit' };
  }

  // Geo default.
  if (country && COUNTRY_TIER[country]) {
    return { tier: COUNTRY_TIER[country], country, source: 'geo' };
  }

  // Unknown / unmapped country.
  return { tier: DEFAULT_TIER, country, source: 'default' };
}

module.exports = { resolveRegion, countryFromRequest, COUNTRY_TIER, ALLOWED_TIERS, DEFAULT_TIER };
