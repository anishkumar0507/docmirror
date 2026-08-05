-- ─────────────────────────────────────────────────────────────────────────
-- Migration 019: blog_media — metadata for uploaded blog images
--
-- Run this in: Supabase dashboard → SQL Editor
-- Run order:   017 → 018 → 019 → 020 → 021
--
-- The bytes live in Supabase Storage (bucket "blog-media", created by
-- migration 020). This table holds only the metadata the media library needs
-- to list, search and reuse an image without downloading it — and to enforce
-- the same social-image policy scripts/publish-resource.js already applies to
-- Markdown hero images.
--
-- Vercel's filesystem is read-only at runtime, so public/images/resources/ can
-- never receive an upload. Storage is the only writable target.
--
-- No binary data is stored in Postgres. Additive only.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS blog_media (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Recorded rather than assumed, so a future second bucket does not require
  -- a migration to tell rows apart.
  bucket       TEXT        NOT NULL DEFAULT 'blog-media' CHECK (btrim(bucket) <> ''),
  -- Object key within the bucket, e.g. '2026/08/medical-schema-markup.jpeg'.
  storage_path TEXT        NOT NULL CHECK (btrim(storage_path) <> ''),
  -- Resolved public URL, cached so the media library and the renderer do not
  -- have to rebuild it. Nullable: the row is written before the URL is known
  -- if the upload is ever made private.
  public_url   TEXT,
  -- The name the author uploaded, kept for search. NOT the storage key.
  filename     TEXT        NOT NULL CHECK (btrim(filename) <> ''),

  -- Mirrors scripts/publish-resource.js: png/jpg/webp/gif are accepted and SVG
  -- is not. Two reasons, both already established by that script's checks —
  -- LinkedIn and Facebook will not render an SVG social image, and an SVG
  -- served from a public bucket is a script-execution vector.
  mime_type    TEXT        NOT NULL
                           CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  -- 5 MB, the same ceiling as OG_MAX_BYTES in publish-resource.js.
  size_bytes   BIGINT      NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),

  -- Pixel dimensions, so the media library can warn before an image is chosen
  -- as a featured image rather than after it is live. The existing policy is
  -- >= 1200x630; it is enforced in the API rather than as a CHECK so a small
  -- inline body image is still storable.
  width        INTEGER     CHECK (width  IS NULL OR width  > 0),
  height       INTEGER     CHECK (height IS NULL OR height > 0),

  alt_text     TEXT,
  uploaded_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One row per stored object: re-uploading the same key updates the row
  -- instead of orphaning the old one.
  CONSTRAINT blog_media_bucket_path_key UNIQUE (bucket, storage_path)
);

-- Media library lists newest first.
CREATE INDEX IF NOT EXISTS idx_blog_media_created_at
  ON blog_media (created_at DESC);

-- ── Security ──────────────────────────────────────────────────────────────
-- Metadata only, but it maps storage keys to uploaders, so it follows the same
-- two-lock pattern as the other CMS tables. Note this governs the metadata
-- ROW; readability of the image itself is decided by the bucket policy in 020.
ALTER TABLE blog_media ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'blog_media' AND policyname = 'service_role_blog_media'
  ) THEN
    CREATE POLICY "service_role_blog_media" ON blog_media
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE blog_media FROM anon, authenticated;

-- Explicit, for the reason given in 017.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE blog_media TO service_role;

NOTIFY pgrst, 'reload schema';
