#!/usr/bin/env node
'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — Resources refactor verification

   Proves that splitting lib/resources.js into

       lib/resources.js            (orchestrator — owns WHERE content comes from)
       lib/resources-markdown.js   (the original Markdown implementation)

   changed nothing a visitor, Googlebot or the sitemap can observe.

   Usage:
     node scripts/verify-resources-refactor.js
     node scripts/verify-resources-refactor.js --baseline <dir>
     node scripts/verify-resources-refactor.js --save-baseline <dir>
     node scripts/verify-resources-refactor.js --port 4321

   --save-baseline writes the three public responses to <dir>. Run it on a
   known-good checkout, then --baseline <dir> byte-compares against it later.
   Without a baseline the script still proves equivalence, by rendering the
   real views twice — once bound to the orchestrator, once bound directly to
   the preserved Markdown implementation — and byte-comparing the two.

   Exit 0 = no public regression.
   ────────────────────────────────────────────────────────────────────────── */

// Loaded so this process can reach the CMS the same way the spawned server
// does. Without it the server would serve published CMS posts that this process
// had never fetched, and the two would be compared as if they disagreed.
// The byte-identity group below still clears the CMS source explicitly.
require('../lib/env');

const fs      = require('fs');
const path    = require('path');
const http    = require('http');
const crypto  = require('crypto');
const { spawn, execFileSync } = require('child_process');

const ROOT      = path.join(__dirname, '..');
const REPO_ROOT = path.join(ROOT, '..');
const RESOURCES_DIR = path.join(ROOT, 'content', 'resources');

// The article used for the detail-page comparison, and the slugs that
// server.js 301-redirects into — those must never stop resolving.
const ARTICLE_SLUG   = 'doctor-profile-costing-you-patients';
const REDIRECT_SLUGS = [
  'ai-visibility-for-doctors',
  'how-doctors-rank-in-chatgpt',
  'google-visibility-guide',
];

// The exact object shape routes/resources.js and lib/sitemap.js consume.
const POST_KEYS = [
  'slug', 'url', 'canonical', 'title', 'seoTitle', 'metaDescription',
  'description', 'excerpt', 'date', 'author', 'category', 'tags',
  'image', 'imageAlt', 'readingTime', 'faq', 'html',
];

const PUBLIC_API = [
  'SITE', 'escapeHtml', 'slugify', 'getAllResources',
  'getResourceBySlug', 'getRelated', 'resourceSitemapEntries',
];

// ── tiny harness ───────────────────────────────────────────────────────────

let passed = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label + (detail ? ` — ${detail}` : ''));
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function group(title) {
  console.log(`\n${title}`);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const lf     = (buf) => Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');

// Where two strings first diverge — turns "not identical" into something fixable.
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return `at char ${i}: ${JSON.stringify(a.slice(Math.max(0, i - 40), i + 40))} vs ` +
             `${JSON.stringify(b.slice(Math.max(0, i - 40), i + 40))}`;
    }
  }
  return `identical for ${n} chars, then lengths differ (${a.length} vs ${b.length})`;
}

function sameJson(label, a, b) {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  check(label, ja === jb, ja === jb ? '' : firstDiff(ja, jb));
}

function sameBytes(label, a, b) {
  const ok = Buffer.compare(a, b) === 0;
  check(label, ok, ok ? '' : `${a.length} vs ${b.length} bytes; ${firstDiff(a.toString('utf8'), b.toString('utf8'))}`);
}

// ── args ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { port: 4321, baseline: null, saveBaseline: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port')           opts.port = parseInt(argv[++i], 10);
    else if (argv[i] === '--baseline')      opts.baseline = argv[++i];
    else if (argv[i] === '--save-baseline') opts.saveBaseline = argv[++i];
  }
  return opts;
}

// ── module loading helpers ─────────────────────────────────────────────────

// Loads routes/resources.js (or lib/sitemap.js) bound to a chosen content
// engine, by seeding require.cache for '../lib/resources' before the module is
// required. That is what lets the SAME renderer be driven by the orchestrator
// and by the preserved Markdown implementation, so the two HTML outputs can be
// compared byte for byte instead of merely inspected.
function loadWithEngine(modulePath, engineExports) {
  const enginePath = require.resolve('../lib/resources');
  const targetPath = require.resolve(modulePath);
  const savedEngine = require.cache[enginePath];

  require.cache[enginePath] = {
    id: enginePath, filename: enginePath, path: path.dirname(enginePath),
    loaded: true, children: [], paths: [], exports: engineExports,
  };
  delete require.cache[targetPath];

  try {
    return require(modulePath);
  } finally {
    delete require.cache[targetPath];
    if (savedEngine) require.cache[enginePath] = savedEngine;
    else delete require.cache[enginePath];
  }
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('request timed out')));
  });
}

async function waitForServer(port, child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try {
      const r = await get(port, '/resources');
      if (r.status === 200) return;
    } catch (_) { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not become ready on port ${port} within ${timeoutMs}ms`);
}

// ── checks ─────────────────────────────────────────────────────────────────

function checkPreservedImplementation() {
  group('1. The Markdown implementation was preserved, not rewritten');

  const mdPath = path.join(ROOT, 'lib', 'resources-markdown.js');
  const onDisk = fs.readFileSync(mdPath);
  check('lib/resources-markdown.js exists', fs.existsSync(mdPath));

  // The pre-refactor lib/resources.js, straight out of git.
  //
  // Pinned to the commit BEFORE the refactor rather than HEAD: once the split
  // was committed, HEAD:lib/resources.js became the orchestrator, so comparing
  // against HEAD would compare this file to the wrong thing and fail for a
  // reason that has nothing to do with the Markdown implementation.
  //
  // Line endings are normalised because this repo is checked out with
  // core.autocrlf=true — the working tree has CRLF, the stored blob has LF.
  // Content is what is being compared.
  const PRE_REFACTOR_REF = '57cfb75';
  let fromGit = null;
  try {
    fromGit = execFileSync('git', ['show', `${PRE_REFACTOR_REF}:dev-package/lib/resources.js`],
      { cwd: REPO_ROOT, maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    console.log(`  ~ skipped git comparison (${err.message.split('\n')[0]})`);
  }

  if (fromGit) {
    const a = lf(onDisk);
    const b = lf(fromGit);
    const ok = Buffer.compare(a, b) === 0;
    check(`resources-markdown.js is byte-identical to ${PRE_REFACTOR_REF}:lib/resources.js`, ok,
      ok ? '' : `sha256 ${sha256(a).slice(0, 16)} vs ${sha256(b).slice(0, 16)}`);
    if (ok) console.log(`    sha256(LF-normalised) = ${sha256(a)}`);
  }

  const md = require('../lib/resources-markdown');
  check('resources-markdown.js still exports the original public API',
    PUBLIC_API.every((k) => k in md),
    PUBLIC_API.filter((k) => !(k in md)).join(', '));
  check('resources-markdown.js does NOT export warmResources (it is source-agnostic)',
    !('warmResources' in md));
}

function checkOrchestratorContract() {
  group('2. The orchestrator honours the frozen public API');

  const orch = require('../lib/resources');
  const md   = require('../lib/resources-markdown');

  check('exports every original name', PUBLIC_API.every((k) => k in orch),
    PUBLIC_API.filter((k) => !(k in orch)).join(', '));
  check('exports warmResources', typeof orch.warmResources === 'function');
  // The orchestrator may add source-management helpers on top of the frozen
  // read API. `refresh` is what warmResources drives; `cmsStatus` is read-only
  // diagnostics. Neither is a content reader, so neither can change what a page
  // renders — but the list is explicit so a genuinely unexpected export still
  // fails this check.
  const ALLOWED_EXTRAS = ['warmResources', 'refresh', 'cmsStatus'];
  check('exports nothing beyond the frozen API plus known helpers',
    Object.keys(orch).every((k) => PUBLIC_API.includes(k) || ALLOWED_EXTRAS.includes(k)),
    Object.keys(orch).filter((k) => !PUBLIC_API.includes(k) && !ALLOWED_EXTRAS.includes(k)).join(', '));

  // Same references, so importers such as scripts/publish-resource.js are unaffected.
  check('SITE is unchanged', orch.SITE === md.SITE, `${orch.SITE} vs ${md.SITE}`);
  check('escapeHtml is the same function', orch.escapeHtml === md.escapeHtml);
  check('slugify is the same function', orch.slugify === md.slugify);

  // If a read function ever became async, routes/resources.js would render a
  // Promise into the page. Guard both the declaration and the returned value.
  const sampleArg = {
    getAllResources:        undefined,
    getResourceBySlug:      ARTICLE_SLUG,
    getRelated:             md.getResourceBySlug(ARTICLE_SLUG),
    resourceSitemapEntries: undefined,
  };
  for (const [name, arg] of Object.entries(sampleArg)) {
    const notAsyncFn = orch[name].constructor.name === 'Function';
    const result = orch[name](arg);
    const notThenable = !result || typeof result.then !== 'function';
    check(`${name}() is synchronous`, notAsyncFn && notThenable,
      notAsyncFn ? 'returned a thenable' : 'declared async');
  }

  check('getAllResources arity is unchanged (0)', orch.getAllResources.length === md.getAllResources.length);
  check('getResourceBySlug arity is unchanged (1)', orch.getResourceBySlug.length === md.getResourceBySlug.length);
  check('getRelated arity is unchanged (1)', orch.getRelated.length === md.getRelated.length);

}

/**
 * warmResources has two legitimate behaviours, and both matter:
 *   warm/disabled → next() on the same call stack, so a page never waits for
 *                   data already in memory
 *   cold          → next() after the first load resolves; only the first
 *                   request after a restart pays that
 * What must never vary is that control is handed on exactly once.
 */
async function checkWarmResources() {
  group('3. warmResources hands control on, in both states');

  const orch = require('../lib/resources');
  const db   = require('../lib/resources-db');

  await orch.refresh();                       // make sure something is cached

  let called = 0;
  let synchronous = false;
  orch.warmResources({}, {}, () => { called++; synchronous = true; });
  check('warm: next() called exactly once', called === 1, `called ${called}×`);
  check('warm: called synchronously — no added latency', synchronous);

  db._reset();
  called = 0;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 20000);  // never hang the suite
    orch.warmResources({}, {}, () => { called++; clearTimeout(timer); resolve(); });
  });
  check('cold: next() still called exactly once', called === 1, `called ${called}×`);

  db._reset();
}

function checkDataEquivalence() {
  group('4. The orchestrator returns exactly what the Markdown layer returns');

  const orch = require('../lib/resources');
  const md   = require('../lib/resources-markdown');

  const a = orch.getAllResources();
  const b = md.getAllResources();

  check('same number of posts', a.length === b.length, `${a.length} vs ${b.length}`);
  sameJson('getAllResources() is deep-equal (every field of every post)', a, b);

  check('every post has exactly the 17 expected keys',
    a.every((p) => JSON.stringify(Object.keys(p)) === JSON.stringify(POST_KEYS)),
    (a.find((p) => JSON.stringify(Object.keys(p)) !== JSON.stringify(POST_KEYS)) || {}).slug);

  // Ordering is load-bearing: the newest post becomes the featured card.
  const sortedDesc = a.every((p, i) => i === 0 || a[i - 1].date.sortKey >= p.date.sortKey);
  check('article ordering is newest-first', sortedDesc);
  sameJson('article order is identical', a.map((p) => p.slug), b.map((p) => p.slug));

  sameJson('titles are identical', a.map((p) => p.title), b.map((p) => p.title));
  sameJson('canonical URLs are identical', a.map((p) => p.canonical), b.map((p) => p.canonical));
  sameJson('SEO metadata is identical',
    a.map((p) => [p.seoTitle, p.metaDescription, p.description, p.excerpt]),
    b.map((p) => [p.seoTitle, p.metaDescription, p.description, p.excerpt]));
  sameJson('FAQ data is identical', a.map((p) => p.faq), b.map((p) => p.faq));
  sameJson('images and alt text are identical',
    a.map((p) => [p.image, p.imageAlt]), b.map((p) => [p.image, p.imageAlt]));

  sameJson('getResourceBySlug() is identical for every slug',
    a.map((p) => orch.getResourceBySlug(p.slug)),
    b.map((p) => md.getResourceBySlug(p.slug)));
  check('getResourceBySlug() still returns null for an unknown slug',
    orch.getResourceBySlug('definitely-not-a-real-slug-xyz') === null);

  sameJson('getRelated() is identical for every post',
    a.map((p) => orch.getRelated(p, 3).map((r) => r.slug)),
    b.map((p) => md.getRelated(p, 3).map((r) => r.slug)));
  check('getRelated() default limit is still 3',
    a.length > 3 ? orch.getRelated(a[0]).length === 3 : true);

  sameJson('resourceSitemapEntries() is identical',
    orch.resourceSitemapEntries(), md.resourceSitemapEntries());
}

function checkRenderedOutput() {
  group('5. With no CMS posts, the renderer produces byte-identical HTML either way');

  const orch = require('../lib/resources');
  const md   = require('../lib/resources-markdown');

  // This comparison only means anything with the CMS source empty: it asks
  // whether the orchestrator changed how a Markdown-only site renders. With CMS
  // posts loaded the two sides SHOULD differ, because one of them knows about
  // posts the other cannot see. Cleared explicitly rather than assumed.
  require('../lib/resources-db')._reset();

  const viewsNew  = loadWithEngine('../routes/resources', orch);
  const viewsOrig = loadWithEngine('../routes/resources', md);

  const listingNew  = viewsNew.renderListing();
  const listingOrig = viewsOrig.renderListing();
  sameBytes('/resources HTML is byte-identical',
    Buffer.from(listingNew, 'utf8'), Buffer.from(listingOrig, 'utf8'));

  const post = orch.getResourceBySlug(ARTICLE_SLUG);
  check(`article "${ARTICLE_SLUG}" exists`, !!post);
  if (post) {
    const articleNew  = viewsNew.renderArticle(post);
    const articleOrig = viewsOrig.renderArticle(md.getResourceBySlug(ARTICLE_SLUG));
    sameBytes(`/resources/${ARTICLE_SLUG} HTML is byte-identical`,
      Buffer.from(articleNew, 'utf8'), Buffer.from(articleOrig, 'utf8'));
  }

  // Every article, not just the sample one — a divergence in one post's
  // Markdown, FAQ or related block would otherwise slip through.
  let allMatch = true;
  let firstBad = '';
  for (const p of orch.getAllResources()) {
    const x = viewsNew.renderArticle(p);
    const y = viewsOrig.renderArticle(md.getResourceBySlug(p.slug));
    if (x !== y) { allMatch = false; firstBad = p.slug; break; }
  }
  check(`all ${orch.getAllResources().length} article pages render byte-identically`, allMatch, firstBad);

  const sitemapNew  = loadWithEngine('../lib/sitemap', orch).buildSitemapXml();
  const sitemapOrig = loadWithEngine('../lib/sitemap', md).buildSitemapXml();
  sameBytes('/sitemap.xml is byte-identical',
    Buffer.from(sitemapNew, 'utf8'), Buffer.from(sitemapOrig, 'utf8'));

  return { listing: listingNew, sitemap: sitemapNew };
}

// SEO surfaces, asserted on the real HTML rather than inferred from the data.
function checkSeoSurfaces(html, label, expected) {
  group(`6. SEO markup — ${label}`);

  const has = (re) => re.test(html);
  check('<title>', has(/<title>[^<]+<\/title>/));
  check('meta description', has(/<meta name="description" content="[^"]+"/));
  check('canonical URL', html.includes(`<link rel="canonical" href="${expected.canonical}">`),
    expected.canonical);
  check('Open Graph (title, description, type, url, image, site_name)',
    ['og:title', 'og:description', 'og:type', 'og:url', 'og:image', 'og:site_name']
      .every((p) => html.includes(`property="${p}"`)));
  check('Twitter card metadata',
    ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']
      .every((p) => html.includes(`name="${p}"`)));

  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  check('JSON-LD block present', !!ld);
  if (ld) {
    let parsed = null;
    try { parsed = JSON.parse(ld[1]); } catch (_) { /* reported below */ }
    check('JSON-LD parses', !!parsed);
    if (parsed) {
      const types = (parsed['@graph'] || []).map((n) => n['@type']);
      check(`JSON-LD @graph contains ${expected.types.join(' + ')}`,
        expected.types.every((t) => types.includes(t)), types.join(', '));
    }
  }
}

async function checkLiveServer(opts, rendered) {
  group('8. The running server serves exactly that');

  const port = opts.port;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.resume();
  child.stderr.resume();

  const responses = {};
  try {
    await waitForServer(port, child);

    const paths = {
      'resources.html': '/resources',
      'article.html':   `/resources/${ARTICLE_SLUG}`,
      'sitemap.xml':    '/sitemap.xml',
    };

    for (const [name, urlPath] of Object.entries(paths)) {
      const r = await get(port, urlPath);
      responses[name] = r;
      check(`GET ${urlPath} → 200`, r.status === 200, `got ${r.status}`);
    }

    check('GET /resources content-type is HTML',
      /text\/html/.test(responses['resources.html'].headers['content-type'] || ''));
    check('GET /sitemap.xml content-type is XML',
      /xml/.test(responses['sitemap.xml'].headers['content-type'] || ''));

    // Re-render in this process with the CMS source loaded, so both sides see
    // the same articles. Without the warm-up the running server would include
    // published CMS posts that this process has never fetched, and the two would
    // differ for a reason that has nothing to do with the renderer.
    const orch = require('../lib/resources');
    await orch.refresh();
    const views = loadWithEngine('../routes/resources', orch);
    const liveListing = views.renderListing();
    const liveSitemap = loadWithEngine('../lib/sitemap', orch).buildSitemapXml();

    sameBytes('served /resources matches what this process renders',
      responses['resources.html'].body, Buffer.from(liveListing, 'utf8'));
    sameBytes('served /sitemap.xml matches what this process builds',
      responses['sitemap.xml'].body, Buffer.from(liveSitemap, 'utf8'));
    console.log(`    ${orch.getAllResources().length} articles in the collection ` +
                `(${orch.cmsStatus().posts} from the CMS)`);

    // warmResources sits in front of these three routes; every article must
    // still resolve through it.
    let allOk = true;
    let firstBad = '';
    for (const p of require('../lib/resources').getAllResources()) {
      const r = await get(port, p.url);
      if (r.status !== 200) { allOk = false; firstBad = `${p.url} → ${r.status}`; break; }
    }
    check('every article URL returns 200 through warmResources', allOk, firstBad);
  } finally {
    child.kill();
  }

  return responses;
}

function checkBaseline(opts, responses) {
  if (opts.saveBaseline) {
    fs.mkdirSync(opts.saveBaseline, { recursive: true });
    for (const [name, r] of Object.entries(responses)) {
      fs.writeFileSync(path.join(opts.saveBaseline, name), r.body);
    }
    console.log(`\n  baseline written to ${opts.saveBaseline}`);
    return;
  }
  if (!opts.baseline) return;

  group('9. Byte-comparison against the pre-refactor baseline');
  for (const [name, r] of Object.entries(responses)) {
    const file = path.join(opts.baseline, name);
    if (!fs.existsSync(file)) { check(`baseline ${name} present`, false, file); continue; }
    const before = fs.readFileSync(file);
    sameBytes(`${name} is byte-identical to the baseline`, r.body, before);
    if (Buffer.compare(before, r.body) === 0) {
      console.log(`    ${before.length} bytes · sha256 ${sha256(before).slice(0, 32)}…`);
    }
  }
}

function checkContentAvailability() {
  group('7. Every existing Markdown resource is still available');

  const orch = require('../lib/resources');
  const files = fs.readdirSync(RESOURCES_DIR).filter((f) =>
    /\.md$/i.test(f) && f.toLowerCase() !== 'readme.md' && !f.startsWith('_') && !f.startsWith('.'));

  const posts = orch.getAllResources();
  check(`all ${files.length} Markdown files are published`, posts.length === files.length,
    `${files.length} files vs ${posts.length} posts`);

  const missing = files
    .map((f) => orch.slugify(f))
    .filter((slug) => !orch.getResourceBySlug(slug));
  check('every Markdown file resolves by slug', missing.length === 0, missing.join(', '));

  for (const slug of [...REDIRECT_SLUGS, ARTICLE_SLUG]) {
    check(`load-bearing slug "${slug}" still resolves`, !!orch.getResourceBySlug(slug));
  }

  const sitemapSlugs = orch.resourceSitemapEntries().map((e) => e.loc);
  check('every post appears in the sitemap',
    posts.every((p) => sitemapSlugs.includes(p.canonical)),
    posts.filter((p) => !sitemapSlugs.includes(p.canonical)).map((p) => p.slug).join(', '));

  const withFaq = posts.filter((p) => p.faq.length);
  console.log(`    ${posts.length} posts · ${withFaq.length} with FAQ · ` +
              `${posts.filter((p) => p.image).length} with a hero image`);
}

/*
 * Vercel serves a real file in public/ from the CDN BEFORE the serverless
 * function is invoked. Express does the opposite locally: a route registered
 * ahead of express.static always wins. So a file in public/ whose name matches
 * a dynamic route is invisible in every local test and silently replaces the
 * route in production.
 *
 * That is not hypothetical. public/sitemap.xml did exactly this: /sitemap.xml
 * kept serving the last committed copy, so a blog published through the admin
 * never appeared in the sitemap no matter how many times it was republished.
 *
 * This walks the routes out of server.js rather than listing them, so a route
 * added later is covered without anyone remembering to come back here.
 */
function checkNoShadowedRoutes() {
  group('10. No file in public/ can shadow a dynamic route on Vercel');

  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const publicDir = path.join(__dirname, '..', 'public');

  const routes = [...server.matchAll(/app\.(?:get|post|put|patch|delete|use)\(\s*'(\/[^']*)'/g)]
    .map((m) => m[1])
    .filter((p) => !p.includes(':') && !p.includes('*') && p !== '/');

  const shadowed = [];
  for (const route of new Set(routes)) {
    const onDisk = path.join(publicDir, route.replace(/^\//, '').split('/').join(path.sep));
    if (fs.existsSync(onDisk) && fs.statSync(onDisk).isFile()) shadowed.push({ route, onDisk });
  }

  // /favicon.ico is the one accepted case: its route only re-serves a file from
  // public/ anyway, so the CDN winning changes nothing.
  const real = shadowed.filter((s) => s.route !== '/favicon.ico');

  check('no dynamic route is shadowed by a file in public/', real.length === 0,
    real.map((s) => `${s.route} ← public${s.route}`).join(', '));

  check('public/sitemap.xml does not exist — /sitemap.xml must stay per-request',
    !fs.existsSync(path.join(publicDir, 'sitemap.xml')));

  console.log(`    ${new Set(routes).size} literal routes checked against public/`);
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  console.log('\nResources refactor verification — orchestrator vs preserved Markdown layer');

  checkPreservedImplementation();
  checkOrchestratorContract();
  await checkWarmResources();
  checkDataEquivalence();
  const rendered = checkRenderedOutput();

  const orch = require('../lib/resources');
  checkSeoSurfaces(rendered.listing, '/resources', {
    canonical: `${orch.SITE}/resources`,
    types: ['BreadcrumbList', 'ItemList'],
  });

  const post = orch.getResourceBySlug(ARTICLE_SLUG);
  if (post) {
    const html = loadWithEngine('../routes/resources', orch).renderArticle(post);
    checkSeoSurfaces(html, `/resources/${ARTICLE_SLUG}`, {
      canonical: post.canonical,
      types: post.faq.length
        ? ['BlogPosting', 'BreadcrumbList', 'FAQPage']
        : ['BlogPosting', 'BreadcrumbList'],
    });
    check('FAQ accordion renders only when the post has FAQ entries',
      post.faq.length ? html.includes('class="faq-section"') : !html.includes('class="faq-section"'));
    check('related-guides block renders with the listing card markup',
      html.includes('class="res-related"') && html.includes('class="res-card"'));
  }

  checkContentAvailability();

  const responses = await checkLiveServer(opts, rendered);
  checkBaseline(opts, responses);
  checkNoShadowedRoutes();

  console.log(`\n${'─'.repeat(72)}`);
  if (failures.length) {
    console.log(`${passed} passed, ${failures.length} FAILED\n`);
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    console.log('');
    process.exitCode = 1;
  } else {
    console.log(`${passed} passed, 0 failed — no public regression\n`);
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error('\nverification crashed:', err);
  process.exitCode = 2;
});
