-- ─────────────────────────────────────────────────────────────────────────
-- Migration 018: blog_posts — the CMS content table
--
-- Run this in: Supabase dashboard → SQL Editor
-- Run order:   017 → 018 → 019 → 020 → 021
--
-- The public site still renders from content/resources/*.md. This table is
-- created empty and read by nothing until Phase 3 wires it in. Additive only.
--
-- ── Field semantics ───────────────────────────────────────────────────────
-- Every column exists to reproduce one key of the 17-key object that
-- lib/resources-markdown.js already returns and routes/resources.js already
-- renders. Phase 3 maps a row to that object with no join and no guesswork:
--
--   public key        source
--   ────────────────  ───────────────────────────────────────────────────────
--   slug              slug
--   url               derived: '/resources/' || slug
--   canonical         derived: SITE || url
--   title             title
--   seoTitle          seo_title, falling back to title
--   metaDescription   meta_description, falling back to excerpt
--   description       excerpt          ← see note below
--   excerpt           excerpt          ← see note below
--   date              derived from published_at ({iso, display, sortKey})
--   author            author
--   category          category
--   tags              tags
--   image             featured_image
--   imageAlt          image_alt, falling back to title
--   readingTime       read_time_minutes, else computed from content_md
--   faq               faq
--   html              rendered from content_md by the same marked config
--
-- Note on description/excerpt: these are two keys but one value. In the
-- Markdown layer, `description` resolves to `data.description || data.excerpt
-- || <generated snippet>` and `excerpt` resolves to `data.description ||
-- data.excerpt || <the same generated snippet>` — they are always equal. One
-- column reproduces both, and storing them separately would invent a
-- distinction the renderer does not have.
--
-- content_md, not content_html: the body is stored as Markdown and rendered at
-- request time through the SAME marked configuration the .md files go through.
-- That shared code path is what guarantees a CMS post and a Markdown post
-- produce identical typography, spacing and markup. A cached HTML column was
-- considered and rejected — it can silently drift from the renderer.
-- ─────────────────────────────────────────────────────────────────────────

-- FAQ shape guard. The faq array drives the FAQPage JSON-LD on the article
-- page, and Google rejects a Question with an empty name or answer — so an
-- entry missing either field must never reach the renderer. The Markdown layer
-- filters those out at parse time; this enforces the same rule at write time.
-- IMMUTABLE + LANGUAGE sql so it is usable inside a CHECK constraint.
CREATE OR REPLACE FUNCTION blog_faq_is_valid(v JSONB)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_typeof(v) = 'array'
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_array_elements(v) AS e
        WHERE jsonb_typeof(e) <> 'object'
           OR btrim(COALESCE(e ->> 'question', '')) = ''
           OR btrim(COALESCE(e ->> 'answer',   '')) = ''
     );
$$;

-- Array hygiene for tags and related_slugs: no NULL elements, no blank strings.
-- A blank tag renders as an empty chip; a blank related slug resolves to
-- '/resources/', the same broken-link failure the slug regex prevents.
-- Declared IMMUTABLE so it is legal inside a CHECK constraint.
CREATE OR REPLACE FUNCTION blog_text_array_is_clean(v TEXT[])
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
  SELECT v IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM unnest(v) AS e WHERE e IS NULL OR btrim(e) = ''
     );
$$;

CREATE TABLE IF NOT EXISTS blog_posts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── identity ──────────────────────────────────────────────────────────
  title             TEXT        NOT NULL CHECK (btrim(title) <> ''),
  -- UNIQUE because the slug IS the URL. The regex is the same grammar
  -- slugify() emits, and it is what stops the failure the CMS branch hit in
  -- review: an empty slug produced '/resources/', a card on the listing page
  -- linking back to the listing page plus a sitemap entry duplicating the index.
  slug              TEXT        NOT NULL UNIQUE
                                CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  -- ── content ───────────────────────────────────────────────────────────
  excerpt           TEXT        NOT NULL DEFAULT '',
  content_md        TEXT        NOT NULL DEFAULT '',
  author            TEXT        NOT NULL DEFAULT 'The Doc Mirror',
  category          TEXT        NOT NULL DEFAULT 'Guide',
  tags              TEXT[]      NOT NULL DEFAULT '{}'::text[]
                                CHECK (blog_text_array_is_clean(tags)),
  read_time_minutes INTEGER     CHECK (read_time_minutes IS NULL OR read_time_minutes > 0),

  -- ── media ─────────────────────────────────────────────────────────────
  -- featured_image holds whatever the renderer should put in src=. Today the
  -- Markdown files use site-relative paths ('/images/resources/x.jpeg');
  -- CMS uploads will use absolute Supabase Storage URLs. Both already work:
  -- absUrl() in routes/resources.js passes an absolute URL through untouched
  -- and prefixes a relative one, so no renderer change is needed.
  featured_image    TEXT,
  image_alt         TEXT,

  -- ── SEO ───────────────────────────────────────────────────────────────
  -- Both nullable: the Markdown layer falls back to title/excerpt when the
  -- frontmatter omits them, and Phase 3 applies the identical fallback.
  seo_title         TEXT,
  meta_description  TEXT,

  -- ── structured blocks ─────────────────────────────────────────────────
  faq               JSONB       NOT NULL DEFAULT '[]'::jsonb
                                CHECK (blog_faq_is_valid(faq)),
  -- Manual "Related in this series" override. Empty array = keep today's
  -- automatic behaviour (same category, then shared tags, then recency).
  -- Slugs rather than ids so a related post can point at a Markdown article
  -- that has no database row, which is the state throughout merge mode.
  related_slugs     TEXT[]      NOT NULL DEFAULT '{}'::text[]
                                CHECK (blog_text_array_is_clean(related_slugs)),

  -- ── publishing ────────────────────────────────────────────────────────
  status            TEXT        NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
  -- timestamptz, so a publish time means the same instant regardless of the
  -- admin's timezone. The editor collects date + time + timezone and converts
  -- to UTC on save.
  published_at      TIMESTAMPTZ,

  -- ── audit ─────────────────────────────────────────────────────────────
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  updated_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL,

  -- A post that is published or scheduled without a publish instant is
  -- undefined: the public query orders and gates on published_at, so a NULL
  -- would make the row either invisible forever or sort unpredictably.
  -- Drafts and archived posts may keep a NULL (never published) or an old
  -- value (unpublished after the fact) — both are meaningful.
  CONSTRAINT blog_posts_published_at_required
    CHECK (status NOT IN ('published', 'scheduled') OR published_at IS NOT NULL)
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'blog_posts_updated_at'
  ) THEN
    CREATE TRIGGER blog_posts_updated_at
      BEFORE UPDATE ON blog_posts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ── Indexes ───────────────────────────────────────────────────────────────
-- Public listing, newest first. Partial on status so the index holds only rows
-- that can ever be public. The '<= now()' half of the visibility rule cannot
-- live in the predicate (now() is not IMMUTABLE), so it stays in the query and
-- is served by this index's ordering.
CREATE INDEX IF NOT EXISTS idx_blog_posts_published
  ON blog_posts (published_at DESC)
  WHERE status = 'published';

-- Category filtering, also newest first.
CREATE INDEX IF NOT EXISTS idx_blog_posts_published_category
  ON blog_posts (category, published_at DESC)
  WHERE status = 'published';

-- Admin dashboard counts, status filters, and the scheduled queue
-- ("what publishes next"), which reads status='scheduled' ordered by time.
CREATE INDEX IF NOT EXISTS idx_blog_posts_status_published_at
  ON blog_posts (status, published_at DESC);

-- Admin post list, which defaults to most-recently-edited.
CREATE INDEX IF NOT EXISTS idx_blog_posts_updated_at
  ON blog_posts (updated_at DESC);

-- Tag filtering and the shared-tag half of related-post scoring.
CREATE INDEX IF NOT EXISTS idx_blog_posts_tags
  ON blog_posts USING GIN (tags);

-- Slug lookup (/resources/:slug) is served by the UNIQUE constraint's index.
-- Admin free-text search over title/excerpt is deliberately unindexed: at this
-- article count a sequential scan is faster than maintaining a pg_trgm index,
-- and adding the extension is not justified yet.

-- ── Visibility rule, defined once ─────────────────────────────────────────
-- A post is public only when it is explicitly published AND its publish
-- instant has passed. Drafts, scheduled-for-later and archived posts are all
-- excluded by the same predicate — so a draft cannot leak because someone
-- forgot a WHERE clause in one query.
--
-- The view is REVOKEd from anon and authenticated: it is a convenience and a
-- statement of intent for the server (service_role), never a public endpoint.
CREATE OR REPLACE VIEW blog_posts_public AS
  SELECT *
    FROM blog_posts
   WHERE status = 'published'
     AND published_at IS NOT NULL
     AND published_at <= NOW();

-- security_invoker makes the view respect the caller's RLS instead of the
-- view owner's. Postgres 15+; if the project is older the REVOKE below is what
-- keeps the view private, so a failure here is a notice, not an error.
DO $$ BEGIN
  EXECUTE 'ALTER VIEW blog_posts_public SET (security_invoker = true)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'security_invoker not supported on this Postgres version — view is protected by REVOKE only';
END $$;

REVOKE ALL ON TABLE blog_posts_public FROM anon, authenticated;
GRANT SELECT ON TABLE blog_posts_public TO service_role;

-- ── Security ──────────────────────────────────────────────────────────────
-- Same two independent locks as blog_categories. Nothing but the server's
-- service-role client can read or write this table, which is what keeps
-- drafts and scheduled posts invisible even to a logged-in user holding the
-- public anon key.
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'blog_posts' AND policyname = 'service_role_blog_posts'
  ) THEN
    CREATE POLICY "service_role_blog_posts" ON blog_posts
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE blog_posts FROM anon, authenticated;

-- Explicit, for the reason given in 017: privileges and RLS are independent,
-- so a correct policy plus a missing grant still yields "permission denied".
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE blog_posts TO service_role;

NOTIFY pgrst, 'reload schema';
