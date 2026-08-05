'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   POST /api/admin/preview

   Renders an unsaved draft through the REAL public article renderer —
   routes/resources.js renderArticle(), the same function that produces every
   live Resources page. Not a lookalike template: the preview is the actual
   output, so the typography, spacing, hero, FAQ accordion, CTA, related block
   and JSON-LD are exactly what publishing would produce.

   Nothing is written and nothing becomes public. The draft never touches the
   database on this path, and the HTML is returned only to an authenticated
   admin — there is no shareable preview URL to leak.
   ────────────────────────────────────────────────────────────────────────── */

require('../../lib/env');
const { renderArticle } = require('../../routes/resources');
const { mapRow } = require('../../lib/blog-post-mapper');
const { escapeHtml } = require('../../lib/resources');

// Makes it unmistakable that this is not the live page. Injected after <body>
// so it cannot alter the article markup being reviewed.
function previewBanner(status, slug) {
  const label = status === 'published' ? 'PREVIEW — already published'
              : status === 'scheduled' ? 'PREVIEW — scheduled, not public yet'
              : status === 'archived'  ? 'PREVIEW — archived, not public'
              : 'PREVIEW — draft, not public';

  return `<div style="position:sticky;top:0;z-index:99999;background:#0A2540;color:#fff;
font-family:'DM Sans',system-ui,sans-serif;font-size:13px;font-weight:600;
padding:9px 16px;display:flex;gap:12px;align-items:center;justify-content:center;
letter-spacing:.02em">
<span style="background:#00A878;padding:2px 9px;border-radius:999px;font-size:11px">${escapeHtml(label)}</span>
<span style="opacity:.75;font-weight:400">This page is not live. It will be served at /resources/${escapeHtml(slug || '…')} once published.</span>
</div>`;
}

function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Content-Type', 'application/json');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};

  // Shaped like a blog_posts row so the preview goes through exactly the same
  // mapping the public read path will use — a field that renders wrong here
  // would render wrong live.
  const row = {
    title:            body.title || 'Untitled article',
    slug:             body.slug || 'untitled',
    excerpt:          body.excerpt || '',
    content_md:       body.content_md || '',
    author:           body.author || '',
    category:         body.category || '',
    tags:             Array.isArray(body.tags) ? body.tags : [],
    read_time_minutes: body.read_time_minutes || null,
    featured_image:   body.featured_image || null,
    image_alt:        body.image_alt || '',
    seo_title:        body.seo_title || '',
    meta_description: body.meta_description || '',
    faq:              Array.isArray(body.faq) ? body.faq : [],
    related_slugs:    Array.isArray(body.related_slugs) ? body.related_slugs : [],
    // Structured-data switches, so the preview's JSON-LD is what would ship.
    enable_article_schema: body.enable_article_schema !== false,
    enable_faq_schema:     body.enable_faq_schema !== false,
    // A draft has no publish instant yet; today's date keeps the meta line from
    // rendering blank while previewing.
    published_at:     body.published_at || new Date().toISOString(),
    status:           body.status || 'draft',
  };

  let html;
  try {
    html = renderArticle(mapRow(row));
  } catch (err) {
    console.error('[admin/preview] render failed:', err.message);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: 'Could not render the preview: ' + err.message });
  }

  html = html.replace('<body>', '<body>' + previewBanner(row.status, row.slug));

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return res.send(html);
}

module.exports = handler;
