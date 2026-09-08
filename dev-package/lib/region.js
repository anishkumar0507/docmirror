'use strict';

// env must be loaded before the module-level tier constants are read below.
require('./env');

// ─────────────────────────────────────────────────────────────────────────────
// Region resolution — decides which pricing tier a buyer belongs to.
//
// The tier drives BOTH the price and the charge currency (see lib/pricing.js).
// Display currency must always equal charge currency, so getting the tier right
// is what fixes the US-card 3DS failure (issuer sees a foreign INR charge).
//
// Precedence (most trusted last):
//   1. DEFAULT_REGION_TIER — where an undetectable visitor lands. India-first,
//      so this defaults to IN: a visitor we cannot place is quoted ₹ on Razorpay
//      rather than USD on a gateway we are not selling through yet.
//   2. Geo IP header (x-vercel-ip-country → cf-ipcountry).
//   3. An explicit region in req.body.region / req.query.region — beats geo,
//      because IP is wrong for VPN users, travellers and NRIs. IP is a hint,
//      never a lock. The explicit value is validated against the allowed tiers
//      before it is trusted, so a bad/hostile value silently falls back to geo.
//   4. FORCE_REGION_TIER — a hard override that beats ALL of the above,
//      including an explicit ?region=. See below.
//
// ── FORCE_REGION_TIER: the single-market switch ──────────────────────────────
// While we sell in ONE market, every visitor must see that market's price and be
// charged on that market's gateway — a US-priced order on the India Razorpay
// account cannot settle, so quoting USD to anyone today is quoting a price we
// cannot collect. Setting FORCE_REGION_TIER=IN makes resolveRegion ignore geo,
// headers and ?region= entirely and answer IN for everyone.
//
// This is deliberately a KILL SWITCH, not a default: TIERS.US and TIERS.INTL,
// their currencies and their provider routing are all still here and still
// correct. Unsetting FORCE_REGION_TIER at US launch re-enables them with no code
// change — which is the whole reason this is one env var and not a code edit.
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

// Read a tier from an env var, or null if unset/invalid. An invalid value is
// ignored rather than throwing: a typo in config must not take the site down.
function tierFromEnv(name) {
  const raw = String(process.env[name] || '').trim().toUpperCase();
  if (!raw) return null;
  if (!ALLOWED_TIERS.includes(raw)) {
    console.warn(`[region] ${name}="${raw}" is not one of ${ALLOWED_TIERS.join('/')} — ignoring`);
    return null;
  }
  return raw;
}

// Where a visitor lands when geo tells us nothing (no header, unknown country,
// localhost). India-first → IN. Override per environment with DEFAULT_REGION_TIER.
const DEFAULT_TIER = tierFromEnv('DEFAULT_REGION_TIER') || 'IN';

// Hard single-market override. When set, nothing else is consulted.
const FORCED_TIER = tierFromEnv('FORCE_REGION_TIER');

// Announce both ONCE at load, not per request — a per-request line would bury
// every other log on a busy instance. Each response still carries the reason in
// its `source` field ('forced' | 'explicit' | 'geo' | 'default'), so any single
// request can still be explained after the fact.
if (FORCED_TIER) {
  console.log(
    `[region] FORCE_REGION_TIER=${FORCED_TIER} — every visitor is treated as ${FORCED_TIER}. ` +
    `Geo headers and ?region= are ignored. Unset this env var to re-enable region detection.`
  );
} else {
  console.log(`[region] detection active — default tier for undetectable visitors: ${DEFAULT_TIER}`);
}

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
 *   source ∈ 'forced' | 'explicit' | 'geo' | 'default'
 */
function resolveRegion(req) {
  const country = countryFromRequest(req);

  // Single-market override — beats geo AND an explicit ?region=. The country we
  // detected is still reported, so logs show who was overridden.
  if (FORCED_TIER) {
    return { tier: FORCED_TIER, country, source: 'forced' };
  }

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

module.exports = {
  resolveRegion, countryFromRequest,
  COUNTRY_TIER, ALLOWED_TIERS, DEFAULT_TIER, FORCED_TIER,
};
