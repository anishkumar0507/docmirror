-- ─────────────────────────────────────────────────────────────────────────
-- Migration 002: standardize audit_cache payload column to audit_data
--
-- Root cause of PGRST204:
--   App upserts { cache_key, audit_data } but production had { cache_key, data }.
--
-- Canonical minimal schema (what the app reads/writes):
--   cache_key   TEXT PRIMARY KEY (or UNIQUE NOT NULL)
--   audit_data  JSONB NOT NULL
--   created_at  TIMESTAMPTZ DEFAULT NOW()
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Rename legacy "data" → "audit_data" when only "data" exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_cache' AND column_name = 'data'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_cache' AND column_name = 'audit_data'
  ) THEN
    ALTER TABLE public.audit_cache RENAME COLUMN data TO audit_data;
    RAISE NOTICE 'Renamed audit_cache.data → audit_data';
  END IF;
END $$;

-- 2. If both columns exist, merge into audit_data and drop data
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_cache' AND column_name = 'data'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_cache' AND column_name = 'audit_data'
  ) THEN
    UPDATE public.audit_cache
    SET audit_data = COALESCE(audit_data, data)
    WHERE data IS NOT NULL;
    ALTER TABLE public.audit_cache DROP COLUMN data;
    RAISE NOTICE 'Merged audit_cache.data into audit_data and dropped data';
  END IF;
END $$;

-- 3. Ensure audit_data exists on fresh/partial tables
ALTER TABLE public.audit_cache
  ADD COLUMN IF NOT EXISTS audit_data JSONB;

ALTER TABLE public.audit_cache
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- 4. Drop stray "data" if it somehow remains
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_cache' AND column_name = 'data'
  ) THEN
    ALTER TABLE public.audit_cache DROP COLUMN data;
    RAISE NOTICE 'Dropped legacy audit_cache.data';
  END IF;
END $$;

-- 5. RLS (service role used by API)
ALTER TABLE public.audit_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_audit_cache" ON public.audit_cache;
CREATE POLICY "service_all_audit_cache"
  ON public.audit_cache FOR ALL TO service_role
  USING (true);

-- 6. Verify columns (logged in Supabase SQL output)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'audit_cache'
ORDER BY ordinal_position;

-- 7. Reload PostgREST schema cache (fixes PGRST204 after DDL)
NOTIFY pgrst, 'reload schema';
