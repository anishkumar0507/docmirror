-- Migration 009: Fix unique constraints for proper upsert support
--
-- Problem: reports.audit_id had a partial unique index (WHERE audit_id IS NOT NULL)
-- from migration 008, but PostgREST requires a full unique CONSTRAINT (not just an
-- index) for ON CONFLICT upserts to work.
-- Error seen: "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- Solution: Drop the partial unique index, add a proper unique constraint.
-- Run this in Supabase SQL Editor.

-- 1. Drop the partial unique index from migration 008 (it's the wrong type for upsert)
DROP INDEX IF EXISTS reports_audit_id_unique;

-- 2. Add a full unique CONSTRAINT on reports.audit_id
--    (PostgREST can use this with onConflict: 'audit_id')
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reports_audit_id_key'
      AND conrelid = 'public'::regnamespace::oid || '.reports'::text
  ) THEN
    ALTER TABLE reports ADD CONSTRAINT reports_audit_id_key UNIQUE (audit_id);
  END IF;
EXCEPTION WHEN others THEN
  -- May already exist — ignore
  NULL;
END $$;

-- 3. Add a unique constraint on paid_reports.audit_id so we can upsert by audit_id
--    (currently only has UNIQUE on stripe_session_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'paid_reports_audit_id_key'
      AND conrelid = 'public'::regnamespace::oid || '.paid_reports'::text
  ) THEN
    ALTER TABLE paid_reports ADD CONSTRAINT paid_reports_audit_id_key UNIQUE (audit_id);
  END IF;
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- 4. Ensure subscriptions.razorpay_subscription_id has a unique constraint
--    (already defined in migration 006, but add safely here in case migration was skipped)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscriptions_razorpay_subscription_id_key'
      AND conrelid = 'public'::regnamespace::oid || '.subscriptions'::text
  ) THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_razorpay_subscription_id_key
      UNIQUE (razorpay_subscription_id);
  END IF;
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- 5. Add competitors column to reports if migration 008 was not run
ALTER TABLE reports ADD COLUMN IF NOT EXISTS review_count   INTEGER;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS rating         NUMERIC(3,1);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS photo_count    INTEGER;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS specialty      TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS city           TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS competitors    JSONB;

-- Verify
SELECT
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type
FROM information_schema.table_constraints tc
WHERE tc.table_name IN ('reports', 'paid_reports', 'subscriptions')
  AND tc.constraint_type = 'UNIQUE'
ORDER BY tc.table_name, tc.constraint_name;
