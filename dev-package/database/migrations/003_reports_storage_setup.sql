-- ─────────────────────────────────────────────────────────────────────────
-- Migration 003: Supabase Storage bucket "reports" + RLS policy
--
-- Run this in: Supabase dashboard → SQL Editor
--
-- What it does:
--   1. Creates the "reports" storage bucket (public read, no size limit)
--   2. Grants the service_role INSERT + SELECT so the API can upload PDFs
--   3. Allows public GET so pdfUrl links work in emails
--
-- Why it exists:
--   The app uploads PDF reports to storage.objects (bucket = "reports").
--   If the bucket is missing, uploads silently fail and pdfUrl is always null.
--   Customers still receive the email (PDF is attached directly), but the
--   Download PDF button on the post-payment page will not work.
-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create the bucket if it does not already exist.
--    "public" = true means the GetObject URL requires no signed token.
INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
  )
VALUES (
    'reports',
    'reports',
    true,
    52428800,
    -- 50 MB per file
    ARRAY ['application/pdf']
  ) ON CONFLICT (id) DO
UPDATE
SET public = true,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY ['application/pdf'];
-- 2. Enable RLS on storage.objects (Supabase enables it by default; this is a safety net).
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
-- 3. Service role can upload (INSERT) and overwrite (UPDATE) PDF reports.
DROP POLICY IF EXISTS "service_role_upload_reports" ON storage.objects;
CREATE POLICY "service_role_upload_reports" ON storage.objects FOR
INSERT TO service_role WITH CHECK (bucket_id = 'reports');
DROP POLICY IF EXISTS "service_role_update_reports" ON storage.objects;
CREATE POLICY "service_role_update_reports" ON storage.objects FOR
UPDATE TO service_role USING (bucket_id = 'reports');
-- 4. Service role can read back its own uploads (needed for getPublicUrl + re-send).
DROP POLICY IF EXISTS "service_role_select_reports" ON storage.objects;
CREATE POLICY "service_role_select_reports" ON storage.objects FOR
SELECT TO service_role USING (bucket_id = 'reports');
-- 5. Public (anonymous) can download PDFs via the public URL that is emailed to customers.
--    Remove this policy if you want reports to be private (requires signed URLs instead).
DROP POLICY IF EXISTS "public_read_reports" ON storage.objects;
CREATE POLICY "public_read_reports" ON storage.objects FOR
SELECT TO anon USING (bucket_id = 'reports');
-- 6. Verify
SELECT id,
  name,
  public,
  file_size_limit
FROM storage.buckets
WHERE id = 'reports';