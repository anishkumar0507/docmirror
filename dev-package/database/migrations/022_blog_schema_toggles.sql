-- ─────────────────────────────────────────────────────────────────────────
-- Migration 022: per-article structured-data toggles
--
-- Run this in: Supabase dashboard → SQL Editor
-- Run after:   017 → 018 → 019 → 020 → 021
--
-- Adds two switches to the editor's SEO panel:
--
--   enable_article_schema   emit the BlogPosting JSON-LD block
--   enable_faq_schema       emit the FAQPage JSON-LD block
--
-- Both default to TRUE, which is exactly what every article does today, so
-- applying this changes nothing about any existing or future page until an
-- author deliberately turns a switch off.
--
-- Why they are useful:
--   • FAQPage — Google restricted rich FAQ results to authoritative health and
--     government sites. Keeping the markup is usually still right, but an
--     author sometimes wants the questions VISIBLE on the page without
--     claiming FAQ structured data. Emptying the FAQ list would remove both;
--     this separates the two.
--   • BlogPosting — for a page that is really a landing page or a hub rather
--     than an article, declaring it as a BlogPosting misdescribes it.
--
-- Note this controls only the JSON-LD. The visible FAQ accordion still follows
-- whether the article has questions, and the <title>, meta description,
-- canonical, Open Graph and Twitter tags are never affected.
--
-- Additive only: two nullable-free boolean columns with defaults. Postgres 11+
-- fills a NOT NULL DEFAULT without rewriting the table.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS enable_article_schema BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS enable_faq_schema BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN blog_posts.enable_article_schema IS
  'Emit the BlogPosting JSON-LD block on the public article page.';
COMMENT ON COLUMN blog_posts.enable_faq_schema IS
  'Emit the FAQPage JSON-LD block. Independent of whether the FAQ section is shown.';

-- The view is defined as SELECT *, so it has to be re-created to pick up the
-- two new columns. CREATE OR REPLACE keeps the same object, grants included.
CREATE OR REPLACE VIEW blog_posts_public AS
  SELECT *
    FROM blog_posts
   WHERE status = 'published'
     AND published_at IS NOT NULL
     AND published_at <= NOW();

DO $$ BEGIN
  EXECUTE 'ALTER VIEW blog_posts_public SET (security_invoker = true)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'security_invoker not supported on this Postgres version — view is protected by REVOKE only';
END $$;

REVOKE ALL ON TABLE blog_posts_public FROM anon, authenticated;
GRANT SELECT ON TABLE blog_posts_public TO service_role;

-- Reload the PostgREST schema cache so the new columns are visible immediately.
NOTIFY pgrst, 'reload schema';

-- Verify — both columns should be listed as boolean, NOT NULL, default true.
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'blog_posts'
   AND column_name IN ('enable_article_schema', 'enable_faq_schema');
