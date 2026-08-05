'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — admin authorization

   The CMS tables (blog_posts, blog_categories, blog_media) are service_role
   only: RLS is on, and anon/authenticated hold no privileges at all. So the
   browser can never read or write them directly — every admin operation goes
   through a server route running under the service key, and this file is what
   decides whether that route may run.

   Two layers, in order:

     requireAuth   (lib/auth-middleware.js)  — is this a valid Supabase session?
     requireAdmin  (here)                    — is that user profiles.role='admin'?

   requireAdmin re-reads the role from the database on EVERY request. It is
   never taken from the JWT, a claim, a header or anything else the browser
   controls. A user cannot put themselves in that row either: migration 021
   revokes INSERT/UPDATE/DELETE on profiles from anon and authenticated, and
   the profiles_guard_role trigger rejects any role change that does not come
   from a trusted server role.

   Mounted once in server.js as `app.use('/api/admin', requireAuth, requireAdmin)`
   so every current and future /api/admin/* route is protected by construction —
   a new route cannot forget the guard.
   ────────────────────────────────────────────────────────────────────────── */

const { getSupabaseClient, withSupabaseRetry, formatFetchError } = require('./supabase-client');

/**
 * Requires req.user (set by requireAuth). Responds 403 for a valid session that
 * is not an admin, and 503 — never 403 — when the role simply could not be
 * read. Reporting a Supabase stall as "not an admin" would tell the operator
 * their access was revoked when the database was only briefly unreachable, the
 * same mistake routes/auth/login.js documents for credentials.
 */
async function requireAdmin(req, res, next) {
  if (!req.user || !req.user.id) {
    // Only reachable if this is mounted without requireAuth in front of it.
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    console.error('[admin-auth] Supabase not configured — cannot verify admin role');
    return res.status(500).json({ error: 'Admin access is not configured' });
  }

  const { data, error } = await withSupabaseRetry(
    () => supabase
      .from('profiles')
      .select('id, email, name, role')
      .eq('id', req.user.id)
      .maybeSingle(),          // no profile row → data null, not an error
    { label: 'admin-role-check', attempts: 2 }
  );

  if (error) {
    console.error(`[admin-auth] role lookup FAILED userId=${req.user.id}: ${formatFetchError(error)}`);
    return res.status(503).json({
      error: 'Could not verify admin access right now — please try again.',
      retryable: true,
    });
  }

  if (!data || data.role !== 'admin') {
    console.warn(
      `[admin-auth] DENIED userId=${req.user.id} email=${req.user.email || '(unknown)'} ` +
      `role=${data ? data.role : '(no profile row)'} path=${req.originalUrl}`
    );
    return res.status(403).json({ error: 'Forbidden — admin access required' });
  }

  req.admin = { id: data.id, email: data.email, name: data.name || '' };
  next();
}

module.exports = { requireAdmin };
