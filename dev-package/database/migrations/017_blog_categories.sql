-- ─────────────────────────────────────────────────────────────────────────
-- Migration 017: blog_categories — the CMS category list
--
-- Run this in: Supabase dashboard → SQL Editor
-- Run order:   017 → 018 → 019 → 020 → 021
--
-- What it does:
--   Creates the managed list of categories the admin editor offers in its
--   dropdown, so a non-technical author picks "AI Visibility" instead of
--   free-typing it and creating "Ai visibility" as a seventh category.
--
-- What it deliberately does NOT do:
--   It is NOT a foreign key for blog_posts.category. That column stays a
--   plain TEXT holding the rendered value, exactly as the Markdown
--   frontmatter does today, because:
--     1. Phase 3 maps a DB row to the public post object with a direct
--        column read and no join — the same value the Markdown layer
--        produces for the same field.
--     2. Deleting a category row can never orphan or break a published post.
--     3. Markdown posts and DB posts keep identical category semantics while
--        both sources are live during merge mode.
--   The category list is a UI convenience, not a referential constraint.
--
-- Additive only. Creates nothing that existing code reads or writes.
-- ─────────────────────────────────────────────────────────────────────────

-- Shared updated_at trigger function. Identical to the definition in
-- migration 004 — repeated here (CREATE OR REPLACE, so it is a no-op if 004
-- already ran) so this migration can be applied to a fresh project standalone.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS blog_categories (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL CHECK (btrim(name) <> ''),
  -- Same slug grammar the site's slugify() produces, so a category slug can
  -- safely become a URL segment later without a second normalisation step.
  slug        TEXT        NOT NULL UNIQUE
                          CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive uniqueness on the display name: "AI Visibility" and
-- "ai visibility" are the same category to a reader, so they must be the
-- same row. (slug already has its own UNIQUE constraint.)
CREATE UNIQUE INDEX IF NOT EXISTS blog_categories_name_lower_key
  ON blog_categories (lower(name));

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'blog_categories_updated_at'
  ) THEN
    CREATE TRIGGER blog_categories_updated_at
      BEFORE UPDATE ON blog_categories
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ── Security ──────────────────────────────────────────────────────────────
-- Two independent locks, so a mistake in either one is not enough to expose
-- the table:
--   1. RLS on with a service_role-only policy. No policy exists for anon or
--      authenticated, and RLS denies by default, so those roles match nothing.
--   2. The table-level grants Supabase hands anon/authenticated by default are
--      revoked outright, so the question never reaches RLS.
ALTER TABLE blog_categories ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'blog_categories' AND policyname = 'service_role_blog_categories'
  ) THEN
    CREATE POLICY "service_role_blog_categories" ON blog_categories
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE blog_categories FROM anon, authenticated;

-- Grant the server explicitly rather than relying on Supabase's default
-- privileges. A new table in `public` normally inherits
-- "GRANT ALL ON TABLES TO anon, authenticated, service_role" from
-- ALTER DEFAULT PRIVILEGES — but that is project configuration, not a
-- guarantee. If it is missing or scoped to a different creating role, the RLS
-- policy above would be correct and the server would still get
-- "permission denied for table blog_categories", because privileges and RLS
-- are independent systems. Stating the grant makes the server's access a
-- property of this migration instead of an assumption about the project.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE blog_categories TO service_role;

-- ── Optional seed ─────────────────────────────────────────────────────────
-- Left commented out on purpose: Phase 2 creates structure only and inserts no
-- data. These are the six categories the 24 live Markdown articles currently
-- use, ready to paste in when the admin editor needs its dropdown populated.
--
-- INSERT INTO blog_categories (name, slug) VALUES
--   ('AI Visibility',     'ai-visibility'),
--   ('Google Visibility', 'google-visibility'),
--   ('Practice Growth',   'practice-growth'),
--   ('Visibility Basics', 'visibility-basics'),
--   ('Product',           'product'),
--   ('ChatGPT Ranking',   'chatgpt-ranking')
-- ON CONFLICT (slug) DO NOTHING;

-- Reload the PostgREST schema cache so the new table is visible immediately.
NOTIFY pgrst, 'reload schema';
