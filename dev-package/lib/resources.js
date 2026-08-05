'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — Resources data layer (orchestrator)

   The single entry point every caller uses to reach blog/resource content. It
   owns *where content comes from*; nothing above it does.

     routes/resources.js ─┐                     ┌─▶ lib/resources-markdown.js
     lib/sitemap.js       ├─▶ lib/resources.js ─┤     content/resources/*.md
     scripts/*.js         ─┘   (this file)      └─▶ lib/resources-db.js
                                                      blog_posts (Supabase)

   The public Resources section is a HYBRID: the 24 Markdown articles and the
   publicly-eligible CMS posts are merged into one collection, sorted together
   by date. routes/resources.js and lib/sitemap.js are unchanged by this — they
   consume the same object shape they always have and never learn which source
   an article came from.

   Markdown remains the fallback: if Supabase is unreachable the CMS set is
   simply empty and the site serves the .md articles exactly as before.

   All four read functions are SYNCHRONOUS and must remain so. routes/resources.js
   calls them inline while building HTML; if one returned a Promise the page
   would render "[object Promise]". Network loading happens ahead of the
   handler in `warmResources` instead.

   Public API (frozen):
     SITE, escapeHtml, slugify, getAllResources, getResourceBySlug,
     getRelated, resourceSitemapEntries, warmResources
   ────────────────────────────────────────────────────────────────────────── */

const markdown = require('./resources-markdown');
const db       = require('./resources-db');

// ── warm-up ────────────────────────────────────────────────────────────────
// Loads whatever the active sources need before a request is served.
//
// Markdown is read straight off disk inside its read functions, so it needs no
// warming. The CMS source returns a Promise only on the very first request of a
// cold instance; after that a cached set is served immediately and any refresh
// happens behind the response.
function refresh() {
  return db.refresh();
}

// Express middleware mounted on the three routes that read resource content:
// GET /resources, GET /resources/:slug, GET /sitemap.xml.
//
// A failed warm-up must still call next(): the source keeps a usable fallback,
// and a content-loading failure must never turn a page that could still render
// into a broken request.
function warmResources(_req, _res, next) {
  const pending = refresh();
  if (pending && typeof pending.then === 'function') {
    pending.then(() => next(), () => next());
    return;
  }
  next();
}

// ── merge ──────────────────────────────────────────────────────────────────

/**
 * Combines both sources into one date-sorted collection.
 *
 * Collision rule: **the Markdown article wins.** Those 24 URLs are indexed,
 * linked from other articles, and three of them are the target of 301s in
 * server.js. A CMS row must never be able to take one over by accident — the
 * only way to replace one is to delete its .md file deliberately. The CMS post
 * is dropped from the public collection and the clash is logged once.
 *
 * Sorting is purely chronological across both sources, so a CMS post published
 * today sits above a Markdown article from yesterday and below one from
 * tomorrow. Provenance never affects position.
 */
function mergeSources(mdPosts, cmsPosts) {
  if (!cmsPosts.length) return mdPosts;

  const bySlug = new Map();
  for (const p of cmsPosts) bySlug.set(p.slug, p);

  for (const p of mdPosts) {
    if (bySlug.has(p.slug)) db.noteCollision(p.slug);
    bySlug.set(p.slug, p);              // Markdown overwrites the CMS entry
  }

  return [...bySlug.values()].sort((a, b) => b.date.sortKey - a.date.sortKey);
}

// ── reads (synchronous — see header) ───────────────────────────────────────

function getAllResources() {
  const mdPosts = markdown.getAllResources();
  const cmsPosts = db.getPosts();
  return cmsPosts.length ? mergeSources(mdPosts, cmsPosts) : mdPosts;
}

function getResourceBySlug(slug) {
  // Markdown first, mirroring the collision rule above: a live .md article
  // always answers for its own URL.
  const fromMarkdown = markdown.getResourceBySlug(slug);
  if (fromMarkdown) return fromMarkdown;
  return db.getBySlug(markdown.slugify(slug));
}

/**
 * Related articles.
 *
 * A CMS post may carry a hand-picked list (relatedSlugs) chosen in the editor.
 * When it does, that list wins and `limit` does not apply — the author decided
 * how many belong. Each slug is resolved against the PUBLIC collection, so a
 * draft, an archived post, a not-yet-due scheduled post or a deleted article
 * simply drops out. A page never breaks because a related article went away.
 *
 * With no manual list — which is every Markdown article — the original
 * scoring runs unchanged: same category first (+3), then shared tags, then
 * recency. It now scores across the merged collection, so a Markdown article
 * can surface a CMS post and vice versa, which is the point of a hybrid
 * section. With no public CMS posts the result is identical to before.
 */
function getRelated(post, limit = 3) {
  const all = getAllResources();

  const manual = Array.isArray(post.relatedSlugs) ? post.relatedSlugs : [];
  if (manual.length) {
    const bySlug = new Map(all.map((p) => [p.slug, p]));
    const picked = manual
      .map((s) => bySlug.get(markdown.slugify(String(s))))
      .filter(Boolean)
      .filter((p) => p.slug !== post.slug);
    if (picked.length) return picked;
    // Every pick resolved to nothing public — fall through to the automatic
    // list rather than rendering an empty Related block.
  }

  const others = all.filter((p) => p.slug !== post.slug);
  const scored = others.map((p) => {
    let score = 0;
    if (p.category === post.category) score += 3;
    score += p.tags.filter((t) => post.tags.includes(t)).length;
    return { p, score };
  });
  scored.sort((a, b) => (b.score - a.score) || (b.p.date.sortKey - a.p.date.sortKey));
  return scored.slice(0, limit).map((s) => s.p);
}

/**
 * Sitemap entries for every publicly-visible article, both sources.
 *
 * Built from the same merged collection the pages render from, so the sitemap
 * cannot disagree with the site: a draft, an archived post or a future
 * scheduled post is absent here because it is absent there, and a slug can
 * appear only once because the merge deduplicated it.
 */
function resourceSitemapEntries() {
  return getAllResources().map((p) => ({
    loc: p.canonical,
    lastmod: p.date.iso || '',
    changefreq: 'monthly',
    priority: '0.7',
  }));
}

// ── helpers (re-exported unchanged) ────────────────────────────────────────
// Pure string utilities with no notion of a content source. Re-exported as the
// same function objects so callers such as scripts/publish-resource.js keep
// importing them from here.

module.exports = {
  SITE: markdown.SITE,
  escapeHtml: markdown.escapeHtml,
  slugify: markdown.slugify,
  getAllResources,
  getResourceBySlug,
  getRelated,
  resourceSitemapEntries,
  warmResources,
  refresh,
  cmsStatus: db.status,
};
