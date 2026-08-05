'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — CMS content source

   Loads publicly-eligible rows from blog_posts and maps them into the same
   object shape lib/resources-markdown.js produces, so lib/resources.js can
   merge the two without either side knowing about the other.

   ── The eligibility rule ──────────────────────────────────────────────────
       status IN ('published', 'scheduled') AND published_at <= now()

   Evaluated at READ TIME against the database clock, which is what makes
   scheduling work with no cron, no build and no deploy: a post scheduled for
   10:00 simply starts matching the query at 10:00. Nothing flips a row.

   Note this is deliberately WIDER than the blog_posts_public view from
   migration 018, which covers status='published' only. Using that view would
   have meant a scheduled post stayed invisible until something mutated its
   status — exactly the cron this design avoids. The view is left untouched;
   see the Step I report for the optional migration that would realign it.

   ── Never public ──────────────────────────────────────────────────────────
   draft, archived, and scheduled-for-later rows never match the query, so
   they are absent from the listing, the article routes, the sitemap and
   related-post resolution by construction — not by a filter someone has to
   remember to repeat.

   ── Failure ───────────────────────────────────────────────────────────────
   Every failure path degrades to "no CMS posts", never to an exception. If
   Supabase is unreachable, /resources keeps serving the Markdown articles.
   ────────────────────────────────────────────────────────────────────────── */

// Required as a module rather than destructured so the accessor is resolved at
// call time. Destructuring would freeze the reference at load, which also makes
// the outage path impossible to exercise in a test.
const supabaseClient = require('./supabase-client');
const { mapRow, isPublic } = require('./blog-post-mapper');

const getSupabaseClient = () => supabaseClient.getSupabaseClient();
const formatFetchError  = (e) => supabaseClient.formatFetchError(e);

// Statuses that can ever face the public. Scheduled is included because the
// published_at comparison below is what actually gates it.
const PUBLISHABLE = ['published', 'scheduled'];

// How long a fetched set is served before a refresh is attempted. This is the
// worst-case delay between an admin pressing Publish and the article appearing.
const TTL_MS = Math.max(parseInt(process.env.RESOURCES_CMS_TTL_MS, 10) || 60_000, 5_000);

// After a failure, how long before another attempt. Without this, an outage
// would make every single request pay the full Supabase timeout.
const FAILURE_BACKOFF_MS = Math.max(parseInt(process.env.RESOURCES_CMS_BACKOFF_MS, 10) || 15_000, 1_000);

// A ceiling so a runaway table cannot blow up memory or response time. If it is
// ever reached the archive is silently truncated, so it logs loudly instead.
const MAX_POSTS = 500;

let _posts = [];          // last known-good mapped set
let _loadedAt = 0;        // when that set was fetched (0 = never)
let _attemptedAt = 0;     // when a fetch was last attempted, success or not
let _inflight = null;     // shared promise so concurrent cold requests fetch once
let _lastError = null;
let _collisionsLogged = new Set();

/**
 * The CMS source is on when Supabase is configured, unless explicitly disabled.
 * RESOURCES_CMS_ENABLED=false is the instant rollback: set it, redeploy, and
 * the public site is Markdown-only again with no code change.
 */
function isEnabled() {
  if (String(process.env.RESOURCES_CMS_ENABLED || '').toLowerCase() === 'false') return false;
  return !!getSupabaseClient();
}

function isFresh() {
  return _loadedAt > 0 && (Date.now() - _loadedAt) < TTL_MS;
}

function inBackoff() {
  return _attemptedAt > 0 && (Date.now() - _attemptedAt) < FAILURE_BACKOFF_MS;
}

/** Fetch + map. Resolves to true on success, false on any failure — never throws. */
async function load() {
  const supabase = getSupabaseClient();
  if (!supabase) return false;

  const startedAt = Date.now();
  _attemptedAt = startedAt;

  try {
    // select('*') rather than a column list: this read sits on the public hot
    // path, and a column added by a future migration must never be able to
    // break the live site. The mapper reads only the fields it knows.
    const { data, error } = await supabase
      .from('blog_posts')
      .select('*')
      .in('status', PUBLISHABLE)
      .lte('published_at', new Date().toISOString())
      .order('published_at', { ascending: false })
      .limit(MAX_POSTS);

    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('blog_posts returned a non-array payload');

    if (data.length >= MAX_POSTS) {
      console.warn(`[resources-db] hit the ${MAX_POSTS}-post ceiling — raise MAX_POSTS before the archive grows further`);
    }

    const mapped = [];
    for (const row of data) {
      // Belt and braces: the query already excludes anything not eligible, but
      // the rule is re-checked in code so a future query edit cannot leak a
      // draft. Cheap, and this is the one place where a mistake is public.
      if (!isPublic(row)) {
        console.warn(`[resources-db] dropping row that passed the query but failed isPublic: ${row.slug}`);
        continue;
      }
      if (!row.slug) continue;
      mapped.push(mapRow(row));
    }

    _posts = mapped;
    _loadedAt = Date.now();
    _lastError = null;
    console.log(`[resources-db] loaded ${mapped.length} public CMS post(s) in ${Date.now() - startedAt}ms`);
    return true;

  } catch (err) {
    _lastError = err;
    console.error(
      `[resources-db] load FAILED after ${Date.now() - startedAt}ms — ` +
      `serving ${_posts.length ? 'the last good set' : 'Markdown only'}: ${formatFetchError(err)}`
    );
    return false;
  }
}

/**
 * Called by warmResources before every resource request.
 *
 * Returns a Promise ONLY when there is nothing usable in memory yet — i.e. the
 * very first request on a cold instance. Once anything is cached, a stale set
 * is served immediately and the refresh runs behind the response, so no visitor
 * ever waits on Supabase for a page that could already have been rendered.
 */
function refresh() {
  if (!isEnabled()) return null;
  if (isFresh()) return null;

  if (!_inflight) {
    if (inBackoff() && _loadedAt === 0) return null;   // outage, nothing cached → Markdown now
    if (inBackoff() && _loadedAt > 0) return null;     // outage, stale data → serve it
    _inflight = load().finally(() => { _inflight = null; });
  }

  // Something usable is already in memory: hand it over now, refresh behind.
  if (_loadedAt > 0) return null;

  return _inflight;
}

/** The cached set. Always an array; never throws; never contains a draft. */
function getPosts() {
  if (!isEnabled()) return [];
  return _posts;
}

function getBySlug(slug) {
  if (!isEnabled() || !slug) return null;
  return _posts.find((p) => p.slug === slug) || null;
}

/** Diagnostics for the Step I verification suite and future admin tooling. */
function status() {
  return {
    enabled: isEnabled(),
    posts: _posts.length,
    loadedAt: _loadedAt ? new Date(_loadedAt).toISOString() : null,
    fresh: isFresh(),
    ttlMs: TTL_MS,
    backoffMs: FAILURE_BACKOFF_MS,
    lastError: _lastError ? (_lastError.message || String(_lastError)) : null,
  };
}

/** Test seam: lets the verification suite exercise merge/sort without a network. */
function _setPostsForTest(posts) {
  _posts = Array.isArray(posts) ? posts : [];
  _loadedAt = posts && posts.length ? Date.now() : 0;
  _lastError = null;
}
function _reset() {
  _posts = []; _loadedAt = 0; _attemptedAt = 0; _inflight = null; _lastError = null;
  _collisionsLogged = new Set();
}

/** One warning per colliding slug per process, so logs stay readable. */
function noteCollision(slug) {
  if (_collisionsLogged.has(slug)) return;
  _collisionsLogged.add(slug);
  console.warn(
    `[resources-db] slug collision on "${slug}" — a Markdown article already owns this URL, ` +
    'so the CMS post is not served. Give the CMS post a different slug, or migrate the ' +
    'Markdown article deliberately.'
  );
}

module.exports = {
  isEnabled, refresh, getPosts, getBySlug, status, noteCollision,
  PUBLISHABLE, TTL_MS, FAILURE_BACKOFF_MS,
  _setPostsForTest, _reset, _load: load,
};
