/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — sitemap builder (single source of truth)

   Used by BOTH:
     • server.js          → serves /sitemap.xml live (always current)
     • scripts/generate-sitemap.js → writes public/sitemap.xml as a readable
                                     file you can open and inspect

   Because both call buildSitemapXml(), the file on disk and the URL Google
   fetches can never disagree about which pages exist.

   To add a static page: add one row to STATIC_PAGES below.
   To add an article:    nothing — drop the .md in content/resources/.
   ────────────────────────────────────────────────────────────────────────── */
const fs = require('fs');
const path = require('path');
const { resourceSitemapEntries } = require('./resources');

const SITE = 'https://www.thedocmirror.com';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Only canonical, indexable, 200-returning URLs belong here. Deliberately
// absent: /pages/*.html (301s to clean URLs), /dashboard and the private
// noindex pages, /api/*, and anchor-only nav targets like /#faq and
// /about#contact (fragments are not separate URLs and are invalid here).
const STATIC_PAGES = [
  { path: '/',                        file: 'index.html',                         changefreq: 'weekly',  priority: '1.0' },
  { path: '/resources',               file: null,                                 changefreq: 'weekly',  priority: '0.9' },
  { path: '/pricing',                 file: 'pages/pricing.html',                 changefreq: 'monthly', priority: '0.8' },
  { path: '/doctor-visibility-score', file: 'pages/doctor-visibility-score.html', changefreq: 'monthly', priority: '0.8' },
  { path: '/about',                   file: 'pages/about.html',                   changefreq: 'monthly', priority: '0.7' },
  { path: '/help-center',             file: 'pages/help-center.html',             changefreq: 'monthly', priority: '0.6' },
  { path: '/privacy',                 file: 'pages/privacy.html',                 changefreq: 'yearly',  priority: '0.3' },
  { path: '/terms',                   file: 'pages/terms.html',                   changefreq: 'yearly',  priority: '0.3' },
];

// Real last-modified date per page, from the file on disk. Note: a git checkout
// (including Vercel's build) does not preserve authoring mtimes, so on the
// deployed host these resolve to the build/deploy date rather than the true
// edit date. Resource articles use their frontmatter date, which is exact
// everywhere. Running `npm run sitemap` locally and committing the result
// captures accurate dates for the static pages too.
function fileLastmod(relFile) {
  if (!relFile) return null;
  try {
    return fs.statSync(path.join(PUBLIC_DIR, relFile)).mtime.toISOString().slice(0, 10);
  } catch (_) {
    return null;
  }
}

function urlBlock(e) {
  return '  <url>\n' +
    `    <loc>${e.loc}</loc>\n` +
    (e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>\n` : '') +
    `    <changefreq>${e.changefreq}</changefreq>\n` +
    `    <priority>${e.priority}</priority>\n` +
    '  </url>';
}

// Every URL in the sitemap, in crawl-priority order: homepage, the Resources
// hub, the other static pages, then the articles one level below /resources.
function buildSitemapEntries() {
  const articles = resourceSitemapEntries();

  const staticEntries = STATIC_PAGES.map(p => ({
    loc: SITE + p.path,
    // /resources is a generated listing: it is as fresh as its newest article.
    lastmod: p.path === '/resources'
      ? (articles[0] || {}).lastmod || fileLastmod('index.html')
      : fileLastmod(p.file),
    changefreq: p.changefreq,
    priority: p.priority,
  }));

  const articleEntries = articles.map(e => ({
    ...e, changefreq: 'monthly', priority: '0.8',
  }));

  // Guard against a duplicate <loc> sneaking in from either source.
  const seen = new Set();
  return [...staticEntries, ...articleEntries].filter(e => {
    if (seen.has(e.loc)) return false;
    seen.add(e.loc);
    return true;
  });
}

function buildSitemapXml() {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    buildSitemapEntries().map(urlBlock).join('\n') + '\n' +
    '</urlset>\n';
}

module.exports = { buildSitemapXml, buildSitemapEntries, SITE, STATIC_PAGES };
