-- Migration 005: Per-user report history + backcompat user_id on paid_reports

CREATE TABLE IF NOT EXISTS reports (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  audit_id     TEXT,
  doctor_name  TEXT,
  score        INTEGER,
  pdf_url      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_user_id   ON reports(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_audit_id  ON reports(audit_id);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'reports' AND policyname = 'users_own_reports'
  ) THEN
    CREATE POLICY "users_own_reports" ON reports
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'reports' AND policyname = 'service_role_reports'
  ) THEN
    CREATE POLICY "service_role_reports" ON reports
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Backward-compat: link existing paid_reports rows to user accounts
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_paid_reports_user_id ON paid_reports(user_id);
