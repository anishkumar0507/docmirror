'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   GET /api/admin/options

   Everything the editor needs to populate its dropdowns, without hardcoding
   anything that already exists somewhere authoritative:

     categories   ← blog_categories (empty is a valid, handled state)
     authors      ← the authors actually used by the live articles
     site/basePath← lib/resources, the same constants the renderer uses
     upload limits← the same policy migration 020 put on the bucket

   Behind requireAuth + requireAdmin via the /api/admin mount in server.js.
   ────────────────────────────────────────────────────────────────────────── */

require('../../lib/env');
const { getSupabaseClient, withSupabaseRetry } = require('../../lib/supabase-client');
const { SITE, getAllResources } = require('../../lib/resources');
const { BASE_PATH } = require('../../lib/blog-post-mapper');

// Mirrors the bucket configuration in migration 020. Sent to the browser so the
// editor can reject an oversized or wrong-typed file before uploading it —
// the server and the bucket both re-check, this is only to save the round trip.
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_UPLOAD_BYTES = 5242880;          // 5 MB, = OG_MAX_BYTES
const OG_MIN_WIDTH = 1200;
const OG_MIN_HEIGHT = 630;

// Offered in the publish-time picker. Asia/Kolkata leads because that is where
// the team schedules from; the others cover the article audience.
const TIMEZONES = [
  { id: 'Asia/Kolkata',      label: 'India Standard Time (Asia/Kolkata)' },
  { id: 'UTC',               label: 'UTC' },
  { id: 'America/New_York',  label: 'US Eastern (America/New_York)' },
  { id: 'America/Chicago',   label: 'US Central (America/Chicago)' },
  { id: 'America/Denver',    label: 'US Mountain (America/Denver)' },
  { id: 'America/Los_Angeles', label: 'US Pacific (America/Los_Angeles)' },
  { id: 'Europe/London',     label: 'UK (Europe/London)' },
];

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabaseClient();
  if (!supabase) return res.status(500).json({ error: 'Database is not configured' });

  // ── categories ──────────────────────────────────────────────────────────
  const catRes = await withSupabaseRetry(
    () => supabase.from('blog_categories').select('id, name, slug').order('name', { ascending: true }),
    { label: 'admin-options-categories', attempts: 2 }
  );
  if (catRes.error) {
    console.error('[admin/options] categories failed:', catRes.error.message);
    return res.status(503).json({ error: 'Could not load categories', retryable: true });
  }
  const categories = catRes.data || [];

  // ── authors ─────────────────────────────────────────────────────────────
  // Derived from the articles that actually exist rather than hardcoded, so the
  // editor offers the names this site really publishes under. Markdown articles
  // are the source of truth today; CMS rows are folded in as they appear.
  const tally = new Map();
  try {
    for (const p of getAllResources()) {
      if (p.author) tally.set(p.author, (tally.get(p.author) || 0) + 1);
    }
  } catch (e) {
    console.warn('[admin/options] could not read Markdown authors:', e.message);
  }

  const cmsAuthors = await withSupabaseRetry(
    () => supabase.from('blog_posts').select('author').not('author', 'is', null).limit(500),
    { label: 'admin-options-authors', attempts: 2 }
  );
  if (!cmsAuthors.error) {
    for (const r of (cmsAuthors.data || [])) {
      if (r.author) tally.set(r.author, (tally.get(r.author) || 0) + 1);
    }
  }

  const authors = [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);

  return res.json({
    categories,
    authors,
    defaultAuthor: authors[0] || 'The Doc Mirror',
    site: SITE,
    basePath: BASE_PATH,
    // The canonical URL is DERIVED, never stored: blog_posts has no
    // canonical_url column, and the renderer always builds it from the slug.
    // Sent as a pattern so the editor can show the real URL live.
    canonicalPattern: `${SITE}${BASE_PATH}/{slug}`,
    timezones: TIMEZONES,
    defaultTimezone: 'Asia/Kolkata',
    upload: {
      allowedMime: ALLOWED_MIME,
      maxBytes: MAX_UPLOAD_BYTES,
      recommendedMinWidth: OG_MIN_WIDTH,
      recommendedMinHeight: OG_MIN_HEIGHT,
    },
  });
}

module.exports = handler;
module.exports.ALLOWED_MIME = ALLOWED_MIME;
module.exports.MAX_UPLOAD_BYTES = MAX_UPLOAD_BYTES;
module.exports.TIMEZONES = TIMEZONES;
