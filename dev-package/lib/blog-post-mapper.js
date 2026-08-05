'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — blog_posts row → public resource object

   Turns one CMS database row into the exact 17-key object that
   routes/resources.js already renders and lib/sitemap.js already consumes —
   the same shape lib/resources-markdown.js produces for a .md file.

   That shared shape is the whole point: the renderer never learns where an
   article came from, so a CMS post and a Markdown post produce identical
   typography, spacing, SEO tags and JSON-LD.

   Used today by the admin preview endpoint. Step I will use the same function
   for the public read path, which is why the visibility rule lives here too
   rather than being re-derived per caller.
   ────────────────────────────────────────────────────────────────────────── */

const { marked } = require('marked');
// Imported from the Markdown layer, not from lib/resources.js. The orchestrator
// now loads lib/resources-db.js, which loads this file — going back through the
// orchestrator would close that loop and leave SITE/slugify undefined at the
// moment this module is evaluated. resources-markdown.js is a leaf: it depends
// on nothing inside the resources layer, so there is no cycle. Both names are
// the same objects the orchestrator re-exports.
const { SITE, slugify } = require('./resources-markdown');

// The base path resource URLs are built from. Kept as a constant rather than
// read from config: these URLs are indexed, and a stray env var must never be
// able to relocate them.
const BASE_PATH = '/resources';

// Identical to the options set in lib/resources-markdown.js:32. Stated
// explicitly rather than relying on that module having been required first,
// so this file cannot silently render with different settings.
marked.setOptions({ gfm: true, breaks: false, mangle: false, headerIds: true });

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Same {iso, display, sortKey} shape the Markdown layer produces, and
 * deliberately the same UTC-based formatting — so a CMS article's displayed
 * date cannot differ by a day from a Markdown article published the same day.
 */
function toDate(value) {
  if (!value) return { iso: '', display: '', sortKey: 0 };
  const d = value instanceof Date ? value : new Date(String(value));
  if (isNaN(d.getTime())) return { iso: '', display: '', sortKey: 0 };
  return {
    iso: d.toISOString().slice(0, 10),
    display: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`,
    sortKey: d.getTime(),
  };
}

/** Word-count reading time, matching lib/resources-markdown.js:59. */
function readingTimeMinutes(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** Strip Markdown to plain text, matching lib/resources-markdown.js:65. */
function stripMarkdown(md) {
  return String(md || '')
    .replace(/^---[\s\S]*?---/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/^[#>\-*+]\s*/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function autoExcerpt(md) {
  const plain = stripMarkdown(md);
  if (plain.length <= 160) return plain;
  return plain.slice(0, 157).replace(/\s+\S*$/, '') + '…';
}

/**
 * Markdown → HTML through the same pipeline the .md files use, including the
 * table wrapper that lets a wide table scroll on mobile instead of overflowing
 * the page body (lib/resources-markdown.js:141).
 */
function renderMarkdown(md) {
  return marked.parse(String(md || ''))
    .replace(/<table>/g, '<div class="res-table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>');
}

/** Normalise the jsonb faq column into the {question, answer} pairs the renderer expects. */
function normaliseFaq(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({
      question: String((item && (item.question || item.q)) || '').trim(),
      answer:   String((item && (item.answer   || item.a)) || '').trim(),
    }))
    .filter((f) => f.question && f.answer);
}

/**
 * A CMS row is publicly visible only when it is meant to be published AND its
 * publish instant has passed. Defined once, here, so no caller can forget half
 * of it — a draft leaking because a WHERE clause was incomplete is the failure
 * this guards against.
 */
function isPublic(row, now = Date.now()) {
  if (!row) return false;
  if (row.status !== 'published' && row.status !== 'scheduled') return false;
  if (!row.published_at) return false;
  const at = Date.parse(row.published_at);
  return Number.isFinite(at) && at <= now;
}

/**
 * Row → the 17-key object. Every fallback mirrors what the Markdown layer does
 * when a frontmatter field is absent, so a CMS post with a blank SEO title
 * behaves exactly like a .md file with no `seoTitle`.
 */
function mapRow(row) {
  const slug  = slugify(row.slug || '');
  const title = String(row.title || slug.replace(/-/g, ' '));
  const md    = String(row.content_md || '');

  const excerpt = String(row.excerpt || '').trim() || autoExcerpt(md);
  const tags    = Array.isArray(row.tags) ? row.tags.map(String).filter(Boolean) : [];

  return {
    slug,
    url:             `${BASE_PATH}/${slug}`,
    canonical:       `${SITE}${BASE_PATH}/${slug}`,
    title,
    seoTitle:        String(row.seo_title || title),
    metaDescription: String(row.meta_description || excerpt),
    description:     excerpt,
    excerpt,
    date:            toDate(row.published_at),
    author:          row.author ? String(row.author) : 'The Doc Mirror',
    category:        row.category ? String(row.category) : 'Guide',
    tags,
    image:           row.featured_image ? String(row.featured_image) : null,
    imageAlt:        row.image_alt ? String(row.image_alt) : title,
    readingTime:     Number(row.read_time_minutes) > 0
                       ? Number(row.read_time_minutes)
                       : readingTimeMinutes(md),
    faq:             normaliseFaq(row.faq),
    html:            renderMarkdown(md),

    // ── Optional keys, present only on CMS posts ────────────────────────────
    // Markdown posts carry none of these. Every consumer treats absence as the
    // historical behaviour, which is what keeps a .md article's output
    // byte-for-byte unchanged.

    // Structured-data switches (migration 022). Absent → both on.
    schema: {
      article: row.enable_article_schema !== false,
      faq:     row.enable_faq_schema !== false,
    },

    // Manual "Related in this series" selection. Absent or empty → the
    // automatic same-category/shared-tag algorithm runs, as it always has.
    relatedSlugs: Array.isArray(row.related_slugs)
      ? row.related_slugs.map(String).filter(Boolean)
      : [],

    // Provenance. Used for two things and nothing else: rendering tag chips on
    // CMS articles only (the 24 Markdown articles keep their current design,
    // per the CMS-only-tags decision), and diagnostics.
    _source: 'cms',
  };
}

module.exports = {
  BASE_PATH,
  mapRow,
  isPublic,
  toDate,
  renderMarkdown,
  readingTimeMinutes,
  autoExcerpt,
  stripMarkdown,
  normaliseFaq,
};
