'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   GET /api/admin/stats

   Everything the admin dashboard shows: the five summary counts and the most
   recently touched posts.

   Mounted behind app.use('/api/admin', requireAuth, requireAdmin) in server.js,
   so by the time this runs the caller is a confirmed admin. The browser never
   queries blog_posts itself — it cannot, because that table is service_role
   only (RLS on, anon/authenticated revoked by migration 018).

   ── Effective status ──────────────────────────────────────────────────────
   The public site decides visibility at READ TIME and never mutates a row:

       (status = 'published' OR status = 'scheduled') AND published_at <= now()

   So a scheduled post whose time has passed is already public even though its
   row still says 'scheduled'. Counting the raw `status` column would tell the
   operator a post is "Scheduled" while patients are reading it.

   This file therefore derives an effective status, which is what the dashboard
   displays and counts. NOTHING IS WRITTEN — no row is flipped for display.

       archived                                    → archived
       draft                                       → draft
       published | scheduled, published_at <= now  → published   (public now)
       published | scheduled, published_at >  now  → scheduled   (pending)

   The last line also covers the case of a row marked 'published' with a future
   date: it is not public yet, so calling it "published" would be wrong.

   These four buckets partition every row, so they must sum to the total. The
   total is queried independently rather than derived, so a mismatch surfaces
   instead of hiding.
   ────────────────────────────────────────────────────────────────────────── */

require('../../lib/env');
const { getSupabaseClient, withSupabaseRetry, formatFetchError } = require('../../lib/supabase-client');

const RECENT_LIMIT_DEFAULT = 8;
const RECENT_LIMIT_MAX     = 20;

// Statuses that can ever be public. Kept as one constant so the dashboard and
// the future public read path cannot drift apart on what "publishable" means.
const PUBLISHABLE = ['published', 'scheduled'];

/** The effective status of one row at instant `nowMs`. Pure — no I/O, no writes. */
function effectiveStatus(row, nowMs) {
  if (row.status === 'archived') return 'archived';
  if (row.status === 'draft')    return 'draft';

  // A published/scheduled row always carries published_at (enforced by the
  // blog_posts_published_at_required CHECK), but never trust that blindly:
  // a null here means "no publish instant", which is not public.
  const at = row.published_at ? Date.parse(row.published_at) : NaN;
  if (!Number.isFinite(at)) return 'draft';

  return at <= nowMs ? 'published' : 'scheduled';
}

/** count(*) with filters applied, using head:true so no rows travel. */
function countWhere(supabase, apply, label) {
  return withSupabaseRetry(
    () => apply(supabase.from('blog_posts').select('*', { count: 'exact', head: true })),
    { label: `admin-stats-${label}`, attempts: 2 }
  );
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabaseClient();
  if (!supabase) {
    console.error('[admin/stats] Supabase not configured');
    return res.status(500).json({ error: 'Database is not configured' });
  }

  const limit = Math.min(
    Math.max(parseInt(req.query.limit, 10) || RECENT_LIMIT_DEFAULT, 1),
    RECENT_LIMIT_MAX
  );

  const now    = new Date();
  const nowIso = now.toISOString();
  const nowMs  = now.getTime();
  const t0     = Date.now();

  // Counted in the database rather than by fetching rows and counting in Node:
  // exact at any table size, and immune to PostgREST's default row cap. All six
  // queries are independent, so they run concurrently.
  const [total, drafts, archived, published, scheduled, recent] = await Promise.all([
    countWhere(supabase, (q) => q,                                                              'total'),
    countWhere(supabase, (q) => q.eq('status', 'draft'),                                        'drafts'),
    countWhere(supabase, (q) => q.eq('status', 'archived'),                                     'archived'),
    countWhere(supabase, (q) => q.in('status', PUBLISHABLE).lte('published_at', nowIso),        'published'),
    countWhere(supabase, (q) => q.in('status', PUBLISHABLE).gt('published_at', nowIso),         'scheduled'),
    withSupabaseRetry(
      () => supabase
        .from('blog_posts')
        .select('id, title, slug, status, category, published_at, updated_at, created_at')
        .order('updated_at', { ascending: false })
        .limit(limit),
      { label: 'admin-stats-recent', attempts: 2 }
    ),
  ]);

  const failed = [
    ['total', total], ['drafts', drafts], ['archived', archived],
    ['published', published], ['scheduled', scheduled], ['recent', recent],
  ].filter(([, r]) => r && r.error);

  if (failed.length) {
    const detail = failed.map(([name, r]) => `${name}: ${formatFetchError(r.error)}`).join(' | ');
    console.error(`[admin/stats] query FAILED (${Date.now() - t0}ms) ${detail}`);
    return res.status(503).json({
      error: 'Could not load dashboard data right now — please try again.',
      detail: failed.map(([name, r]) => `${name}: ${r.error.message || 'unknown'}`).join('; '),
      retryable: true,
    });
  }

  const counts = {
    total:     total.count     || 0,
    published: published.count || 0,   // public right now
    scheduled: scheduled.count || 0,   // due later
    drafts:    drafts.count    || 0,
    archived:  archived.count  || 0,
  };

  // The four buckets partition the table, so this can only trip if a row is in
  // a state the schema should have prevented. Log it rather than paper over it.
  const sum = counts.published + counts.scheduled + counts.drafts + counts.archived;
  if (sum !== counts.total) {
    console.warn(`[admin/stats] count mismatch: buckets=${sum} total=${counts.total} — a row is in an unexpected state`);
  }

  const rows = (recent.data || []).map((row) => {
    const eff = effectiveStatus(row, nowMs);
    return {
      id:               row.id,
      title:            row.title,
      slug:             row.slug,
      status:           row.status,          // what the row literally says
      effective_status: eff,                 // what the public actually sees
      is_public:        eff === 'published',
      category:         row.category,
      published_at:     row.published_at,
      updated_at:       row.updated_at,
      created_at:       row.created_at,
      url:              `/resources/${row.slug}`,
    };
  });

  console.log(
    `[admin/stats] ok (${Date.now() - t0}ms) adminId=${req.admin.id} ` +
    `total=${counts.total} published=${counts.published} scheduled=${counts.scheduled} ` +
    `drafts=${counts.drafts} archived=${counts.archived} recent=${rows.length}`
  );

  return res.json({ counts, recent: rows, generated_at: nowIso });
}

module.exports = handler;
module.exports.effectiveStatus = effectiveStatus;
module.exports.PUBLISHABLE = PUBLISHABLE;
