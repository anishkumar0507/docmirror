-- ─────────────────────────────────────────────────────────────────────────
-- Migration 001: paid_reports
-- Run in Supabase SQL Editor (production is missing this table).
-- Required for: checkout order rows, verify/report status updates, dashboard login.
-- NOT used for audit payload — that lives in audit_cache.audit_data.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS paid_reports (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_id          TEXT        NOT NULL,
  email             TEXT        NOT NULL,
  stripe_session_id TEXT        UNIQUE,
  pdf_url           TEXT,
  status            TEXT        DEFAULT 'pending'
                    CHECK (status IN ('pending', 'generating', 'generated', 'delivered', 'failed')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  delivered_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_paid_reports_audit_id ON paid_reports(audit_id);
CREATE INDEX IF NOT EXISTS idx_paid_reports_email    ON paid_reports(email);
CREATE INDEX IF NOT EXISTS idx_paid_reports_status   ON paid_reports(status);

ALTER TABLE paid_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_all_paid_reports" ON paid_reports;
CREATE POLICY "service_all_paid_reports"
  ON paid_reports FOR ALL TO service_role
  USING (true);
