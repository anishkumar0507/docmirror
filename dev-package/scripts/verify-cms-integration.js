'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   Verifies the CMS integration WITHOUT starting the server.

     node scripts/verify-cms-integration.js

   What it proves:
     1. lib/resources.js still exports the original seven names, still sync
     2. every post object carries every key routes/resources.js reads
     3. the Markdown archive still works with the CMS switched off
     4. CMS field mapping is correct (stubbed response — touches no real data)
     5. a broken, malformed or unreachable CMS degrades to Markdown, never throws
     6. the live CMS, if credentials are present

   Exit 0 = the contract holds. Exit 1 = something downstream would break.
   ────────────────────────────────────────────────────────────────────────── */

require('../lib/env');

let pass = 0;
let fail = 0;

async function check(name, fn) {
  try {
    const detail = await fn();
    pass++;
    console.log(`  PASS  ${name}${detail ? `  (${detail})` : ''}`);
  } catch (err) {
    fail++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err && err.message ? err.message : err}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Reloads the data layer so a changed env / stubbed fetch takes effect. */
function reload() {
  delete require.cache[require.resolve('../lib/cms-client')];
  delete require.cache[require.resolve('../lib/resources')];
  return require('../lib/resources');
}

const warm = (mod) => new Promise((resolve) => mod.warmResources({}, {}, resolve));

/**
 * Every key the original Markdown layer produced. routes/resources.js reads
 * from this set, so a missing key is a broken page — `faq` especially, because
 * the article template iterates it.
 */
const REQUIRED_KEYS = [
  'slug', 'url', 'canonical', 'title', 'seoTitle', 'metaDescription',
  'description', 'excerpt', 'date', 'author', 'category', 'tags',
  'image', 'imageAlt', 'readingTime', 'faq', 'html',
];

function assertShape(post, where) {
  for (const key of REQUIRED_KEYS) assert(key in post, `${where}: missing key "${key}"`);
  assert(typeof post.slug === 'string' && post.slug.length > 0, `${where}: bad slug`);
  assert(Array.isArray(post.tags), `${where}: tags is not an array`);
  assert(Array.isArray(post.faq), `${where}: faq is not an array — the article template iterates it`);
  assert(post.date && typeof post.date === 'object', `${where}: date is not an object`);
  for (const k of ['iso', 'display', 'sortKey']) assert(k in post.date, `${where}: date.${k} missing`);
  assert(typeof post.date.sortKey === 'number', `${where}: date.sortKey is not a number`);
  assert(post.url.startsWith('/'), `${where}: url must be root-relative, got "${post.url}"`);
  assert(/^https?:\/\//.test(post.canonical), `${where}: canonical must be absolute, got "${post.canonical}"`);
}

const SAVED_URL = process.env.CMS_API_URL;
const SAVED_KEY = process.env.CMS_API_KEY;

(async () => {

  /* ── 1. Exports and signatures ─────────────────────────────────────────── */

  console.log('\nExports');

  delete process.env.CMS_API_URL;
  delete process.env.CMS_API_KEY;
  const md = reload();

  await check('original seven exports present', () => {
    for (const n of ['SITE', 'escapeHtml', 'slugify', 'getAllResources',
                     'getResourceBySlug', 'getRelated', 'resourceSitemapEntries']) {
      assert(n in md, `missing export: ${n}`);
    }
    return '7/7';
  });

  await check('the four data functions are still synchronous', () => {
    for (const n of ['getAllResources', 'getResourceBySlug', 'getRelated', 'resourceSitemapEntries']) {
      assert(
        md[n].constructor.name !== 'AsyncFunction',
        `${n} became async — routes/resources.js calls it synchronously and would render a Promise`
      );
    }
    return 'no caller needs await';
  });

  await check('warmResources is Express middleware', () => {
    assert(typeof md.warmResources === 'function', 'not a function');
    assert(md.warmResources.length === 3, `expected (req, res, next), got arity ${md.warmResources.length}`);
    return '(req, res, next)';
  });

  /* ── 2. Markdown archive, CMS off ──────────────────────────────────────── */

  console.log('\nMarkdown archive (CMS not configured)');

  await check('getAllResources() returns the archive', () => {
    const posts = md.getAllResources();
    assert(posts.length > 0, 'no posts — is content/resources/ empty?');
    posts.forEach((p, i) => assertShape(p, `markdown #${i} (${p.slug})`));
    return `${posts.length} posts`;
  });

  await check('sorted newest first', () => {
    const posts = md.getAllResources();
    for (let i = 1; i < posts.length; i++) {
      assert(posts[i - 1].date.sortKey >= posts[i].date.sortKey, `order breaks at index ${i}`);
    }
    return 'descending by date';
  });

  await check('getResourceBySlug() finds a known post with body HTML', () => {
    const first = md.getAllResources()[0];
    const found = md.getResourceBySlug(first.slug);
    assert(found, `not found: ${first.slug}`);
    assert(found.html && found.html.length > 0, 'html empty');
    return first.slug;
  });

  await check('getResourceBySlug() returns null for an unknown slug', () => {
    assert(md.getResourceBySlug('definitely-not-real-xyz') === null, 'expected null');
    return 'null, not undefined';
  });

  await check('getRelated() excludes the post itself', () => {
    const posts = md.getAllResources();
    const rel = md.getRelated(posts[0], 3);
    assert(Array.isArray(rel), 'not an array');
    assert(!rel.some(p => p.slug === posts[0].slug), 'a post was related to itself');
    return `${rel.length} related`;
  });

  await check('resourceSitemapEntries() shape', () => {
    const entries = md.resourceSitemapEntries();
    assert(entries.length > 0, 'no entries');
    for (const e of entries) {
      for (const k of ['loc', 'lastmod', 'changefreq', 'priority']) assert(k in e, `missing "${k}"`);
      assert(e.loc.startsWith('https://'), `loc not absolute: ${e.loc}`);
    }
    return `${entries.length} URLs`;
  });

  await check('lib/sitemap.js still builds unchanged', () => {
    delete require.cache[require.resolve('../lib/sitemap')];
    const { buildSitemapXml } = require('../lib/sitemap');
    const xml = buildSitemapXml();
    assert(xml.includes('<urlset'), 'no <urlset>');
    assert(xml.includes('/resources/'), 'no resource URLs');
    return `${(xml.match(/<url>/g) || []).length} <url> entries`;
  });

  /* ── NO-REGRESSION: the new layer must be indistinguishable from the old
        one whenever the CMS contributes nothing. ─────────────────────────── */

  await check('sitemap entries BYTE-IDENTICAL to the original implementation', () => {
    const original = require('../lib/resources-markdown').resourceSitemapEntries();
    const current = md.resourceSitemapEntries();
    assert(
      JSON.stringify(current) === JSON.stringify(original),
      'sitemap entries differ from the pre-integration implementation'
    );
    return `${current.length} entries, identical`;
  });

  await check('post objects BYTE-IDENTICAL to the original implementation', () => {
    const original = require('../lib/resources-markdown').getAllResources();
    // `_source` is added by the orchestrator for diagnostics; strip it before
    // comparing so the check tests content, not the tag.
    const current = md.getAllResources().map(({ _source, ...rest }) => rest);
    assert(current.length === original.length, `count differs: ${current.length} vs ${original.length}`);
    assert(
      JSON.stringify(current) === JSON.stringify(original),
      'a post object differs from the pre-integration implementation'
    );
    return `${current.length} posts, every field identical`;
  });

  /* ── 3. CMS field mapping, stubbed ─────────────────────────────────────── */

  console.log('\nCMS field mapping (stubbed API — no real data touched)');

  const STUB_POST = {
    id: 'abc', slug: 'cms-mapping-probe', title: 'Mapping Probe',
    excerpt: 'Short summary.', content_html: '<p>Body.</p>',
    published_at: '2026-03-04T09:30:00Z', updated_at: '2026-03-05T10:00:00Z',
    reading_minutes: 7, word_count: 1200,
    canonical_url: 'https://www.thedocmirror.com/resources/cms-mapping-probe',
    featured_image: { url: 'https://cdn.example/x.webp', alt: 'Alt text', width: 1600, height: 900 },
    author: { name: 'Dr Test', slug: 'dr-test' },
    category: { name: 'Research', slug: 'research' },
    tags: [{ name: 'SEO', slug: 'seo' }, { name: 'Local', slug: 'local' }],
    seo: { title: 'SEO Title', description: 'Meta description.' },
  };

  function stubFetch(payload) {
    global.fetch = async () => ({ ok: true, status: 200, json: async () => payload });
  }

  const realFetch = global.fetch;
  let stubbed;

  await check('a CMS post maps onto the full contract', async () => {
    process.env.CMS_API_URL = 'https://stub.invalid/api/v1';
    process.env.CMS_API_KEY = 'pk_live_stub';
    stubFetch({ data: [STUB_POST], meta: { has_next: false } });

    stubbed = reload();
    await warm(stubbed);

    const p = stubbed.getResourceBySlug('cms-mapping-probe');
    assert(p, 'mapped post not found');
    assertShape(p, 'cms post');

    const expect = {
      title: 'Mapping Probe',
      seoTitle: 'SEO Title',
      metaDescription: 'Meta description.',
      description: 'Short summary.',
      excerpt: 'Short summary.',
      author: 'Dr Test',
      category: 'Research',
      image: 'https://cdn.example/x.webp',
      imageAlt: 'Alt text',
      readingTime: 7,
      html: '<p>Body.</p>',
      url: '/resources/cms-mapping-probe',
      canonical: 'https://www.thedocmirror.com/resources/cms-mapping-probe',
    };
    for (const [k, v] of Object.entries(expect)) {
      assert(p[k] === v, `${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(p[k])}`);
    }
    assert(p.tags.join(',') === 'SEO,Local', `tags: ${p.tags}`);
    assert(p.date.iso === '2026-03-04', `date.iso: ${p.date.iso}`);
    assert(p.date.display === 'March 4, 2026', `date.display: ${p.date.display}`);

    return 'all 17 keys correct';
  });

  await check('merge keeps Markdown posts alongside CMS posts', () => {
    const posts = stubbed.getAllResources();
    const src = posts.reduce((a, p) => { a[p._source] = (a[p._source] || 0) + 1; return a; }, {});
    assert(src.cms >= 1, 'no CMS post in the merged set');
    assert(src.markdown >= 1, 'Markdown posts vanished — this would 404 the live archive');
    return `cms=${src.cms} markdown=${src.markdown}`;
  });

  await check('CMS wins when a slug exists in both', async () => {
    const mdFirst = md.getAllResources()[0];
    stubFetch({
      data: [{ ...STUB_POST, slug: mdFirst.slug, title: 'CMS VERSION WINS' }],
      meta: { has_next: false },
    });
    const m = reload();
    await warm(m);
    const p = m.getResourceBySlug(mdFirst.slug);
    assert(p.title === 'CMS VERSION WINS', `got "${p.title}" — Markdown shadowed the CMS`);
    assert(p._source === 'cms', `_source: ${p._source}`);
    const dupes = m.getAllResources().filter(x => x.slug === mdFirst.slug);
    assert(dupes.length === 1, `slug appears ${dupes.length} times after merge`);
    return `${mdFirst.slug} served from CMS, no duplicate`;
  });

  await check('a 200 response with a broken envelope is rejected', async () => {
    stubFetch('<html>oops</html>');
    const m = reload();
    await warm(m);
    const posts = m.getAllResources();
    assert(posts.length > 0, 'no fallback');
    assert(posts.every(p => p._source === 'markdown'), 'a malformed response leaked through as content');
    return 'fell back to Markdown';
  });

  global.fetch = realFetch;

  /* ── 4. Unreachable CMS ────────────────────────────────────────────────── */

  console.log('\nResilience');

  await check('unreachable CMS falls back instead of throwing', async () => {
    process.env.CMS_API_URL = 'http://127.0.0.1:9/api/v1';   // discard port
    process.env.CMS_API_KEY = 'pk_live_not_real';
    const m = reload();
    await warm(m);
    const posts = m.getAllResources();
    assert(posts.length > 0, 'fallback produced no posts');
    assert(posts.every(p => p._source === 'markdown'), 'expected Markdown only');
    return `${posts.length} posts from Markdown`;
  });

  await check('a stale cache is served WITHOUT waiting for the CMS', async () => {
    process.env.CMS_API_URL = 'https://stub.invalid/api/v1';
    process.env.CMS_API_KEY = 'pk_live_stub';
    process.env.CMS_CACHE_TTL_MS = '1';        // stale almost immediately
    stubFetch({ data: [STUB_POST], meta: { has_next: false } });

    const m = reload();
    await warm(m);                              // populates the cache
    await new Promise(r => setTimeout(r, 20));  // now stale

    // Make the CMS slow. A blocking refresh would stall the request.
    //
    // Rejects after a delay rather than never settling: a promise that never
    // resolves leaves a pending libuv handle and its abort timer alive, and
    // process.exit() on top of that trips an assertion inside libuv on Windows
    // — turning a passing run into a garbage exit code.
    let slowSettled;
    global.fetch = () => new Promise((_, reject) => {
      slowSettled = setTimeout(() => reject(new Error('simulated slow CMS')), 120);
    });

    const started = Date.now();
    await warm(m);
    const waited = Date.now() - started;

    // Let the background refresh finish before restoring fetch, so nothing is
    // still in flight when the next check reloads the module.
    await new Promise(r => setTimeout(r, 200));
    clearTimeout(slowSettled);
    global.fetch = realFetch;
    delete process.env.CMS_CACHE_TTL_MS;

    assert(waited < 200, `request blocked for ${waited}ms on a stale cache — should have served immediately`);
    assert(m.getResourceBySlug('cms-mapping-probe'), 'stale post not served');
    return `served in ${waited}ms while revalidating behind the request`;
  });

  await check('a down CMS is not retried on every request (backoff)', async () => {
    process.env.CMS_API_URL = 'http://127.0.0.1:9/api/v1';
    process.env.CMS_API_KEY = 'pk_live_not_real';
    process.env.CMS_FAILURE_BACKOFF_MS = '30000';

    const m = reload();
    await warm(m);                              // first attempt: fails
    assert(m.contentStatus().backingOff, 'no backoff recorded after a failure');

    let calls = 0;
    global.fetch = async () => { calls++; throw new Error('should not be called'); };

    const started = Date.now();
    for (let i = 0; i < 5; i++) await warm(m);
    const waited = Date.now() - started;

    global.fetch = realFetch;
    delete process.env.CMS_FAILURE_BACKOFF_MS;

    assert(calls === 0, `CMS was hit ${calls} more times during backoff`);
    assert(waited < 200, `5 requests took ${waited}ms — each was paying the timeout`);
    return `5 requests, 0 CMS calls, ${waited}ms total`;
  });

  await check('CMS_BASE_PATH cannot collapse to the site root', async () => {
    process.env.CMS_API_URL = 'https://stub.invalid/api/v1';
    process.env.CMS_API_KEY = 'pk_live_stub';
    process.env.CMS_BASE_PATH = '/';            // would normalise to ''
    stubFetch({ data: [STUB_POST], meta: { has_next: false } });

    const m = reload();
    await warm(m);
    const p = m.getResourceBySlug('cms-mapping-probe');

    global.fetch = realFetch;
    delete process.env.CMS_BASE_PATH;

    assert(p.url === '/resources/cms-mapping-probe', `url collapsed to ${p.url}`);
    return 'fell back to /resources instead of relocating live URLs';
  });

  await check('a post with an unusable slug is dropped, not published', async () => {
    process.env.CMS_API_URL = 'https://stub.invalid/api/v1';
    process.env.CMS_API_KEY = 'pk_live_stub';
    stubFetch({
      data: [
        { ...STUB_POST, slug: '' },
        { ...STUB_POST, slug: 'Not A Slug' },
        { ...STUB_POST, slug: 'valid-one' },
      ],
      meta: { has_next: false },
    });

    const m = reload();
    await warm(m);
    const cmsPosts = m.getAllResources().filter(p => p._source === 'cms');

    global.fetch = realFetch;

    assert(cmsPosts.length === 1, `expected 1 valid post, got ${cmsPosts.length}`);
    assert(cmsPosts[0].slug === 'valid-one', `kept the wrong post: ${cmsPosts[0].slug}`);
    assert(!m.getAllResources().some(p => p.url === '/resources/'), 'a post linked to the listing page');
    return '2 bad slugs skipped, 1 kept';
  });

  await check('a good cache survives a later failure', async () => {
    process.env.CMS_API_URL = 'https://stub.invalid/api/v1';
    process.env.CMS_API_KEY = 'pk_live_stub';
    stubFetch({ data: [STUB_POST], meta: { has_next: false } });
    const m = reload();
    await warm(m);
    assert(m.contentStatus().cmsPostCount === 1, 'first warm did not cache');

    // Now break it and force a refresh past the TTL.
    global.fetch = async () => { throw new Error('simulated outage'); };
    await m.refresh();

    assert(m.contentStatus().cmsPostCount === 1, 'a failed refresh discarded the good cache');
    assert(m.getResourceBySlug('cms-mapping-probe'), 'cached post disappeared');
    global.fetch = realFetch;
    return 'stale cache retained, site keeps serving';
  });

  /* ── 5. Live CMS ───────────────────────────────────────────────────────── */

  console.log('\nLive CMS');

  if (!SAVED_URL || !SAVED_KEY) {
    console.log('  SKIP  CMS_API_URL / CMS_API_KEY not set in config/.env.local');
    console.log('        Markdown-only mode is verified above and is a valid deployment state.');
  } else {
    process.env.CMS_API_URL = SAVED_URL;
    process.env.CMS_API_KEY = SAVED_KEY;
    const live = reload();
    await warm(live);

    const s = live.contentStatus();
    console.log(`        mode=${s.mode} basePath=${s.basePath} cmsCached=${s.cmsCached} ` +
                `cmsPosts=${s.cmsPostCount} total=${s.totalPosts} bySource=${JSON.stringify(s.bySource)}`);
    if (s.lastError) console.log(`        lastError: ${s.lastError}`);

    await check('CMS reachable and cached', () => {
      assert(s.cmsCached, `CMS never answered: ${s.lastError || 'unknown'}`);
      return `${s.cmsPostCount} CMS posts`;
    });

    await check('every post satisfies the contract', () => {
      const posts = live.getAllResources();
      posts.forEach((p, i) => assertShape(p, `#${i} (${p.slug}, ${p._source})`));
      return `${posts.length} checked`;
    });

    await check('CMS posts use the live /resources path, never /blog', () => {
      const cmsPosts = live.getAllResources().filter(p => p._source === 'cms');
      if (cmsPosts.length === 0) return 'no CMS posts published yet — nothing to check';
      for (const p of cmsPosts) {
        assert(p.url.startsWith('/resources/'), `wrong url: ${p.url}`);
        assert(!p.canonical.includes('/blog/'), `canonical still points at /blog: ${p.canonical}`);
      }
      return `${cmsPosts.length} on /resources/`;
    });

    await check('no duplicate slugs survived the merge', () => {
      const seen = new Set();
      for (const p of live.getAllResources()) {
        assert(!seen.has(p.slug), `duplicate slug: ${p.slug}`);
        seen.add(p.slug);
      }
      return `${seen.size} unique slugs`;
    });
  }

  console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`}  ` +
              `${pass} passed, ${fail} failed\n`);

  // Drain anything the stubbed-failure checks left in flight before exiting.
  // Calling process.exit() while a socket or timer is mid-close aborts the
  // process with a libuv assertion instead of the intended status code.
  await new Promise(r => setTimeout(r, 250));
  process.exitCode = fail === 0 ? 0 : 1;
})();
