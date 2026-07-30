'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — Resources data layer (CMS-backed, Markdown fallback)

   PUBLIC API IS UNCHANGED. The same seven exports, the same synchronous
   signatures, and the same object shape per post. routes/resources.js and
   lib/sitemap.js consume this file without a single modification.

   ── Why there is a middleware ──────────────────────────────────────────────

   The four public functions are SYNCHRONOUS, and routes/resources.js calls
   them synchronously. An HTTP fetch is not synchronous, so the CMS data has to
   already be in memory by the time a handler runs.

   Rather than convert the public functions to async — which would force edits
   to every caller — this file exports `warmResources`, an Express middleware
   that awaits the CMS refresh before the handler executes. That is the only
   change server.js needs: three routes gain one middleware. Handlers, views,
   CSS, SEO and URLs are untouched.

   ── Caching ────────────────────────────────────────────────────────────────

   A 60-second TTL cache, per serverless instance. Deliberately NOT
   webhook-invalidated: each Vercel instance has its own memory, so a webhook
   reaches exactly one of them and the rest keep serving stale data. Time is
   the only invalidation signal that is correct across every instance.

   A failed refresh does NOT clear a good cache — the previous response keeps
   being served while retries happen in the background. Staleness is a designed
   state here, not an error state.

   ── Content mode ───────────────────────────────────────────────────────────

   CMS_CONTENT_MODE=merge      (default) CMS posts + Markdown posts, deduped by
                               slug, CMS winning on conflict.
   CMS_CONTENT_MODE=cms-only   CMS posts only; Markdown used strictly as a
                               failure fallback.

   `merge` is the default for one reason: content/resources/ currently holds 18
   published articles that are indexed and linked to by 301 redirects in
   server.js. Switching to cms-only before those are migrated would 404 all
   eighteen the moment the CMS answered successfully with zero posts. Flip to
   cms-only only after the migration is done and verified.
   ────────────────────────────────────────────────────────────────────────── */

const markdown = require('./resources-markdown');
const cms      = require('./cms-client');

// Re-exported verbatim so callers keep the identical helpers.
const SITE       = markdown.SITE;
const escapeHtml = markdown.escapeHtml;
const slugify    = markdown.slugify;

/**
 * The URL prefix these posts are served under.
 *
 * `/resources` is this site's existing, indexed path. It is NOT derived from
 * the CMS, so a wrong `blog_base_path` on the CMS website record can never
 * move live URLs. Overridable only for a deliberate future move.
 */
const BASE_PATH = normaliseBasePath(process.env.CMS_BASE_PATH);

/**
 * Guarantees a usable, root-relative prefix.
 *
 * Without this, `CMS_BASE_PATH=/` normalises to '' and every post would be
 * served from the site root (`/my-slug`) — silently relocating live, indexed
 * URLs. An unusable value falls back to the real path rather than guessing.
 */
function normaliseBasePath(raw) {
  let p = String(raw || '/resources').trim().replace(/\/+$/, '');
  if (!p.startsWith('/')) p = `/${p}`;
  return p === '/' || p === '' ? '/resources' : p;
}

const CACHE_TTL_MS = Number(process.env.CMS_CACHE_TTL_MS || 60_000);
const CONTENT_MODE = String(process.env.CMS_CONTENT_MODE || 'merge').toLowerCase();

/**
 * How long to wait after a failed refresh before trying again.
 *
 * Without this the queue never backs off: a failed refresh leaves `_fetchedAt`
 * untouched, so `isFresh()` stays false and EVERY subsequent request pays the
 * full CMS timeout. A CMS outage would turn an 8-second timeout into 8 seconds
 * of latency on every page view — far worse than the stale content the retry
 * was trying to avoid.
 */
const FAILURE_BACKOFF_MS = Number(process.env.CMS_FAILURE_BACKOFF_MS || 15_000);

/* ── cache state ─────────────────────────────────────────────────────────── */

let _posts = null;        // last good CMS result
let _fetchedAt = 0;       // when it was fetched
let _failedAt = 0;        // when the last attempt failed (0 = no recent failure)
let _inflight = null;     // dedupes concurrent refreshes
let _lastError = null;    // for the debug endpoint / logs

function isFresh() {
  return _posts !== null && (Date.now() - _fetchedAt) < CACHE_TTL_MS;
}

/** False while backing off from a recent failure. */
function mayAttempt() {
  return _failedAt === 0 || (Date.now() - _failedAt) >= FAILURE_BACKOFF_MS;
}

/**
 * Refreshes the CMS cache. Never throws.
 *
 * Returning a boolean rather than rethrowing is what makes requirement 3
 * structural instead of a promise: no caller has to remember a try/catch, so
 * no code path can accidentally take the site down over a CMS blip.
 */
async function refresh() {
  if (!cms.isConfigured()) {
    _lastError = 'CMS_API_URL / CMS_API_KEY not set';
    return false;
  }

  // Concurrent requests on a cold instance would otherwise each fire their own
  // fetch. Share one.
  if (_inflight) return _inflight;

  _inflight = (async () => {
    try {
      const posts = await cms.fetchAllPosts({ site: SITE, basePath: BASE_PATH });
      _posts = posts;
      _fetchedAt = Date.now();
      _failedAt = 0;
      _lastError = null;
      return true;
    } catch (err) {
      _lastError = err && err.message ? err.message : String(err);
      _failedAt = Date.now();
      // A good cache is intentionally left in place. Serving slightly stale
      // content beats serving none.
      console.warn(`[resources] CMS refresh failed, using ${_posts ? 'stale cache' : 'Markdown'}: ${_lastError}`);
      return false;
    } finally {
      _inflight = null;
    }
  })();

  return _inflight;
}

/**
 * Express middleware: makes sure CMS data is available before rendering.
 *
 * Server-side only — nothing is fetched from the browser.
 *
 * Three cases, and the distinction between them is what keeps a CMS outage from
 * becoming a site-wide latency problem:
 *
 *   fresh cache      → render immediately, no network
 *   stale cache      → render immediately from stale data, refresh BEHIND the
 *                      request. A visitor never waits for the CMS once this
 *                      instance has served anything at all.
 *   no cache at all  → must wait, because there is nothing to render yet. Only
 *                      the first request on a cold instance can hit this, and
 *                      only when a retry is actually due.
 */
function warmResources(req, res, next) {
  if (isFresh()) return next();

  // Stale but usable: serve now, revalidate in the background. Errors are
  // already swallowed inside refresh(), so nothing can reject into the void.
  if (_posts !== null) {
    if (mayAttempt()) void refresh();
    return next();
  }

  // Nothing cached. Backing off means Markdown is served instantly instead of
  // every visitor paying the CMS timeout while it is down.
  if (!mayAttempt()) return next();

  refresh().then(() => next(), () => next());
}

/* ── merging ─────────────────────────────────────────────────────────────── */

/**
 * Tags Markdown posts with their provenance without touching
 * resources-markdown.js, which is kept byte-identical to the original.
 */
function markdownPosts() {
  try {
    return markdown.getAllResources().map(p => ({ ...p, _source: 'markdown' }));
  } catch (err) {
    console.error('[resources] Markdown layer failed:', err && err.message);
    return [];
  }
}

function mergePosts(cmsPosts, mdPosts) {
  const bySlug = new Map();

  // Markdown first, then CMS overwrites — so a slug that exists in both is
  // served from the CMS, which is what makes migrating one article at a time
  // safe.
  for (const p of mdPosts) bySlug.set(p.slug, p);
  for (const p of cmsPosts) bySlug.set(p.slug, p);

  return [...bySlug.values()].sort((a, b) => b.date.sortKey - a.date.sortKey);
}

/* ── public API — signatures identical to the original ───────────────────── */

function getAllResources() {
  const cmsPosts = _posts;

  // CMS never answered on this instance: Markdown only.
  if (cmsPosts === null) return markdownPosts();

  if (CONTENT_MODE === 'cms-only') {
    // An empty CMS with cms-only would blank the site, so Markdown still
    // covers that case rather than serving an empty archive.
    return cmsPosts.length > 0 ? cmsPosts : markdownPosts();
  }

  return mergePosts(cmsPosts, markdownPosts());
}

function getResourceBySlug(slug) {
  const target = slugify(slug);
  return getAllResources().find(p => p.slug === target) || null;
}

// Related = same category first, then shared tags, then most recent.
// Logic copied from the original so ordering does not change.
function getRelated(post, limit = 3) {
  const others = getAllResources().filter(p => p.slug !== post.slug);
  const scored = others.map(p => {
    let score = 0;
    if (p.category === post.category) score += 3;
    score += p.tags.filter(t => post.tags.includes(t)).length;
    return { p, score };
  });
  scored.sort((a, b) => (b.score - a.score) || (b.p.date.sortKey - a.p.date.sortKey));
  return scored.slice(0, limit).map(s => s.p);
}

function resourceSitemapEntries() {
  return getAllResources().map(p => ({
    loc: p.canonical,
    lastmod: p.date.iso || '',
    changefreq: 'monthly',
    priority: '0.7',
  }));
}

/* ── diagnostics ─────────────────────────────────────────────────────────── */

/**
 * Where content is currently coming from. Used by the local smoke test; safe
 * to expose only behind an admin route, never publicly — it reveals the CMS
 * URL's reachability and error text.
 */
function contentStatus() {
  const posts = getAllResources();
  return {
    mode: CONTENT_MODE,
    basePath: BASE_PATH,
    cmsConfigured: cms.isConfigured(),
    cmsCached: _posts !== null,
    cmsPostCount: _posts ? _posts.length : 0,
    cacheAgeSeconds: _posts ? Math.round((Date.now() - _fetchedAt) / 1000) : null,
    cacheTtlSeconds: Math.round(CACHE_TTL_MS / 1000),
    cacheFresh: isFresh(),
    backingOff: !mayAttempt(),
    lastError: _lastError,
    totalPosts: posts.length,
    bySource: posts.reduce((acc, p) => {
      const key = p._source || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  };
}

module.exports = {
  // original exports — unchanged
  SITE,
  escapeHtml,
  slugify,
  getAllResources,
  getResourceBySlug,
  getRelated,
  resourceSitemapEntries,

  // added
  warmResources,
  refresh,
  contentStatus,
};
