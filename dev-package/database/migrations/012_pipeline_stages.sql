-- Migration 012: Staged report pipeline support (run once in Supabase SQL editor)
--
-- The report pipeline is now three chained serverless stages
--   insights → pdf → email
-- with /api/reconcile re-driving any stage that gets dropped. The code works
-- WITHOUT this migration (status is a free-text column and reconcile keys off
-- created_at + artifacts), but these columns make reconciliation cheaper and the
-- order lifecycle observable.

-- 0. (OPTIONAL) Widen the status CHECK constraint. The CODE does NOT require this
--    — the pipeline deliberately stays within the original allowed statuses
--    ('pending','generating','generated','delivered','failed') and keys progress off
--    produced artifacts (insights/PDF). Apply this only if you want granular statuses.
-- ALTER TABLE paid_reports DROP CONSTRAINT IF EXISTS paid_reports_status_check;
-- ALTER TABLE paid_reports ADD CONSTRAINT paid_reports_status_check
--   CHECK (status IN ('pending','paid','generating','insights_ready','insights_failed',
--                     'pdf_ready','pdf_failed','generated','delivered','failed'));

-- 1. Track when an order last advanced + how many reconcile attempts it has had.
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS attempts   INTEGER     DEFAULT 0;

-- 2. Keep updated_at fresh on every status change.
CREATE OR REPLACE FUNCTION set_paid_reports_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_paid_reports_updated_at ON paid_reports;
CREATE TRIGGER trg_paid_reports_updated_at
  BEFORE UPDATE ON paid_reports
  FOR EACH ROW EXECUTE FUNCTION set_paid_reports_updated_at();

-- 3. Index the reconcile scan (recent, non-terminal orders).
CREATE INDEX IF NOT EXISTS paid_reports_status_created_idx
  ON paid_reports (status, created_at DESC);

-- 4. Confirm reports.insights (added by 010/011) exists and is indexed.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS insights JSONB;
CREATE INDEX IF NOT EXISTS reports_insights_gin ON reports USING GIN (insights);

-- 5. Reload PostgREST so the API sees the new columns immediately.
NOTIFY pgrst, 'reload schema';

-- Status lifecycle ACTUALLY USED BY THE CODE (within the original constraint):
--   pending     order row created at checkout, not yet verified
--   generating  payment verified — pipeline running (insights + pdf stages).
--               Stays 'generating' across both; reconcile keys off artifacts
--               (audit_cache.insights present? reports/<id>.pdf in storage?).
--   delivered   Stage 3 done — emailed  (terminal)
--   generated   PDF produced but email send failed — downloadable  (terminal)
--   failed      terminal failure
-- The reports row (insights, pdf_url) and the storage object are the real
-- progress signals; paid_reports.status is a coarse summary.

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'paid_reports'
ORDER BY ordinal_position;
