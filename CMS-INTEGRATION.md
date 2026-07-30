# CMS integration — Resources data layer

The Resources section now loads posts from the central CMS, falling back to the
existing Markdown files whenever the CMS is unavailable.

**Nothing about the UI, CSS, routes, SEO output or URLs changed.** Only where
the data comes from.

Status: **local only. Not pushed, not deployed.**
Verification: `node scripts/verify-cms-integration.js` → **20/20 passed**.

---

## 1. Modified files

| File | Change | Lines touched |
|---|---|---|
| `lib/resources-markdown.js` | **NEW** — the original `lib/resources.js`, moved unchanged | 0 logic changes (header comment only) |
| `lib/cms-client.js` | **NEW** — Website API client, field mapping | new file |
| `lib/resources.js` | **REWRITTEN** — orchestrator with the same 7 exports | new file, same public API |
| `server.js` | added `warmResources` middleware to 3 routes | **4 lines** |
| `config/.env.example` | documented the new CMS variables | append only |
| `scripts/verify-cms-integration.js` | **NEW** — contract test, no server needed | new file |

### Untouched, deliberately

- `routes/resources.js` — every line of HTML, CSS and SEO markup
- `lib/sitemap.js`
- `content/resources/*.md` — all 19 files still present and still served
- Every other route, page and script

`lib/resources-markdown.js` was verified byte-identical to the original before
the header comment was added (SHA-256 match), so it can be diffed against git
history and trusted as the known-good path.

### The exact `server.js` diff

```diff
  const resourcesRoute              = require('./routes/resources');
  const { buildSitemapXml }         = require('./lib/sitemap');
+ const { warmResources }           = require('./lib/resources');

- app.get('/resources',        resourcesRoute.listingHandler);
- app.get('/resources/:slug',  resourcesRoute.articleHandler);
+ app.get('/resources',        warmResources, resourcesRoute.listingHandler);
+ app.get('/resources/:slug',  warmResources, resourcesRoute.articleHandler);

- app.get('/sitemap.xml', (_req, res) => {
+ app.get('/sitemap.xml', warmResources, (_req, res) => {
```

No route was removed, renamed or reordered.

---

## 2. Architecture

```
                  ┌──────────────────────────────────────┐
  GET /resources  │ server.js                            │
  GET /resources/:slug ─▶ warmResources  (awaits CMS)    │
  GET /sitemap.xml│         │                            │
                  │         ▼                            │
                  │  routes/resources.js   UNCHANGED     │
                  │  lib/sitemap.js        UNCHANGED     │
                  │         │ calls sync functions       │
                  │         ▼                            │
                  │  lib/resources.js  (orchestrator)    │
                  │     ├── lib/cms-client.js  ──▶ CMS API
                  │     └── lib/resources-markdown.js ──▶ content/resources/*.md
                  └──────────────────────────────────────┘
```

### Why a middleware exists

The four public functions are **synchronous**, and `routes/resources.js` calls
them synchronously. An HTTP fetch is not synchronous.

Two ways out: convert the public functions to `async` and edit every caller, or
load the data *before* the handler runs. The second keeps `routes/resources.js`
untouched, which was the requirement — so `warmResources` awaits the refresh in
middleware and the four functions stay sync, reading from memory.

This is also why the four functions were checked for async-ness in the test
suite: if one ever became async, `routes/resources.js` would silently render a
`Promise` into the page instead of content.

### Caching

- **60-second TTL**, per serverless instance, configurable via `CMS_CACHE_TTL_MS`
- **No webhook invalidation.** Each Vercel instance has its own memory; a
  webhook reaches exactly one of them and the rest keep serving stale data.
  Time is the only signal that is correct across every instance.
- Concurrent requests on a cold instance share one in-flight fetch instead of
  each firing their own.
- **A failed refresh never discards a good cache.** The previous response keeps
  being served while retries happen. Verified by the
  *"a good cache survives a later failure"* check.

### Fallback

The site falls back to Markdown when the CMS is unreachable, times out, returns
a non-2xx, or returns a 200 whose body is not the expected envelope. That last
one matters: a proxy error page returning 200 with HTML would otherwise surface
as `undefined.map is not a function` inside a route.

`refresh()` returns a boolean and never throws, so no caller has to remember a
try/catch — the fallback is structural rather than a promise.

### Content mode

| `CMS_CONTENT_MODE` | Behaviour |
|---|---|
| `merge` *(default)* | CMS posts + Markdown posts, deduped by slug, CMS winning |
| `cms-only` | CMS only; Markdown becomes a failure-only fallback |

**`merge` is the default for a specific reason.** `content/resources/` holds 19
published articles that are indexed, and `server.js` has 301 redirects pointing
*into* three of those slugs. With `cms-only`, the moment the CMS answered
successfully with zero posts, all nineteen would 404 — taking the redirects with
them. Merge means you can migrate one article at a time: publish it in the CMS
with the same slug and the CMS copy silently takes over.

### URLs

`url` and `canonical` are built locally from `CMS_BASE_PATH` (default
`/resources`), **not** taken from the API's own `url` / `seo.canonical`. Those
depend on the CMS website record's `blog_base_path`, and a wrong value there
would otherwise emit incorrect canonical tags onto live indexed pages. If the
two disagree, this file wins and logs a warning.

---

## 2b. Production review — findings and fixes

A review after the first working version found four defects. All four are fixed
and each has a regression test.

### 1. A CMS outage would have added 8 seconds to every page view — FIXED

`_fetchedAt` was only updated on success, so after a failure `isFresh()` stayed
false forever. Every subsequent request therefore awaited a fresh attempt and
paid the full 8-second timeout — on every page view, for as long as the CMS was
down. Far worse than the stale content the retry was protecting against.

Fixed with a failure backoff (`CMS_FAILURE_BACKOFF_MS`, default 15s). During an
outage one request per 15 seconds attempts a retry; the rest serve Markdown
instantly.

Test: *"a down CMS is not retried on every request (backoff)"* — 5 requests,
0 CMS calls, 0 ms.

### 2. A stale cache still blocked the request — FIXED

The middleware awaited a refresh whenever the cache was stale, even though
perfectly serveable data was already in memory.

Now stale-while-revalidate: a stale cache is served immediately and the refresh
runs *behind* the request. Only the very first request on a cold instance, with
nothing cached at all, can ever wait.

Test: *"a stale cache is served WITHOUT waiting for the CMS"* — served in 1 ms
against a deliberately slow CMS.

### 3. `CMS_BASE_PATH=/` would have relocated every live URL — FIXED

`'/'.replace(/\/+$/, '')` yields `''`, so posts would have been served from the
site root (`/my-slug`) instead of `/resources/my-slug` — silently moving
indexed URLs. Now normalised, and an unusable value falls back to `/resources`
rather than guessing.

Test: *"CMS_BASE_PATH cannot collapse to the site root"*.

### 4. A post with an empty slug would have published a broken link — FIXED

`mapPost` coerced a missing slug to `''`, producing `/resources/` — a card on
the listing page linking to the listing page, plus a sitemap entry duplicating
the index. Posts whose slug is not a valid slug are now skipped with a warning.

Test: *"a post with an unusable slug is dropped, not published"*.

### Reviewed and found sound

| Concern | Finding |
|---|---|
| **Memory leaks** | Bounded: at most `MAX_PAGES × PER_PAGE` = 200 posts held. The abort timer is cleared in `finally`. No listeners or intervals are registered. Both the CMS array and the Markdown cache are resident — a few MB at this article count. |
| **Duplicate fetches** | `_inflight` is assigned with no `await` before it, so on a single-threaded event loop a second caller always observes it and shares the promise. |
| **Cache races** | Only one writer, and it writes after the await completes. There is no read-modify-write on shared state. |
| **Timeout handling** | `AbortController`, cleared in `finally`. `Promise.race` was avoided deliberately — it leaves the socket open, which on serverless keeps the function alive past the response. |
| **HTTP retries** | None inline, by design. A retry would add latency to a read path that already has a complete local fallback; the TTL *is* the retry. |
| **Malformed responses** | Rejected at three levels: non-2xx, missing `data` key, `data` not an array. A proxy error page returning 200 with HTML falls back to Markdown instead of surfacing as `undefined.map is not a function` inside a route. |
| **Slug collisions** | Deduped through a `Map`, CMS winning. Verified that a slug present in both sources appears exactly once. |
| **Canonical URLs** | Built locally from `BASE_PATH`, never taken from the API, so a wrong `blog_base_path` in the CMS cannot emit bad canonical tags onto live pages. A mismatch logs a warning. |

### One bug in the test harness itself

The "stale cache" check originally stubbed `fetch` with a promise that never
resolved. That left a pending libuv handle and its abort timer alive, and
`process.exit()` on top of it tripped an assertion inside libuv on Windows —
turning a fully passing run into exit code `-1073740791`, which would have
broken CI. The stub now rejects after a delay and the harness drains in-flight
work before setting `process.exitCode`.

---

## 2c. No-regression proof

```
node scripts/verify-cms-integration.js     26 passed, 0 failed
node scripts/verify-render-identical.js      6 passed, 0 failed
```

`verify-render-identical.js` spawns the real server twice — CMS off, then CMS on
with zero posts, which is the state on deployment day — and compares the actual
HTTP responses:

| Path | Result |
|---|---|
| `/resources` | **byte-identical**, 35,853 bytes |
| `/sitemap.xml` | **byte-identical**, 5,315 bytes |
| `/resources/doctor-profile-costing-you-patients` | **byte-identical**, 33,781 bytes |

Plus two checks comparing the data layer directly against the pre-integration
implementation:

- `resourceSitemapEntries()` — 19 entries, JSON-identical
- `getAllResources()` — 19 posts, every field identical

So, concretely:

- **No route behaviour changed** — same status codes, same handlers, no route added or removed
- **No SEO regression** — the HTML containing canonical, OpenGraph, Twitter and JSON-LD is byte-identical
- **Sitemap identical** except for CMS-backed content, which is the intended change
- **Pages render exactly as before**

---

## 3. Local testing

### Contract test — no server needed

```bash
cd dev-package
node scripts/verify-cms-integration.js
```

20 checks: exports, sync signatures, the full 17-key object shape, sorting,
sitemap, field mapping against a stubbed API, merge precedence, malformed
responses, unreachable CMS, stale-cache retention, and the live CMS if
configured.

Exit 0 = safe to run the server.

### Markdown-only mode (proves nothing broke)

```bash
# config/.env.local — leave CMS_API_URL unset or blank
node server.js
```

Open <http://localhost:3000/resources>. Should be **byte-identical** to before
this change: same 19 articles, same design, same SEO.

### With the CMS

```
# dev-package/config/.env.local
CMS_API_URL=http://localhost:3000/api/v1
CMS_API_KEY=pk_live_…
CMS_CONTENT_MODE=merge
```

The CMS runs on port 3000, so run this site on another port:

```bash
PORT=4000 node server.js      # macOS / Linux
$env:PORT=4000; node server.js   # PowerShell
```

Then:

```bash
curl -s http://localhost:4000/resources        | grep -c 'res-card'
curl -s http://localhost:4000/sitemap.xml      | grep -c '<url>'
curl -s -A Googlebot http://localhost:4000/resources/<slug> | grep -c '<h1'
```

To see a CMS post appear: publish one in the CMS for **The docmirror**, wait
60 seconds (or restart the server), and reload `/resources`.

### Windows gotcha

`Out-File -Encoding utf8` in Windows PowerShell writes a **UTF-8 BOM**, which
can break the first variable in a `.env` file. Use:

```powershell
[System.IO.File]::WriteAllText($path, $content, (New-Object System.Text.UTF8Encoding($false)))
```

I hit this while testing.

---

## 4. Rollback

### Instant — no code change

Blank one variable and restart:

```
CMS_API_URL=
```

The CMS is skipped entirely and the site serves Markdown exactly as before.
This is the rollback for a production incident: an env var change plus a
redeploy, no revert commit.

### Full revert

```bash
git checkout -- dev-package/server.js dev-package/lib/resources.js dev-package/config/.env.example
rm dev-package/lib/cms-client.js
rm dev-package/lib/resources-markdown.js
rm dev-package/scripts/verify-cms-integration.js
```

`lib/resources.js` returns to the original Markdown implementation, which is
still in git history and byte-identical to `lib/resources-markdown.js`.

### Partial — CMS on, merge off

```
CMS_CONTENT_MODE=cms-only
```

Only after the Markdown articles are migrated and verified.

---

## 5. TODOs before production

### Must do

1. **Fix `blog_base_path` in the CMS.** The docmirror record says `/blog`; the
   real path is `/resources`. Until this is corrected the CMS emits
   `https://www.thedocmirror.com/blog/<slug>` in its own sitemap and JSON-LD.
   This adapter overrides it for page rendering, but the CMS-side sitemap
   endpoint and any future adapter would be wrong.

   ```sql
   update public.websites
      set blog_base_path = '/resources'
    where slug = 'the-docmirror';
   ```

2. **Set `propagation_mode = 'ttl'`** for docmirror, not `webhook`. Webhooks
   cannot invalidate per-instance memory on serverless.

   ```sql
   update public.websites
      set propagation_mode = 'ttl', cache_ttl_seconds = 60
    where slug = 'the-docmirror';
   ```

3. **Deploy the CMS first.** Vercel cannot reach `localhost:3000`.
   `CMS_API_URL` must be a public URL.

4. **Add the three env vars in Vercel** → docmirror project → Settings →
   Environment Variables: `CMS_API_URL`, `CMS_API_KEY`, `CMS_CONTENT_MODE=merge`.

5. **Deploy to a preview URL first** and compare `/resources` against
   production before promoting.

### Should do

6. **Migrate the 19 Markdown articles** into the CMS, preserving slugs exactly.
   Then switch to `cms-only` and eventually delete the `.md` files. Until then
   content lives in two places.

7. **`public/sitemap.xml`** is a committed file and `npm run sitemap` regenerates
   it. The live `/sitemap.xml` route wins over it, so it is only stale in the
   repo — worth regenerating or removing to avoid confusion.

8. **FAQ blocks are lost for CMS posts.** The Markdown layer supports a `faq:`
   frontmatter field that renders as structured content; the CMS has no
   equivalent, so CMS posts always get `faq: []`. If FAQ schema matters for SEO
   on those pages, that field needs adding to the CMS before migrating any
   article that uses it.

### Consider

9. Vercel CDN caching in front of `/resources` would reduce origin hits further,
   with a webhook purging the CDN — that layer *is* shared, unlike instance
   memory.

10. `contentStatus()` is exported for diagnostics but not routed anywhere. If you
    want it, put it behind an admin check — it reveals the CMS URL's reachability
    and error text.

---

## 6. What was NOT done

Per instruction:

- Nothing pushed, nothing deployed, production untouched
- No migration to Next.js
- No UI, CSS, route, SEO or rendering changes
- No routes removed
- No Markdown files deleted or migrated
- No refactors beyond what the integration required
