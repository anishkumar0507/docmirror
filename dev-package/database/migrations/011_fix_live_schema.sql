-- Migration 011: Repair live schema drift (run once in Supabase SQL editor)
--
-- ROOT CAUSE of the empty production dashboard:
--   * migration 008's UNIQUE index on reports.audit_id was never applied, so every
--     `INSERT ... ON CONFLICT (audit_id)` upsert failed → the reports table stayed empty.
--   * migration 010's reports.insights column was never applied, so the dashboard read
--     query (which selected `insights`) errored out entirely.
--
-- The application code has been hardened to work WITHOUT these (manual upserts + insights
-- stored inside audit_cache.audit_data), but applying this migration restores the intended
-- schema, prevents duplicate report rows under concurrency, and is strongly recommended.

-- 1. Unique index so ON CONFLICT (audit_id) upserts work again
CREATE UNIQUE INDEX IF NOT EXISTS reports_audit_id_unique
  ON reports(audit_id)
  WHERE audit_id IS NOT NULL;

-- 2. Insights column (rich AI-generated content for the dashboard)
ALTER TABLE reports ADD COLUMN IF NOT EXISTS insights JSONB;
CREATE INDEX IF NOT EXISTS reports_insights_gin ON reports USING GIN (insights);

-- 3. Reload PostgREST schema cache so the API sees the new column immediately
NOTIFY pgrst, 'reload schema';

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'reports'
ORDER BY ordinal_position;
