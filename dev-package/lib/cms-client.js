'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — CMS client

   Talks to the central CMS's Website API. This is the ONLY file that knows
   the CMS exists; everything else consumes plain objects from
   lib/resources.js. Swapping or removing the CMS therefore never reaches
   beyond these two files.

   The client is deliberately dumb: it fetches, validates the envelope shape,
   and maps fields. It makes no decisions about visibility, ordering or SEO —
   the API already resolved all of that server-side, which is what keeps every
   site consuming this CMS consistent with the others.
   ────────────────────────────────────────────────────────────────────────── */

const API_URL = String(process.env.CMS_API_URL || '').trim().replace(/\/+$/, '');
const API_KEY = String(process.env.CMS_API_KEY || '').trim();

/**
 * Generous by design. A cold Vercel function plus a cold Supabase connection
 * can genuinely take a few seconds on the first request after idle. Timing out
 * at 2s would drop to the Markdown fallback constantly and mask a working CMS.
 */
const TIMEOUT_MS = Number(process.env.CMS_TIMEOUT_MS || 8000);

const PER_PAGE = 50;   // the API's maximum
const MAX_PAGES = 4;   // 200 posts; beyond that we log rather than silently truncate

function isConfigured() {
  return Boolean(API_URL && API_KEY);
}

/* ── low-level fetch ─────────────────────────────────────────────────────── */

async function request(path) {
  if (!isConfigured()) {
    throw new Error('CMS_API_URL / CMS_API_KEY not set');
  }

  // AbortController rather than Promise.race: race leaves the socket open, and
  // on serverless that keeps the function alive past the response.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body && body.error && body.error.message) detail = body.error.message;
      } catch (_) { /* non-JSON error body */ }
      throw new Error(`CMS ${path} → ${detail}`);
    }

    const json = await res.json();

    // Guard the envelope. A proxy or error page returning 200 with HTML would
    // otherwise surface as `undefined.map is not a function` deep in a route.
    if (!json || typeof json !== 'object' || !('data' in json)) {
      throw new Error(`CMS ${path} → response has no "data" field`);
    }

    return json;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`CMS ${path} → timed out after ${TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ── field mapping ───────────────────────────────────────────────────────── */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Same {iso, display, sortKey} shape the Markdown layer produces.
 *
 * Duplicated rather than imported from resources-markdown.js on purpose: this
 * file must stay usable even if the Markdown layer is eventually deleted.
 */
function toDate(iso) {
  if (!iso) return { iso: '', display: '', sortKey: 0 };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { iso: '', display: '', sortKey: 0 };
  return {
    iso: d.toISOString().slice(0, 10),
    display: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`,
    sortKey: d.getTime(),
  };
}

/**
 * Maps one API post onto the exact object `routes/resources.js` already
 * consumes. Every key the Markdown layer produced is produced here too —
 * including `faq`, which the CMS has no concept of and which must therefore be
 * an empty array rather than undefined, or the article template throws.
 *
 * `url` and `canonical` are built locally from BASE_PATH rather than taken from
 * the API's own `url` / `seo.canonical`. Those depend on the website's
 * `blog_base_path` being set correctly in the CMS; building them here means a
 * misconfigured CMS row cannot silently emit wrong canonical tags on a live
 * page. If the two ever disagree, this file wins — and the mismatch is logged.
 */
function mapPost(post, { site, basePath }) {
  const slug = String(post.slug || '');
  const title = String(post.title || slug.replace(/-/g, ' '));
  const seo = post.seo || {};
  const image = post.featured_image || null;

  const localUrl = `${basePath}/${slug}`;

  if (post.canonical_url && post.canonical_url !== `${site}${localUrl}`) {
    console.warn(
      `[cms] canonical mismatch for "${slug}": CMS says ${post.canonical_url}, ` +
      `this site serves ${site}${localUrl}. Check blog_base_path on the website record.`
    );
  }

  return {
    slug,
    url: localUrl,
    canonical: `${site}${localUrl}`,
    title,
    seoTitle: String(seo.title || title),
    metaDescription: String(seo.description || post.excerpt || ''),
    description: String(post.excerpt || seo.description || ''),
    excerpt: String(post.excerpt || ''),
    date: toDate(post.published_at),
    author: (post.author && post.author.name) ? String(post.author.name) : 'The Doc Mirror',
    category: (post.category && post.category.name) ? String(post.category.name) : 'Guide',
    tags: Array.isArray(post.tags) ? post.tags.map(t => String(t.name)).filter(Boolean) : [],
    image: image && image.url ? String(image.url) : null,
    imageAlt: image && image.alt ? String(image.alt) : title,
    readingTime: Number(post.reading_minutes) || 1,
    faq: [],                                    // not modelled in the CMS
    html: String(post.content_html || ''),

    // Marks provenance so the merge in resources.js can prefer CMS rows and so
    // `/resources?debug=source` can show where each post came from.
    _source: 'cms',
  };
}

/* ── public API ──────────────────────────────────────────────────────────── */

/**
 * Every published post, mapped and sorted newest first.
 *
 * Requests `fields=full` so `content_html` is present for the article page.
 * At this site's scale that is one request; the page loop exists so growth
 * does not silently truncate the archive.
 */
async function fetchAllPosts({ site, basePath }) {
  const collected = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await request(`/posts?fields=full&per_page=${PER_PAGE}&page=${page}`);

    if (!Array.isArray(json.data)) {
      throw new Error('CMS /posts → "data" is not an array');
    }

    // A post with no usable slug would map to `/resources/` — a link on the
    // listing page pointing at the listing page, and a sitemap entry that
    // duplicates the index. Drop it loudly rather than publish a broken URL.
    for (const raw of json.data) {
      const slug = String((raw && raw.slug) || '').trim();
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
        console.warn(`[cms] skipping post with unusable slug: ${JSON.stringify(raw && raw.slug)}`);
        continue;
      }
      collected.push(mapPost(raw, { site, basePath }));
    }

    const meta = json.meta || {};
    if (!meta.has_next) return sortByDate(collected);
  }

  console.warn(
    `[cms] stopped after ${MAX_PAGES} pages (${collected.length} posts). ` +
    'Raise MAX_PAGES in lib/cms-client.js if the archive is larger than this.'
  );
  return sortByDate(collected);
}

function sortByDate(posts) {
  return posts.sort((a, b) => b.date.sortKey - a.date.sortKey);
}

module.exports = { isConfigured, fetchAllPosts, TIMEOUT_MS };
