'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — Resources content engine (data layer)

   Reads Markdown files from /resources, parses frontmatter, renders the body
   to HTML, and derives everything the listing + article pages and the sitemap
   need (slug, excerpt, reading time, related posts, SEO fields).

   Publishing workflow — zero code required:
     1. Drop a `.md` file into  dev-package/content/resources/
     2. Drop its hero image into dev-package/public/images/resources/
     3. It automatically appears on /resources, at /resources/<slug>,
        in the sitemap, and with full SEO metadata.

   Or drop both into dev-package/imports/ and run `npm run import-resources`.

   Frontmatter fields (all optional except title):
     title, description, date, author, category, image, tags,
     seoTitle, metaDescription
   ────────────────────────────────────────────────────────────────────────── */

const fs     = require('fs');
const path   = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

const RESOURCES_DIR = path.join(__dirname, '..', 'content', 'resources');
const SITE = 'https://www.thedocmirror.com';

// GitHub-flavoured Markdown: tables, task lists, autolinks, etc.
marked.setOptions({ gfm: true, breaks: false, mangle: false, headerIds: true });

// Cache parsed posts in production (serverless cold start re-reads once).
// In dev, always re-read so a freshly dropped file shows up immediately.
const IS_PROD = process.env.NODE_ENV === 'production';
let _cache = null;

// ── helpers ──────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function readingTimeMinutes(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

// Strip Markdown syntax down to plain text for excerpts.
function stripMarkdown(md) {
  return String(md)
    .replace(/^---[\s\S]*?---/, '')          // any stray frontmatter
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')     // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // links → text
    .replace(/`{1,3}[^`]*`{1,3}/g, '')        // code
    .replace(/^[#>\-*+]\s*/gm, '')            // heading / quote / list markers
    .replace(/[*_~]/g, '')                     // emphasis
    .replace(/\|/g, ' ')                       // table pipes
    .replace(/\s+/g, ' ')
    .trim();
}

function makeExcerpt(data, content) {
  const given = data.description || data.excerpt;
  if (given) return String(given).trim();
  const plain = stripMarkdown(content);
  if (plain.length <= 160) return plain;
  return plain.slice(0, 157).replace(/\s+\S*$/, '') + '…';
}

// Accept an explicit read time ("5", "5 min", 5) or fall back to word count.
function parseReadTime(raw) {
  if (raw == null) return 0;
  const m = String(raw).match(/\d+/);
  return m ? Math.max(1, parseInt(m[0], 10)) : 0;
}

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

// Parse a frontmatter date into { iso, display, sortKey } without throwing.
function parseDate(raw) {
  if (!raw) return { iso: '', display: '', sortKey: 0 };
  const d = (raw instanceof Date) ? raw : new Date(String(raw));
  if (isNaN(d.getTime())) {
    return { iso: '', display: String(raw), sortKey: 0 };
  }
  const iso = d.toISOString().slice(0, 10);
  const display = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  return { iso, display, sortKey: d.getTime() };
}

// ── parsing ────────────────────────────────────────────────────────────────

function parseFile(file) {
  const full = path.join(RESOURCES_DIR, file);
  let raw;
  try {
    raw = fs.readFileSync(full, 'utf8');
  } catch (_) {
    return null;
  }

  const { data, content } = matter(raw);
  if (data.published === false || data.draft === true) return null;

  const slug  = data.slug ? slugify(data.slug) : slugify(file);
  const title = data.title || slug.replace(/-/g, ' ');
  const date  = parseDate(data.date);
  const tags  = Array.isArray(data.tags)
    ? data.tags.map(t => String(t).trim()).filter(Boolean)
    : (data.tags ? String(data.tags).split(',').map(t => t.trim()).filter(Boolean) : []);

  // FAQ (optional) — array of { question/q, answer/a } in frontmatter.
  const faq = Array.isArray(data.faq)
    ? data.faq
        .map(item => ({
          question: String((item && (item.question || item.q)) || '').trim(),
          answer:   String((item && (item.answer   || item.a)) || '').trim(),
        }))
        .filter(f => f.question && f.answer)
    : [];

  // Wrap tables so wide ones scroll horizontally on mobile instead of
  // overflowing the page body.
  const html        = marked.parse(content)
    .replace(/<table>/g, '<div class="res-table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>');
  const excerpt     = makeExcerpt(data, content);
  const readingTime = parseReadTime(data.readTime || data.readingTime) || readingTimeMinutes(content);
  // `image` is canonical; `featuredImage` is accepted as an alias.
  const image       = data.image || data.featuredImage || null;

  return {
    slug,
    url:            `/resources/${slug}`,
    canonical:      `${SITE}/resources/${slug}`,
    title:          String(title),
    seoTitle:       String(data.seoTitle || data.title || title),
    metaDescription: String(data.metaDescription || data.description || data.excerpt || excerpt),
    description:    String(data.description || data.excerpt || excerpt),
    excerpt,
    date,
    author:         data.author ? String(data.author) : 'The Doc Mirror',
    category:       data.category ? String(data.category) : 'Guide',
    tags,
    image:          image ? String(image) : null,
    imageAlt:       data.imageAlt ? String(data.imageAlt) : String(title),
    readingTime,
    faq,
    html,
  };
}

// ── public API ───────────────────────────────────────────────────────────

function getAllResources() {
  if (IS_PROD && _cache) return _cache;

  let files = [];
  try {
    files = fs.readdirSync(RESOURCES_DIR).filter(f =>
      /\.md$/i.test(f) &&
      f.toLowerCase() !== 'readme.md' &&   // publishing guide, not a post
      !f.startsWith('_') &&                 // _foo.md = draft
      !f.startsWith('.')                    // dotfiles
    );
  } catch (_) {
    files = [];
  }

  const posts = files
    .map(parseFile)
    .filter(Boolean)
    .sort((a, b) => b.date.sortKey - a.date.sortKey);

  if (IS_PROD) _cache = posts;
  return posts;
}

function getResourceBySlug(slug) {
  const target = slugify(slug);
  return getAllResources().find(p => p.slug === target) || null;
}

// Related = same category first, then shared tags, then most recent. Max `limit`.
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

// Sitemap <url> entries for every resource (article) + the listing page.
function resourceSitemapEntries() {
  const posts = getAllResources();
  const entries = posts.map(p => ({
    loc: p.canonical,
    lastmod: p.date.iso || '',
    changefreq: 'monthly',
    priority: '0.7',
  }));
  return entries;
}

module.exports = {
  SITE,
  escapeHtml,
  slugify,
  getAllResources,
  getResourceBySlug,
  getRelated,
  resourceSitemapEntries,
};
