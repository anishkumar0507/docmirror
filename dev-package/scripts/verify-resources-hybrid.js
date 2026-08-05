#!/usr/bin/env node
'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — hybrid Resources verification (Step I)

   Proves that merging the CMS into the public Resources section:
     • leaves the 24 Markdown articles byte-for-byte unchanged
     • never exposes a draft, an archived post or a future scheduled post
     • sorts both sources together chronologically
     • lets a Markdown article keep its URL when a CMS slug collides
     • renders CMS articles with the existing public design
     • keeps working when Supabase is unreachable

   CMS behaviour is exercised with in-memory fixtures through the real merge,
   render and sitemap code — so nothing has to be published to test publishing.
   The fixtures never touch the database and never become reachable over HTTP.

   Usage:  npm run verify-hybrid
   ────────────────────────────────────────────────────────────────────────── */

// Loaded so the CMS source is configured exactly as it is in production. The
// fixture tests below never reach the network; only the final live-draft check
// does, and it skips itself if Supabase is unreachable.
require('../lib/env');

const resources = require('../lib/resources');
const db        = require('../lib/resources-db');
const markdown  = require('../lib/resources-markdown');
const views     = require('../routes/resources');
const { buildSitemapXml, buildSitemapEntries } = require('../lib/sitemap');
const { mapRow, isPublic } = require('../lib/blog-post-mapper');

let passed = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failures.push(label + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}
const group = (t) => console.log(`\n${t}`);

const ld = (html) => {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]) : null;
};
const ldTypes = (html) => (ld(html)['@graph'] || []).map((n) => n['@type']);

// ── fixtures ────────────────────────────────────────────────────────────────
// Shaped exactly like blog_posts rows so they travel the real mapRow() path.

const HOUR = 3600 * 1000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

function row(over) {
  return Object.assign({
    id: 'fixture-' + Math.abs(String(over.slug || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)),
    title: 'Fixture article',
    slug: 'fixture-article',
    excerpt: 'A fixture used by the hybrid verification run.',
    content_md: 'Intro paragraph.\n\n## A heading\n\nBody with **bold**, *italic* and a [link](/resources/geo-for-doctors).\n\n- one\n- two\n\n### Sub heading\n\n> A quote.\n\n---\n\nClosing.',
    author: 'The Doc Mirror Team',
    category: 'AI Visibility',
    tags: ['CMS Tag One', 'CMS Tag Two'],
    read_time_minutes: null,
    featured_image: 'https://arnl.example.supabase.co/storage/v1/object/public/blog-media/2026/08/hero.png',
    image_alt: 'Fixture hero image',
    seo_title: 'Fixture SEO title',
    meta_description: 'Fixture meta description.',
    faq: [],
    related_slugs: [],
    status: 'published',
    published_at: iso(-24 * HOUR),
    enable_article_schema: true,
    enable_faq_schema: true,
  }, over);
}

// ── 1. Markdown is untouched ────────────────────────────────────────────────

function checkMarkdownUntouched() {
  group('1. The Markdown articles are untouched by the merge');

  db._reset();
  const mdOnly = resources.getAllResources();
  check('all 24 Markdown articles present with no CMS posts', mdOnly.length === 24, String(mdOnly.length));
  check('order matches the Markdown layer exactly',
    JSON.stringify(mdOnly.map((p) => p.slug)) === JSON.stringify(markdown.getAllResources().map((p) => p.slug)));

  const sample = resources.getResourceBySlug('medical-schema-markup-ai');
  check('a Markdown article still resolves', !!sample);
  check('it carries no CMS-only keys',
    sample._source === undefined && sample.schema === undefined && sample.relatedSlugs === undefined);

  const before = views.renderArticle(sample);
  check('its page renders no tag chips (Markdown design unchanged)',
    !/aria-label="Tags"/.test(before));
  check('its JSON-LD still has BlogPosting + FAQPage',
    ldTypes(before).includes('BlogPosting') && ldTypes(before).includes('FAQPage'), ldTypes(before).join(', '));

  // With CMS posts present, a Markdown article's own page must not change shape.
  db._setPostsForTest([mapRow(row({ slug: 'cms-fresh', title: 'A CMS article', published_at: iso(-1 * HOUR) }))]);
  const after = views.renderArticle(resources.getResourceBySlug('medical-schema-markup-ai'));
  check('its own markup is unchanged even when CMS posts exist',
    after.replace(/<section class="res-related"[\s\S]*?<\/section>/, '') ===
    before.replace(/<section class="res-related"[\s\S]*?<\/section>/, ''),
    'only the related block may differ');
  db._reset();
}

// ── 2. Eligibility ──────────────────────────────────────────────────────────

function checkEligibility() {
  group('2. Public eligibility — what may and may not be seen');

  const cases = [
    ['draft',                              { status: 'draft',     published_at: iso(-24 * HOUR) }, false],
    ['draft with no date',                 { status: 'draft',     published_at: null },            false],
    ['archived',                           { status: 'archived',  published_at: iso(-24 * HOUR) }, false],
    ['scheduled for later',                { status: 'scheduled', published_at: iso(+24 * HOUR) }, false],
    ['scheduled, time has PASSED',         { status: 'scheduled', published_at: iso(-1 * HOUR) },  true],
    ['published',                          { status: 'published', published_at: iso(-1 * HOUR) },  true],
    ['published with a future date',       { status: 'published', published_at: iso(+24 * HOUR) }, false],
    ['published with no date',             { status: 'published', published_at: null },            false],
  ];

  for (const [label, over, want] of cases) {
    check(`${label} → ${want ? 'PUBLIC' : 'not public'}`, isPublic(row(over)) === want);
  }

  check('a due scheduled post is eligible without any status change',
    isPublic(row({ status: 'scheduled', published_at: iso(-1000) })),
    'this is what removes the need for a cron');
}

// ── 3. Merge, sort, collisions ──────────────────────────────────────────────

function checkMerge() {
  group('3. Merging and chronological ordering across both sources');

  const md = markdown.getAllResources();
  const newest = md[0];
  const second = md[1];

  // One CMS post newer than everything, one between the top two Markdown ones.
  const above = mapRow(row({ slug: 'cms-newest', title: 'CMS newest', published_at: iso(+0 - 1000) }));
  const between = mapRow(row({
    slug: 'cms-between', title: 'CMS between',
    published_at: new Date(newest.date.sortKey - 1000).toISOString(),
  }));
  db._setPostsForTest([above, between]);

  const all = resources.getAllResources();
  check('both CMS posts joined the collection', all.length === 26, String(all.length));

  const order = all.map((p) => p.slug);
  check('the newest CMS post is first', order[0] === 'cms-newest', order.slice(0, 3).join(', '));
  check('the newest Markdown article is second', order[1] === newest.slug, order.slice(0, 3).join(', '));
  check('the CMS post dated between them sits between them',
    order[2] === 'cms-between', order.slice(0, 4).join(', '));
  check('the next Markdown article follows', order[3] === second.slug, order.slice(0, 5).join(', '));
  check('CMS posts are NOT grouped above Markdown posts',
    order.indexOf('cms-between') > order.indexOf(newest.slug));

  check('the whole collection is sorted newest-first',
    all.every((p, i) => i === 0 || all[i - 1].date.sortKey >= p.date.sortKey));

  group('4. Slug collision — the Markdown article keeps its URL');
  db._setPostsForTest([
    mapRow(row({ slug: 'geo-for-doctors', title: 'CMS impostor', published_at: iso(-1000) })),
    mapRow(row({ slug: 'cms-only-slug', title: 'CMS only', published_at: iso(-2000) })),
  ]);
  const merged = resources.getAllResources();
  const clashes = merged.filter((p) => p.slug === 'geo-for-doctors');
  check('the colliding slug appears exactly once', clashes.length === 1, String(clashes.length));
  check('the Markdown article won', clashes[0]._source === undefined && clashes[0].title !== 'CMS impostor',
    clashes[0].title);
  check('the CMS impostor is not in the collection', !merged.some((p) => p.title === 'CMS impostor'));
  check('lookup by that slug returns the Markdown article',
    resources.getResourceBySlug('geo-for-doctors').title !== 'CMS impostor');
  check('a CMS-only slug still resolves normally',
    (resources.getResourceBySlug('cms-only-slug') || {}).title === 'CMS only');
  check('the sitemap lists the colliding slug once',
    buildSitemapEntries().filter((e) => e.loc.endsWith('/geo-for-doctors')).length === 1);
  db._reset();
}

// ── 5. CMS detail rendering ─────────────────────────────────────────────────

function checkDetailRendering() {
  group('5. A CMS article renders with the existing public design');

  const post = mapRow(row({
    slug: 'cms-render-test', title: 'CMS render test',
    faq: [{ question: 'Q one?', answer: 'A one.' }, { question: 'Q two?', answer: 'A two.' }],
  }));
  db._setPostsForTest([post]);
  const html = views.renderArticle(post);

  check('uses the shared article shell', /class="res-content"/.test(html) && /id="dm-header"/.test(html));
  check('the same CSS token block is inlined', /--navy:#0A2540/.test(html));
  check('H2 rendered', /<h2[^>]*>A heading<\/h2>/.test(html));
  check('H3 rendered', /<h3[^>]*>Sub heading<\/h3>/.test(html));
  check('bold + italic rendered', /<strong>bold<\/strong>/.test(html) && /<em>italic<\/em>/.test(html));
  check('bullet list rendered', /<ul>\s*<li>one<\/li>/.test(html));
  check('clickable internal link rendered',
    /<a href="\/resources\/geo-for-doctors">link<\/a>/.test(html));
  check('blockquote rendered', /<blockquote>/.test(html));
  check('divider rendered', /<hr>/.test(html));
  check('hero image uses the Storage URL', html.includes('blog-media/2026/08/hero.png'));
  check('image ALT applied', /alt="Fixture hero image"/.test(html));
  check('no double-prefixed image URL', !/https:\/\/www\.thedocmirror\.com https?:\/\//.test(html) &&
    !/src="\/https:/.test(html));
  check('reading time shown', /min read/.test(html));
  check('author shown', /By The Doc Mirror Team/.test(html));
  check('breadcrumb + back link present', /res-crumbs/.test(html) && /Back to Resources/.test(html));

  group('  — tags render on CMS articles only');
  check('CMS article shows its tag chips', /aria-label="Tags"/.test(html) &&
    /<span class="res-card-cat">CMS Tag One<\/span>/.test(html));
  check('tags reuse existing classes, no new CSS', !/res-tags|adm-/.test(html));

  group('  — table support');
  const tablePost = mapRow(row({
    slug: 'cms-table', content_md: '| A | B |\n| --- | --- |\n| 1 | 2 |',
  }));
  const tableHtml = views.renderArticle(tablePost);
  check('table renders inside the mobile scroll wrapper',
    /<div class="res-table-wrap"><table>/.test(tableHtml));

  group('  — listing card');
  const listing = views.renderListing();
  check('the CMS article appears on the listing', listing.includes('cms-render-test'));
  check('its card uses the standard markup',
    /<a class="res-(card|featured)"[^>]*href="\/resources\/cms-render-test"/.test(listing));
  check('its excerpt and category show', listing.includes('AI Visibility'));

  db._reset();
}

// ── 6. FAQ + schema toggles ─────────────────────────────────────────────────

function checkFaqAndSchema() {
  group('6. FAQ rendering and structured-data toggles');

  const withFaq = mapRow(row({ slug: 'cms-faq', faq: [{ question: 'Q?', answer: 'A.' }] }));
  const noFaq   = mapRow(row({ slug: 'cms-nofaq', faq: [] }));

  const hFaq = views.renderArticle(withFaq);
  const hNo  = views.renderArticle(noFaq);
  check('FAQ section renders when there are questions', /class="faq-section"/.test(hFaq));
  check('no FAQ section at all when the list is empty', !/class="faq-section"/.test(hNo));
  check('FAQPage schema emitted with questions', ldTypes(hFaq).includes('FAQPage'));
  check('no FAQPage schema without questions', !ldTypes(hNo).includes('FAQPage'));

  const faqOff = views.renderArticle(mapRow(row({ slug: 'x1', faq: [{ question: 'Q?', answer: 'A.' }], enable_faq_schema: false })));
  check('FAQ schema OFF removes FAQPage', !ldTypes(faqOff).includes('FAQPage'));
  check('FAQ schema OFF keeps the FAQ visible on the page', /class="faq-section"/.test(faqOff));

  const artOff = views.renderArticle(mapRow(row({ slug: 'x2', enable_article_schema: false })));
  check('Article schema OFF removes BlogPosting', !ldTypes(artOff).includes('BlogPosting'));
  check('BreadcrumbList survives either way', ldTypes(artOff).includes('BreadcrumbList'));

  const bothOff = views.renderArticle(mapRow(row({
    slug: 'x3', faq: [{ question: 'Q?', answer: 'A.' }],
    enable_article_schema: false, enable_faq_schema: false,
  })));
  check('both OFF leaves only BreadcrumbList',
    JSON.stringify(ldTypes(bothOff)) === '["BreadcrumbList"]', ldTypes(bothOff).join(', '));
  check('JSON-LD still parses with both off', !!ld(bothOff));
}

// ── 7. SEO ──────────────────────────────────────────────────────────────────

function checkSeo() {
  group('7. SEO on a CMS article');

  const post = mapRow(row({ slug: 'cms-seo', title: 'CMS SEO test' }));
  const html = views.renderArticle(post);

  check('<title> uses seo_title', /<title>Fixture SEO title<\/title>/.test(html));
  check('meta description uses meta_description',
    /<meta name="description" content="Fixture meta description\.">/.test(html));
  check('canonical is the real Doc Mirror Resources URL',
    html.includes('<link rel="canonical" href="https://www.thedocmirror.com/resources/cms-seo">'));
  check('canonical never uses nextdot.co.in', !/nextdot\.co\.in/.test(html));
  check('og:url matches the canonical',
    html.includes('<meta property="og:url" content="https://www.thedocmirror.com/resources/cms-seo">'));
  check('og:image is the absolute Storage URL',
    /<meta property="og:image" content="https:\/\/[^"]*blog-media[^"]*">/.test(html));
  check('all Open Graph tags present',
    ['og:title', 'og:description', 'og:type', 'og:url', 'og:image', 'og:site_name']
      .every((p) => html.includes(`property="${p}"`)));
  check('all Twitter tags present',
    ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']
      .every((p) => html.includes(`name="${p}"`)));

  const article = (ld(html)['@graph'] || []).find((n) => n['@type'] === 'BlogPosting');
  check('BlogPosting carries the publish date', !!article && !!article.datePublished);
  check('BlogPosting mainEntityOfPage is the canonical',
    article.mainEntityOfPage === 'https://www.thedocmirror.com/resources/cms-seo');
  check('BlogPosting author is the CMS author',
    article.author && article.author.name === 'The Doc Mirror Team');
}

// ── 8. Related in this series ───────────────────────────────────────────────

function checkRelated() {
  group('8. Related in this series');

  const cmsA = mapRow(row({ slug: 'cms-a', title: 'CMS A', published_at: iso(-2 * HOUR) }));
  const cmsB = mapRow(row({ slug: 'cms-b', title: 'CMS B', published_at: iso(-3 * HOUR) }));

  // Manual list mixing a Markdown slug, a CMS slug, and two that must drop out.
  const withManual = mapRow(row({
    slug: 'cms-with-related', title: 'CMS with related', published_at: iso(-1 * HOUR),
    related_slugs: ['geo-for-doctors', 'cms-a', 'doc-mirror-cms-test-blog', 'does-not-exist'],
  }));

  db._setPostsForTest([cmsA, cmsB, withManual]);

  const rel = resources.getRelated(withManual, 3);
  const slugs = rel.map((p) => p.slug);
  check('a Markdown article can be selected as related', slugs.includes('geo-for-doctors'));
  check('a CMS article can be selected as related', slugs.includes('cms-a'));
  check('a DRAFT slug is filtered out', !slugs.includes('doc-mirror-cms-test-blog'), slugs.join(', '));
  check('a non-existent slug is filtered out', !slugs.includes('does-not-exist'));
  check('the manual order is preserved',
    JSON.stringify(slugs) === '["geo-for-doctors","cms-a"]', JSON.stringify(slugs));
  check('the manual list is not truncated to the default 3-item limit',
    resources.getRelated(mapRow(row({
      slug: 'cms-many', published_at: iso(-4 * HOUR),
      related_slugs: ['geo-for-doctors', 'cms-a', 'cms-b', 'what-is-doctor-online-visibility'],
    })), 3).length === 4);

  const html = views.renderArticle(withManual);
  check('related renders with the existing card markup',
    /<section class="res-related"/.test(html) && /class="res-card"/.test(html));
  check('related links are clickable resource URLs',
    /href="\/resources\/geo-for-doctors"/.test(html) && /href="\/resources\/cms-a"/.test(html));
  check('no draft leaked into the rendered related block',
    !html.includes('doc-mirror-cms-test-blog'));

  const allDead = mapRow(row({
    slug: 'cms-dead-related', published_at: iso(-5 * HOUR),
    related_slugs: ['gone-one', 'gone-two'],
  }));
  const deadRel = resources.getRelated(allDead, 3);
  check('a fully unresolvable list falls back to automatic related, not a crash',
    Array.isArray(deadRel) && deadRel.length > 0, String(deadRel.length));

  const mdPost = markdown.getResourceBySlug('geo-for-doctors');
  check('a Markdown article with no manual list still uses the automatic algorithm',
    resources.getRelated(mdPost, 3).length === 3);

  db._reset();
}

// ── 9. Sitemap ──────────────────────────────────────────────────────────────

function checkSitemap() {
  group('9. Sitemap');

  db._reset();
  const mdEntries = buildSitemapEntries().filter((e) => e.loc.includes('/resources/'));
  check('Markdown-only sitemap lists 24 articles', mdEntries.length === 24, String(mdEntries.length));

  db._setPostsForTest([
    mapRow(row({ slug: 'cms-live', published_at: iso(-1 * HOUR) })),
    mapRow(row({ slug: 'cms-due-scheduled', status: 'scheduled', published_at: iso(-1 * HOUR) })),
  ]);
  const xml = buildSitemapXml();
  const entries = buildSitemapEntries().filter((e) => e.loc.includes('/resources/'));

  check('eligible CMS articles are added', entries.length === 26, String(entries.length));
  check('a published CMS article is in the XML', xml.includes('/resources/cms-live'));
  check('a due scheduled CMS article is in the XML', xml.includes('/resources/cms-due-scheduled'));
  check('all 24 Markdown URLs are still there',
    markdown.getAllResources().every((p) => xml.includes(p.canonical)));
  check('every loc appears exactly once',
    (() => { const locs = buildSitemapEntries().map((e) => e.loc); return new Set(locs).size === locs.length; })());
  check('the CMS lastmod is the publish date',
    /<loc>[^<]*cms-live<\/loc>\s*<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(xml));
  check('the static pages are still listed',
    xml.includes('<loc>https://www.thedocmirror.com/</loc>') && xml.includes('/pricing'));
  check('no /admin URL', !/\/admin/.test(xml));

  db._reset();
}

// ── 10. Failure fallback ────────────────────────────────────────────────────

async function checkFallback() {
  group('10. Supabase failure — the site keeps working');

  db._reset();
  const supa = require('../lib/supabase-client');
  const realGet = supa.getSupabaseClient;

  // A client whose every query rejects, the way an unreachable Supabase behaves.
  supa.getSupabaseClient = () => ({
    from() {
      const q = {
        select() { return q; }, in() { return q; }, lte() { return q; },
        order() { return q; }, limit() { return Promise.reject(new Error('fetch failed (simulated outage)')); },
        then(res, rej) { return Promise.reject(new Error('fetch failed (simulated outage)')).then(res, rej); },
      };
      return q;
    },
  });

  let threw = false;
  try { await db._load(); } catch (_) { threw = true; }
  check('a failed load never throws', !threw);
  check('no CMS posts are served after a failure', db.getPosts().length === 0);

  const all = resources.getAllResources();
  check('the 24 Markdown articles still render', all.length === 24, String(all.length));

  let listingOk = true, articleOk = true;
  try { views.renderListing(); } catch (_) { listingOk = false; }
  try { views.renderArticle(resources.getResourceBySlug('geo-for-doctors')); } catch (_) { articleOk = false; }
  check('/resources listing still builds', listingOk);
  check('a Markdown article page still builds', articleOk);

  let sitemapOk = true;
  try { buildSitemapXml(); } catch (_) { sitemapOk = false; }
  check('the sitemap still builds', sitemapOk);

  check('the failure is recorded for the operator', !!db.status().lastError);
  check('the recorded error carries no secret',
    !/eyJ|sb_secret_|SERVICE_ROLE/.test(db.status().lastError || ''));

  // A second immediate attempt must be suppressed, or an outage would make
  // every request pay the full Supabase timeout.
  const t0 = Date.now();
  const pending = resources.refresh();
  check('during backoff, refresh() does not block the request',
    pending === null && (Date.now() - t0) < 50, `${Date.now() - t0}ms`);

  supa.getSupabaseClient = realGet;
  db._reset();
}

// ── 11. Security ────────────────────────────────────────────────────────────

function checkSecurity() {
  group('11. Nothing secret reaches the public HTML');

  db._setPostsForTest([mapRow(row({ slug: 'cms-sec' }))]);
  const pages = [views.renderListing(), views.renderArticle(resources.getResourceBySlug('cms-sec')), buildSitemapXml()];
  const SHAPES = [
    [/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/, 'JWT'],
    [/sb_secret_[A-Za-z0-9_-]{8,}/, 'Supabase secret key'],
    [/SUPABASE_SERVICE_ROLE_KEY/, 'service key name'],
    [/process\.env/, 'server env access'],
    [/blog_posts|blog_categories|blog_media/, 'internal table name'],
  ];
  for (const [re, label] of SHAPES) {
    check(`no ${label} in any public output`, pages.every((p) => !re.test(p)));
  }
  check('the CMS row id is not exposed',
    pages.every((p) => !/fixture-/.test(p)));
  db._reset();
}

// ── 12. The real drafts stay private ────────────────────────────────────────

async function checkRealDrafts() {
  group('12. The two real CMS drafts remain private');

  db._reset();
  const loaded = await db._load();
  if (!loaded) {
    console.log('  ~ skipped live check (Supabase unreachable from here)');
    return;
  }

  const posts = db.getPosts();
  console.log(`    live query returned ${posts.length} publicly-eligible CMS post(s)`);
  check('the query returns no draft', posts.length === 0, posts.map((p) => p.slug).join(', '));

  const all = resources.getAllResources();
  for (const slug of ['doc-mirror-cms-test-blog', 'cms-test-draft-step-e-verification']) {
    check(`"${slug}" is absent from the public collection`, !all.some((p) => p.slug === slug));
    check(`"${slug}" does not resolve by slug`, !resources.getResourceBySlug(slug));
    check(`"${slug}" is absent from the sitemap`, !buildSitemapXml().includes(slug));
  }
  const listing = views.renderListing();
  check('neither draft appears on the listing',
    !listing.includes('doc-mirror-cms-test-blog') && !listing.includes('cms-test-draft-step-e'));
  check('the public collection is still exactly the 24 Markdown articles',
    all.length === 24, String(all.length));
}

// ── main ────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\nHybrid Resources verification — Markdown + CMS');

  checkMarkdownUntouched();
  checkEligibility();
  checkMerge();
  checkDetailRendering();
  checkFaqAndSchema();
  checkSeo();
  checkRelated();
  checkSitemap();
  await checkFallback();
  checkSecurity();
  await checkRealDrafts();

  console.log(`\n${'─'.repeat(72)}`);
  if (failures.length) {
    console.log(`${passed} passed, ${failures.length} FAILED\n`);
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    console.log('');
    process.exitCode = 1;
  } else {
    console.log(`${passed} passed, 0 failed — hybrid Resources behave correctly\n`);
    process.exitCode = 0;
  }
})().catch((err) => { console.error('\nverification crashed:', err); process.exitCode = 2; });
