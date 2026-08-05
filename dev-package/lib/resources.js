'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — Resources data layer (orchestrator)

   This file is the single entry point every caller uses to reach blog/resource
   content. It owns *where content comes from*; nothing above it does.

     routes/resources.js ─┐
     lib/sitemap.js       ├─▶ lib/resources.js ─▶ lib/resources-markdown.js
     scripts/*.js         ─┘   (this file)          (content/resources/*.md)

   Today there is exactly one source: the Markdown files on disk, implemented in
   lib/resources-markdown.js — which is the previous contents of this file,
   preserved byte-for-byte (verify with scripts/verify-resources-refactor.js).
   Every read below is a straight synchronous delegation to it, so behaviour,
   ordering, SEO output and the sitemap are unchanged.

   Why the indirection exists: a database-backed CMS is planned. When it lands,
   only `source()` and `refresh()` below change — routes/resources.js keeps
   rendering, and lib/sitemap.js keeps building, from the same object shape they
   already consume. The public API here is frozen and must stay:

     SITE, escapeHtml, slugify, getAllResources, getResourceBySlug,
     getRelated, resourceSitemapEntries

   All four read functions are SYNCHRONOUS and must remain so. routes/resources.js
   calls them inline while building HTML; if one ever returned a Promise, the
   page would render "[object Promise]" instead of content. Asynchronous sources
   are loaded ahead of the handler by `warmResources` (see below) instead.
   ────────────────────────────────────────────────────────────────────────── */

const markdown = require('./resources-markdown');

// ── active content source ──────────────────────────────────────────────────
// Phase 1: always the Markdown files. This is the one seam a future
// database/CMS source plugs into — it will return a merged view (DB rows plus
// the Markdown files as a fallback) exposing the same four read functions.
function source() {
  return markdown;
}

// ── warm-up ────────────────────────────────────────────────────────────────
// Loads whatever the active source needs before a request is served.
//
// Markdown is read straight off disk inside the read functions, so there is
// nothing to pre-load and this returns null — the synchronous path. A future
// network-backed source will return a Promise here instead, and warmResources
// will await it without any route or renderer changing.
function refresh() {
  return null;
}

// Express middleware mounted on the three routes that read resource content:
// GET /resources, GET /resources/:slug, GET /sitemap.xml.
//
// With a synchronous source this calls next() directly — same call stack, same
// timing, no behaviour change. When refresh() starts returning a Promise, a
// failed warm-up must still call next(): the source is responsible for keeping
// a usable fallback, and a content-loading failure must never turn a page that
// could still render into a broken request.
function warmResources(_req, _res, next) {
  const pending = refresh();
  if (pending && typeof pending.then === 'function') {
    pending.then(() => next(), () => next());
    return;
  }
  next();
}

// ── reads (synchronous — see header) ───────────────────────────────────────

function getAllResources() {
  return source().getAllResources();
}

function getResourceBySlug(slug) {
  return source().getResourceBySlug(slug);
}

function getRelated(post, limit = 3) {
  return source().getRelated(post, limit);
}

function resourceSitemapEntries() {
  return source().resourceSitemapEntries();
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
};
