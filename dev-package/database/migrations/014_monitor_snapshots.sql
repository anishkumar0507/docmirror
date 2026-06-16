-- Migration 014: monitor_snapshots — canonical weekly historical snapshot ($49 plan)
-- One row per Monitor user per weekly run. Captures the full state of the
-- dashboard at that moment so week-over-week change and trend graphs can be
-- rebuilt from a single table. Written by routes/weekly-check.js every Monday.
--
-- Append-only history (keyed by created_at). A `week` column is included for
-- idempotency so re-running the cron in the same ISO week updates rather than
-- duplicates the row.

CREATE TABLE IF NOT EXISTS monitor_snapshots (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  doctor_name       TEXT,
  review_count      INTEGER,
  rating            NUMERIC(2,1),
  visibility_score  INTEGER,
  competitor_data   JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- [{name, rating, reviewCount, googleScore, ...}]
  sentiment_data    JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- {score, label, positive[], negative[], reviewThemes[], summary}
  alerts            JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- [{type, severity, title, message}]
  week              DATE        NOT NULL DEFAULT CURRENT_DATE,  -- snapshot week (for idempotent upsert)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, week)
);

CREATE INDEX IF NOT EXISTS idx_monitor_snapshots_user_created
  ON monitor_snapshots(user_id, created_at DESC);

ALTER TABLE monitor_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'monitor_snapshots' AND policyname = 'service_role_monitor_snapshots'
  ) THEN
    CREATE POLICY "service_role_monitor_snapshots" ON monitor_snapshots
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Users may read their own snapshots (dashboard reads go through the service
-- role today, but this keeps direct client reads safe if ever used).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'monitor_snapshots' AND policyname = 'users_own_monitor_snapshots'
  ) THEN
    CREATE POLICY "users_own_monitor_snapshots" ON monitor_snapshots
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;
