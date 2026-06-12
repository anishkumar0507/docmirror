-- Migration 008: Extend reports table with audit-derived fields

-- Unique index on audit_id so verify-payment.js upsert works correctly
CREATE UNIQUE INDEX IF NOT EXISTS reports_audit_id_unique ON reports(audit_id)
  WHERE audit_id IS NOT NULL;

-- Rich fields populated from Google Places audit data and computed score
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS review_count   INTEGER,
  ADD COLUMN IF NOT EXISTS rating         NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS photo_count    INTEGER,
  ADD COLUMN IF NOT EXISTS specialty      TEXT,
  ADD COLUMN IF NOT EXISTS city           TEXT,
  ADD COLUMN IF NOT EXISTS competitors    JSONB;

COMMENT ON COLUMN reports.competitors IS
  'JSON array of top competitor objects: [{name,rating,reviewCount,googleScore,placeId}]';
