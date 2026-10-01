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
//      including an explicit ?region=. NON-PRODUCTION ONLY — ignored outright
//      when NODE_ENV === 'production'. See below.
//
// ── FORCE_REGION_TIER: the single-market switch (non-production only) ────────
// Before both markets were live, every visitor had to see one market's price and
// be charged on that market's gateway — a US-priced order on the India Razorpay
// account cannot settle. Setting FORCE_REGION_TIER=IN made resolveRegion ignore
// geo, headers and ?region= entirely and answer IN for everyone.
//
// NEVER honored when NODE_ENV === 'production' (see IS_PRODUCTION below) — both
// markets are live now, so a production instance must always resolve region for
// real; this var only remains useful for forcing a tier in local/staging testing.
// If it's set in production anyway, it's ignored and a startup warning is logged
// rather than silently mispricing/mischarging every visitor.
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

// profiles.billing_currency (migration 028) -> the tier a LOCKED customer stays
// on. USD collapses to US (not INTL) — US and INTL charge identically today, and
// a lock only needs to reproduce the currency/amount/plan the customer's live
// subscription actually bills, not which of the two USD tiers first quoted them.
const CURRENCY_TO_LOCKED_TIER = { INR: 'IN', USD: 'US' };

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

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Hard single-market override. When set, nothing else is consulted.
// NEVER honored in production — a single-market kill switch is a dev/staging
// convenience for forcing a tier locally; in production it must never be able
// to override a paying customer's locked currency or a real visitor's geo/
// switcher-resolved region (that would silently misquote/mischarge them).
const FORCED_TIER_RAW = tierFromEnv('FORCE_REGION_TIER');
const FORCED_TIER = IS_PRODUCTION ? null : FORCED_TIER_RAW;

// Announce both ONCE at load, not per request — a per-request line would bury
// every other log on a busy instance. Each response still carries the reason in
// its `source` field ('forced' | 'explicit' | 'geo' | 'default'), so any single
// request can still be explained after the fact.
if (IS_PRODUCTION && FORCED_TIER_RAW) {
  console.warn(
    `[region] WARNING: FORCE_REGION_TIER=${FORCED_TIER_RAW} is set but NODE_ENV=production — ` +
    `IGNORING it. This env var must never override region resolution in production. Unset it to silence this warning.`
  );
} else if (FORCED_TIER) {
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

/**
 * Read a user's locked billing currency, or null if they have none set yet
 * (never paid, or paid before this migration/column existed). Never throws —
 * a lookup failure degrades to "no lock" rather than blocking region resolution.
 */
async function lockedTierForUser(userId, supabase) {
  if (!userId || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from('profiles').select('billing_currency').eq('id', userId).maybeSingle();
    if (error || !data || !data.billing_currency) return null;
    return CURRENCY_TO_LOCKED_TIER[data.billing_currency] || null;
  } catch (e) {
    console.warn(`[region] billing_currency lookup warn userId=${userId}: ${e.message}`);
    return null;
  }
}

/**
 * Resolve the buyer's pricing tier, honouring a paid customer's currency lock.
 * Priority: FORCE_REGION_TIER > profiles.billing_currency (if userId is a
 * logged-in user who has paid before) > explicit switcher (?region=/body.region,
 * i.e. resolveRegion's own precedence) > geo > default.
 *
 * `userId` must come from a server-verified auth token (requireAuth/optionalAuth
 * req.user.id) — never from the request body. `supabase` is passed in rather
 * than re-imported here so this module has no hard dependency on the Supabase
 * client existing (region resolution must never fail just because auth/db did).
 *
 * @returns {Promise<{ tier: 'IN'|'US'|'INTL', country: string|null, source: string }>}
 *   source ∈ 'forced' | 'locked' | 'explicit' | 'geo' | 'default'
 */
async function resolveRegionForUser(req, userId, supabase) {
  if (FORCED_TIER) {
    return { tier: FORCED_TIER, country: countryFromRequest(req), source: 'forced' };
  }
  const locked = await lockedTierForUser(userId, supabase);
  if (locked) {
    return { tier: locked, country: countryFromRequest(req), source: 'locked' };
  }
  return resolveRegion(req);
}

module.exports = {
  resolveRegion, resolveRegionForUser, countryFromRequest,
  COUNTRY_TIER, ALLOWED_TIERS, DEFAULT_TIER, FORCED_TIER, CURRENCY_TO_LOCKED_TIER,
};
