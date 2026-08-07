-- ─────────────────────────────────────────────────────────────────────────
-- Migration 023: align blog_posts_public with what the site actually serves
--
-- Run this in: Supabase dashboard → SQL Editor
-- Run after:   017 → 018 → 019 → 020 → 021 → 022
--
-- The view created in 018 covers published posts only:
--
--     status = 'published' AND published_at <= NOW()
--
-- The application's rule is wider, because a scheduled post whose time has
-- passed is public without anything mutating the row — that is what removes the
-- need for a cron job:
--
--     status IN ('published', 'scheduled') AND published_at <= NOW()
--
-- So the two disagree. Today that is harmless: lib/resources-db.js queries the
-- table directly and never reads this view. But a view named "public" that does
-- not list everything public is a trap for whoever reads it next — an analytics
-- query, a report, or a future feature would quietly miss due scheduled posts.
--
-- This migration makes the view say what the site does. It changes no row, no
-- policy and no grant, and the application's behaviour is unaffected either
-- way, because nothing reads the view.
--
-- Safe to run at any time. Safe to skip — the site does not depend on it.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW blog_posts_public AS
  SELECT *
    FROM blog_posts
   WHERE status IN ('published', 'scheduled')
     AND published_at IS NOT NULL
     AND published_at <= NOW();

COMMENT ON VIEW blog_posts_public IS
  'Posts the public site serves right now. Includes scheduled posts whose '
  'published_at has passed — visibility is decided at read time, so no job '
  'flips scheduled to published. Mirrors isPublic() in lib/blog-post-mapper.js.';

-- security_invoker makes the view respect the caller's RLS rather than the
-- owner's. Postgres 15+; on an older version the REVOKE below is what keeps it
-- private, so a failure here is a notice, not an error.
DO $$ BEGIN
  EXECUTE 'ALTER VIEW blog_posts_public SET (security_invoker = true)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'security_invoker not supported on this Postgres version — view is protected by REVOKE only';
END $$;

-- Unchanged from 018/022: the view is for the server, never for the browser.
REVOKE ALL ON TABLE blog_posts_public FROM anon, authenticated;
GRANT SELECT ON TABLE blog_posts_public TO service_role;

NOTIFY pgrst, 'reload schema';

-- Verify — this count should now match what /resources shows.
SELECT status, count(*) AS posts
  FROM blog_posts_public
 GROUP BY status
 ORDER BY status;
