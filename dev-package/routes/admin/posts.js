'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   Admin CMS — blog_posts CRUD

     GET   /api/admin/posts                 list (search + status filter)
     GET   /api/admin/posts/slug-check      is this slug free?
     GET   /api/admin/posts/related-search   pick "Related in this series"
     GET   /api/admin/posts/:id             load one for editing
     POST  /api/admin/posts                 create
     PATCH /api/admin/posts/:id             update

   All of it sits behind requireAuth + requireAdmin via the /api/admin mount in
   server.js. Every rule that matters is enforced HERE, not in the browser: the
   publish checklist, the slug lock, the timezone conversion and the content
   sanitiser all run server-side, because a form can be bypassed and a REST
   call cannot be trusted.
   ────────────────────────────────────────────────────────────────────────── */

require('../../lib/env');
const { getSupabaseClient, withSupabaseRetry, formatFetchError } = require('../../lib/supabase-client');
const { slugify, getAllResources, getResourceBySlug } = require('../../lib/resources');
const { readingTimeMinutes, autoExcerpt, BASE_PATH } = require('../../lib/blog-post-mapper');

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const STATUSES = ['draft', 'scheduled', 'published', 'archived'];
const MAX_RELATED = 6;

// The fields that must be filled before an article may face the public. Kept
// as data so the editor's checklist and this gate cannot drift apart — the
// editor asks the server for nothing, it just mirrors the same list, and the
// server refuses regardless of what the browser believed.
const PUBLISH_REQUIRED = [
  ['title',            'Title'],
  ['slug',             'Slug'],
  ['featured_image',   'Featured Image'],
  ['image_alt',        'Featured Image ALT'],
  ['category',         'Category'],
  ['seo_title',        'SEO Title'],
  ['meta_description', 'Meta Description'],
];

const BASE_COLUMNS =
  'id, title, slug, excerpt, content_md, author, category, tags, read_time_minutes, ' +
  'featured_image, image_alt, seo_title, meta_description, faq, related_slugs, ' +
  'status, published_at, created_at, updated_at, created_by, updated_by';

// Added by migration 022. Probed once per process rather than assumed, so the
// editor keeps working on a database where 022 has not been applied yet — the
// same "harden the code against schema drift" approach migration 011 documents
// for the reports table. When the columns are missing the toggles simply
// default to on, which is the behaviour every article has today.
const SCHEMA_TOGGLE_COLUMNS = ['enable_article_schema', 'enable_faq_schema'];
let _togglesSupported = null;

async function togglesSupported(supabase) {
  if (_togglesSupported !== null) return _togglesSupported;
  const { error } = await supabase.from('blog_posts').select(SCHEMA_TOGGLE_COLUMNS[0]).limit(0);
  _togglesSupported = !error;
  if (!_togglesSupported) {
    console.warn('[admin/posts] migration 022 not applied — schema toggles disabled, both default to on');
  }
  return _togglesSupported;
}

async function selectColumns(supabase) {
  return (await togglesSupported(supabase))
    ? BASE_COLUMNS + ', ' + SCHEMA_TOGGLE_COLUMNS.join(', ')
    : BASE_COLUMNS;
}

/** Reads the toggles off a row, defaulting to on when the columns are absent. */
function readToggles(row) {
  return {
    enable_article_schema: row && row.enable_article_schema !== false,
    enable_faq_schema:     row && row.enable_faq_schema !== false,
  };
}

// ── timezone ────────────────────────────────────────────────────────────────

/** Offset of `timeZone` from UTC, in ms, at the instant `utcMs`. */
function tzOffsetMs(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
  return asUtc - utcMs;
}

/**
 * "2026-08-10" + "09:30" in Asia/Kolkata → the correct UTC instant.
 *
 * Done on the server, not in the browser: published_at is what decides when an
 * article becomes public, so it must not depend on the machine that submitted
 * the form. Two passes settle zones whose offset changes across the boundary
 * being converted (Asia/Kolkata has no DST, so one pass would do — the second
 * is for the other zones the picker offers).
 */
function zonedWallClockToUtc(dateStr, timeStr, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return null;
  const time = /^\d{2}:\d{2}$/.test(String(timeStr || '')) ? timeStr : '09:00';

  const naiveUtc = Date.parse(`${dateStr}T${time}:00Z`);
  if (!Number.isFinite(naiveUtc)) return null;

  let guess = naiveUtc;
  try {
    for (let i = 0; i < 2; i++) guess = naiveUtc - tzOffsetMs(guess, timeZone);
  } catch (_) {
    return null;                       // unknown IANA zone
  }
  const d = new Date(guess);
  return isNaN(d.getTime()) ? null : d;
}

// ── content safety ──────────────────────────────────────────────────────────

// Markdown is rendered with raw HTML passthrough, so the stored body is the
// only place to stop dangerous markup. The editor already emits nothing but
// Markdown plus <u>, but a hand-crafted PATCH could carry anything, so the
// same allowlist is applied here as well.
const ALLOWED_INLINE_HTML = /^<\/?(u|br|sub|sup)\s*\/?>$/i;

function sanitiseMarkdown(md) {
  let out = String(md || '');

  // Whole dangerous elements, content included.
  out = out.replace(/<(script|style|iframe|object|embed|form|svg|math)\b[\s\S]*?<\/\1\s*>/gi, '');
  out = out.replace(/<(script|style|iframe|object|embed|form|svg|math)\b[^>]*>/gi, '');

  // Any other raw tag that is not on the inline allowlist is dropped; its text
  // survives because only the tag itself is removed.
  out = out.replace(/<\/?[a-zA-Z][^>]*>/g, (tag) => (ALLOWED_INLINE_HTML.test(tag) ? tag : ''));

  // Markdown links/images pointing at an executable scheme.
  out = out.replace(/\]\(\s*(javascript|vbscript|data)\s*:[^)]*\)/gi, '](#)');

  return out;
}

/** Only http(s), mailto and site-relative destinations survive. */
function safeUrl(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^(javascript|vbscript|data|file):/i.test(v)) return '';
  if (/^https?:\/\//i.test(v) || /^mailto:/i.test(v) || v.startsWith('/')) return v;
  return '';
}

// ── payload normalisation ───────────────────────────────────────────────────

function cleanStringArray(value, { max = 50, asSlug = false } = {}) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(',');
  const out = [];
  for (let item of raw) {
    item = String(item == null ? '' : item).trim();
    if (asSlug) item = slugify(item);
    if (!item) continue;
    if (asSlug && !SLUG_RE.test(item)) continue;
    if (!out.includes(item)) out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

function cleanFaq(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((f) => ({
      question: String((f && f.question) || '').trim(),
      answer:   String((f && f.answer) || '').trim(),
    }))
    .filter((f) => f.question && f.answer)
    .slice(0, 50);
}

/**
 * Builds the column values from a request body. Returns { fields, errors }.
 * `existing` is the current row on update, so unchanged rules (slug lock)
 * can be applied against what is actually stored.
 */
function buildFields(body, { existing = null } = {}) {
  const errors = [];
  const f = {};

  f.title = String(body.title || '').trim();
  // Enforced by the blog_posts CHECK too — surfaced here so the admin gets a
  // sentence instead of a Postgres constraint error.
  if (!f.title) errors.push('A title is required to save, even as a draft.');

  // An empty slug auto-fills from the title, so a draft never blocks on it.
  let slug = slugify(String(body.slug || '').trim() || f.title);
  if (!slug || !SLUG_RE.test(slug)) {
    errors.push('Could not build a valid URL slug — use letters, numbers and hyphens.');
  }
  f.slug = slug;

  f.excerpt          = String(body.excerpt || '').trim();
  f.content_md       = sanitiseMarkdown(body.content_md);
  f.author           = String(body.author || '').trim() || 'The Doc Mirror';
  f.category         = String(body.category || '').trim() || 'Guide';
  f.tags             = cleanStringArray(body.tags, { max: 30 });
  f.featured_image   = safeUrl(body.featured_image);
  f.image_alt        = String(body.image_alt || '').trim();
  f.seo_title        = String(body.seo_title || '').trim() || null;
  f.meta_description = String(body.meta_description || '').trim() || null;
  f.faq              = cleanFaq(body.faq);

  f.related_slugs = cleanStringArray(body.related_slugs, { max: MAX_RELATED, asSlug: true })
    .filter((s) => s !== f.slug);              // an article is not related to itself

  // Structured-data switches (migration 022). Absent means on, so a payload
  // from an older client cannot silently strip an article's schema.
  f.enable_article_schema = body.enable_article_schema !== false;
  f.enable_faq_schema     = body.enable_faq_schema !== false;

  const rt = parseInt(body.read_time_minutes, 10);
  f.read_time_minutes = Number.isFinite(rt) && rt > 0
    ? rt
    : (readingTimeMinutes(f.content_md) || null);

  // Excerpt drives the listing card and the meta description fallback; deriving
  // it matches what the Markdown layer does for a post with no `description`.
  if (!f.excerpt) f.excerpt = autoExcerpt(f.content_md);

  // ── slug lock ───────────────────────────────────────────────────────────
  // Once a URL has been live it is indexed and linked. Changing it silently
  // 404s the old address, so it is frozen from the moment the article first
  // goes public. A draft or a still-pending scheduled post is free to change.
  if (existing) {
    const wasLive = existing.published_at && Date.parse(existing.published_at) <= Date.now();
    if (wasLive && f.slug !== existing.slug) {
      errors.push(
        `The URL is locked because this article has been published. ` +
        `It stays /resources/${existing.slug}.`
      );
      f.slug = existing.slug;
    }
  }

  return { fields: f, errors };
}

/** Which publish-required fields are still empty. */
function missingForPublish(fields) {
  return PUBLISH_REQUIRED.filter(([key]) => {
    const v = fields[key];
    return v === null || v === undefined || String(v).trim() === '';
  }).map(([, label]) => label);
}

/**
 * Resolves status + published_at from the requested action.
 * Never mutates anything; returns { status, published_at, errors }.
 */
function resolveStatus(action, body, fields, existing) {
  const errors = [];
  const prevPublishedAt = existing ? existing.published_at : null;

  switch (action) {
    case 'publish': {
      const missing = missingForPublish(fields);
      if (missing.length) {
        errors.push('Complete these before publishing: ' + missing.join(', '));
        break;
      }
      // Keep the original publish instant when re-publishing something that was
      // already live, so its date and sitemap entry do not jump forward.
      const wasLive = prevPublishedAt && Date.parse(prevPublishedAt) <= Date.now();
      return {
        status: 'published',
        published_at: wasLive ? prevPublishedAt : new Date().toISOString(),
        errors,
      };
    }

    case 'schedule': {
      const missing = missingForPublish(fields);
      if (missing.length) {
        errors.push('Complete these before scheduling: ' + missing.join(', '));
        break;
      }
      const when = zonedWallClockToUtc(body.publish_date, body.publish_time, body.timezone || 'Asia/Kolkata');
      if (!when) { errors.push('Pick a valid publish date and time to schedule.'); break; }
      if (when.getTime() <= Date.now()) {
        errors.push('The scheduled time is in the past. Pick a future time, or use Publish Now.');
        break;
      }
      return { status: 'scheduled', published_at: when.toISOString(), errors };
    }

    case 'archive':
      // published_at is kept: it records when the article WAS live, and the
      // status alone is what removes it from the public site.
      return { status: 'archived', published_at: prevPublishedAt, errors };

    case 'save_draft':
    default: {
      // A draft may carry an intended date without being scheduled yet, so the
      // editor does not lose what the admin typed.
      let intended = prevPublishedAt;
      if (body.publish_date) {
        const when = zonedWallClockToUtc(body.publish_date, body.publish_time, body.timezone || 'Asia/Kolkata');
        if (when) intended = when.toISOString();
      }
      return { status: 'draft', published_at: intended, errors };
    }
  }

  return { status: null, published_at: null, errors };
}

// ── shared helpers ──────────────────────────────────────────────────────────

function db(res) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    res.status(500).json({ error: 'Database is not configured' });
    return null;
  }
  return supabase;
}

function fail(res, label, error) {
  console.error(`[admin/posts] ${label} FAILED: ${formatFetchError(error)}`);
  return res.status(503).json({
    error: 'The database could not complete that right now — please try again.',
    detail: error && error.message ? error.message : undefined,
    retryable: true,
  });
}

/** Is this slug already taken by a CMS row, or by a Markdown article? */
async function slugConflict(supabase, slug, ignoreId) {
  const markdownHit = getResourceBySlug(slug);
  if (markdownHit) {
    return { taken: true, source: 'markdown', title: markdownHit.title };
  }
  let q = supabase.from('blog_posts').select('id, title').eq('slug', slug).limit(1);
  if (ignoreId) q = q.neq('id', ignoreId);
  const { data, error } = await withSupabaseRetry(() => q, { label: 'admin-posts-slug', attempts: 2 });
  if (error) throw error;
  if (data && data.length) return { taken: true, source: 'cms', title: data[0].title };
  return { taken: false };
}

// ── handlers ────────────────────────────────────────────────────────────────

async function list(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const limit  = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const status = String(req.query.status || '').trim();
  const q      = String(req.query.q || '').trim();

  const cols = await selectColumns(supabase);
  let query = supabase.from('blog_posts').select(cols)
    .order('updated_at', { ascending: false }).limit(limit);

  if (STATUSES.includes(status)) query = query.eq('status', status);
  if (q) {
    const safe = q.replace(/[%,()]/g, ' ');
    query = query.or(`title.ilike.%${safe}%,slug.ilike.%${safe}%,excerpt.ilike.%${safe}%`);
  }

  const { data, error } = await withSupabaseRetry(() => query, { label: 'admin-posts-list', attempts: 2 });
  if (error) return fail(res, 'list', error);

  return res.json({ posts: data || [] });
}

async function get(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const cols = await selectColumns(supabase);
  const { data, error } = await withSupabaseRetry(
    () => supabase.from('blog_posts').select(cols).eq('id', req.params.id).maybeSingle(),
    { label: 'admin-posts-get', attempts: 2 }
  );
  if (error) return fail(res, 'get', error);
  if (!data) return res.status(404).json({ error: 'Blog not found' });

  const wasLive = data.published_at && Date.parse(data.published_at) <= Date.now();

  return res.json({
    post: Object.assign({}, data, readToggles(data)),
    schema_toggles_supported: await togglesSupported(supabase),
    // Rendered here so the editor can load an existing body into the visual
    // editor without needing a Markdown parser in the browser.
    content_html: require('../../lib/blog-post-mapper').renderMarkdown(data.content_md || ''),
    slug_locked: !!wasLive,
    missing_for_publish: missingForPublish(data),
  });
}

async function slugCheck(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const slug = slugify(String(req.query.slug || '').trim());
  if (!slug || !SLUG_RE.test(slug)) {
    return res.json({ slug, valid: false, available: false, reason: 'Not a valid URL slug.' });
  }

  try {
    const c = await slugConflict(supabase, slug, req.query.id || null);
    return res.json({
      slug,
      valid: true,
      available: !c.taken,
      reason: c.taken
        ? (c.source === 'markdown'
            ? `Already used by an existing article ("${c.title}").`
            : `Already used by another CMS blog ("${c.title}").`)
        : null,
    });
  } catch (error) {
    return fail(res, 'slug-check', error);
  }
}

/**
 * Candidates for "Related in this series".
 *
 * Covers BOTH content sources so the admin never types a URL by hand:
 *   • every existing Markdown article under content/resources/
 *   • every CMS post that is public now or will be (published + scheduled)
 *
 * An empty query returns the whole catalogue rather than nothing, so the
 * picker doubles as a browsable list of everything on the site. New articles —
 * Markdown or CMS — appear here automatically the moment they exist; there is
 * no list to maintain.
 *
 * Scheduled posts are included and labelled: linking to something that goes
 * live next week is a normal editorial choice, and the label makes it a
 * deliberate one rather than an accidental dead link.
 */
async function relatedSearch(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const q = String(req.query.q || '').trim().toLowerCase();
  const exclude = String(req.query.exclude || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 300);

  const matches = (title, slug) =>
    !q || String(title || '').toLowerCase().includes(q) || String(slug || '').includes(q);

  const results = [];

  try {
    for (const p of getAllResources()) {
      if (p.slug === exclude) continue;
      if (!matches(p.title, p.slug)) continue;
      results.push({
        slug: p.slug, title: p.title, category: p.category,
        url: p.url, source: 'article', status: 'published',
        date: p.date ? p.date.iso : '',
      });
    }
  } catch (e) {
    console.warn('[admin/posts] markdown related search warn:', e.message);
  }

  const { data, error } = await withSupabaseRetry(
    () => supabase.from('blog_posts')
      .select('slug, title, category, status, published_at')
      .in('status', ['published', 'scheduled'])
      .order('published_at', { ascending: false })
      .limit(300),
    { label: 'admin-posts-related', attempts: 2 }
  );
  if (!error) {
    const now = Date.now();
    for (const r of (data || [])) {
      if (r.slug === exclude) continue;
      if (!matches(r.title, r.slug)) continue;
      const live = r.published_at && Date.parse(r.published_at) <= now;
      results.push({
        slug: r.slug, title: r.title, category: r.category,
        url: `${BASE_PATH}/${r.slug}`, source: 'cms',
        status: live ? 'published' : 'scheduled',
        date: r.published_at ? String(r.published_at).slice(0, 10) : '',
      });
    }
  }

  // A Markdown article and a CMS row can share a slug during migration; the
  // Markdown one is what the public serves today, so it wins.
  const seen = new Set();
  const deduped = results.filter((r) => (seen.has(r.slug) ? false : (seen.add(r.slug), true)));

  deduped.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return res.json({ results: deduped.slice(0, limit), total: deduped.length });
}

/**
 * Resolves what the admin pasted into "add by URL" — a full address, a site
 * path, or a bare slug — and confirms the target actually exists, so a related
 * link can never be a typo pointing at a 404.
 */
async function resolveRelated(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  let raw = String(req.query.value || '').trim();
  if (!raw) return res.status(400).json({ error: 'Paste a URL or a slug.' });

  // https://www.thedocmirror.com/resources/foo  ·  /resources/foo  ·  foo
  raw = raw.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const tail = raw.split('/').filter(Boolean).pop() || '';
  const slug = slugify(tail);

  if (!slug || !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'Could not read a slug from that. Paste the article URL or its slug.' });
  }

  const md = getResourceBySlug(slug);
  if (md) {
    return res.json({
      result: { slug, title: md.title, category: md.category, url: md.url, source: 'article', status: 'published' },
    });
  }

  const { data, error } = await withSupabaseRetry(
    () => supabase.from('blog_posts').select('slug, title, category, status, published_at').eq('slug', slug).maybeSingle(),
    { label: 'admin-posts-resolve', attempts: 2 }
  );
  if (error) return fail(res, 'resolve-related', error);

  if (!data) {
    return res.status(404).json({
      error: `No article found at /resources/${slug}. Check the URL — a related link must point at a real page.`,
    });
  }
  if (data.status === 'draft' || data.status === 'archived') {
    return res.status(409).json({
      error: `"${data.title}" is ${data.status} and has no public URL yet, so it cannot be linked as related.`,
    });
  }

  const live = data.published_at && Date.parse(data.published_at) <= Date.now();
  return res.json({
    result: {
      slug, title: data.title, category: data.category,
      url: `${BASE_PATH}/${slug}`, source: 'cms',
      status: live ? 'published' : 'scheduled',
    },
  });
}

async function create(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const action = String((req.body && req.body.action) || 'save_draft');
  const { fields, errors } = buildFields(req.body || {});
  const st = resolveStatus(action, req.body || {}, fields, null);
  const allErrors = errors.concat(st.errors);

  if (allErrors.length) return res.status(400).json({ error: allErrors[0], errors: allErrors });

  try {
    const c = await slugConflict(supabase, fields.slug, null);
    if (c.taken) {
      return res.status(409).json({
        error: c.source === 'markdown'
          ? `That URL is already used by an existing article ("${c.title}"). Choose a different slug.`
          : `That URL is already used by another CMS blog ("${c.title}"). Choose a different slug.`,
        field: 'slug',
      });
    }
  } catch (error) { return fail(res, 'create/slug', error); }

  const row = {
    ...fields,
    status: st.status,
    published_at: st.published_at,
    created_by: req.admin.id,
    updated_by: req.admin.id,
  };
  // Drop the toggle columns when migration 022 has not been applied, so a save
  // fails on nothing more than a column the database has not been told about.
  const cols = await selectColumns(supabase);
  if (!await togglesSupported(supabase)) {
    SCHEMA_TOGGLE_COLUMNS.forEach((c) => { delete row[c]; });
  }

  const { data, error } = await withSupabaseRetry(
    () => supabase.from('blog_posts').insert(row).select(cols).single(),
    { label: 'admin-posts-create', attempts: 2 }
  );
  if (error) return fail(res, 'create', error);

  console.log(`[admin/posts] CREATED id=${data.id} slug=${data.slug} status=${data.status} by=${req.admin.email}`);
  return res.status(201).json({ post: Object.assign({}, data, readToggles(data)) });
}

async function update(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const cols = await selectColumns(supabase);
  const existingRes = await withSupabaseRetry(
    () => supabase.from('blog_posts').select(cols).eq('id', req.params.id).maybeSingle(),
    { label: 'admin-posts-load', attempts: 2 }
  );
  if (existingRes.error) return fail(res, 'update/load', existingRes.error);
  if (!existingRes.data) return res.status(404).json({ error: 'Blog not found' });

  const existing = existingRes.data;
  const action = String((req.body && req.body.action) || 'save_draft');
  const { fields, errors } = buildFields(req.body || {}, { existing });
  const st = resolveStatus(action, req.body || {}, fields, existing);
  const allErrors = errors.concat(st.errors);

  if (allErrors.length) return res.status(400).json({ error: allErrors[0], errors: allErrors });

  if (fields.slug !== existing.slug) {
    try {
      const c = await slugConflict(supabase, fields.slug, existing.id);
      if (c.taken) {
        return res.status(409).json({ error: `That URL is already taken ("${c.title}").`, field: 'slug' });
      }
    } catch (error) { return fail(res, 'update/slug', error); }
  }

  const row = {
    ...fields,
    status: st.status,
    published_at: st.published_at,
    updated_by: req.admin.id,
  };
  if (!await togglesSupported(supabase)) {
    SCHEMA_TOGGLE_COLUMNS.forEach((c) => { delete row[c]; });
  }

  const { data, error } = await withSupabaseRetry(
    () => supabase.from('blog_posts').update(row).eq('id', existing.id).select(cols).single(),
    { label: 'admin-posts-update', attempts: 2 }
  );
  if (error) return fail(res, 'update', error);

  console.log(`[admin/posts] UPDATED id=${data.id} slug=${data.slug} status=${data.status} by=${req.admin.email}`);
  return res.json({ post: Object.assign({}, data, readToggles(data)) });
}

module.exports = {
  list, get, create, update, slugCheck, relatedSearch, resolveRelated,
  // exported for tests and for the editor's mirrored checklist
  buildFields, resolveStatus, missingForPublish, sanitiseMarkdown,
  zonedWallClockToUtc, PUBLISH_REQUIRED, SLUG_RE,
};
