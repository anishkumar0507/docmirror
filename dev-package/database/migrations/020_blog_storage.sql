-- ─────────────────────────────────────────────────────────────────────────
-- Migration 020: Supabase Storage bucket "blog-media" + policies
--
-- Run this in: Supabase dashboard → SQL Editor
-- Run order:   017 → 018 → 019 → 020 → 021
--
-- Follows the pattern established by migration 003 (the "reports" bucket):
-- create the bucket, give service_role write access, give the public read
-- access where the URL genuinely has to be fetchable by anyone.
--
-- Why public read is correct here (and not merely convenient):
--   A blog hero image is fetched by every visitor's browser, by Googlebot when
--   it renders the page, and by Facebook, LinkedIn, X and Slack when they
--   expand the og:image. A signed URL expires, so it would break social
--   previews and cached search results. The same reasoning already applies to
--   the "reports" bucket's public policy.
--
-- Why writes are service-role only:
--   Uploads go through the admin API, which runs server-side with the service
--   key. No anonymous or logged-in browser client is ever granted INSERT,
--   UPDATE or DELETE on this bucket.
--
-- Additive only. Touches nothing belonging to the "reports" bucket — every
-- policy below is scoped to bucket_id = 'blog-media'.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Create the bucket.
--    public = true          → GET needs no signed token (see reasoning above)
--    file_size_limit        → 5 MB, matching OG_MAX_BYTES in publish-resource.js
--    allowed_mime_types     → raster images only; SVG is excluded on purpose
--                             (social platforms will not render it, and it can
--                             carry script when served from a public bucket)
--
--    ON CONFLICT DO UPDATE, not DO NOTHING, so re-running this migration
--    corrects a bucket that was hand-created in the dashboard with the wrong
--    limits. It only ever touches the row whose id is 'blog-media'.
INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
  )
VALUES (
    'blog-media',
    'blog-media',
    true,
    5242880,
    ARRAY ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  )
ON CONFLICT (id) DO UPDATE
  SET public             = true,
      file_size_limit    = 5242880,
      allowed_mime_types = ARRAY ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

-- 2. Ensure RLS is on for storage.objects. Supabase enables it by default;
--    this is the same safety net migration 003 uses. Wrapped so that a project
--    where the SQL role does not own storage.objects gets a notice instead of
--    a failed migration.
DO $$ BEGIN
  EXECUTE 'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'could not ALTER storage.objects (not owner) — Supabase enables RLS on it by default';
END $$;

-- 3. service_role: full control, scoped to this bucket only.
--    Covers upload (INSERT), replace (UPDATE), delete (DELETE) and read-back
--    for getPublicUrl (SELECT).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'service_role_all_blog_media'
  ) THEN
    CREATE POLICY "service_role_all_blog_media" ON storage.objects
      FOR ALL TO service_role
      USING (bucket_id = 'blog-media')
      WITH CHECK (bucket_id = 'blog-media');
  END IF;
END $$;

-- 4. Public read, so <img src> and og:image work for visitors and crawlers.
--    SELECT only — there is deliberately no anon/authenticated INSERT, UPDATE
--    or DELETE policy anywhere in this file, so nobody can write to the bucket
--    without the service key.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'public_read_blog_media'
  ) THEN
    CREATE POLICY "public_read_blog_media" ON storage.objects
      FOR SELECT TO anon, authenticated
      USING (bucket_id = 'blog-media');
  END IF;
END $$;

-- 5. Verify — should return one row: blog-media, public = true, 5242880.
SELECT id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
FROM storage.buckets
WHERE id = 'blog-media';
