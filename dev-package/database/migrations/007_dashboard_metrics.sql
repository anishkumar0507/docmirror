-- Migration 007: Dashboard metrics, weekly tasks, competitor alerts

CREATE TABLE IF NOT EXISTS dashboard_metrics (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week                 DATE        NOT NULL,
  visibility_score     INTEGER,
  ai_rank              INTEGER,
  review_count         INTEGER,
  competitor_position  INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, week)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_metrics_user_week ON dashboard_metrics(user_id, week DESC);

ALTER TABLE dashboard_metrics ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'dashboard_metrics' AND policyname = 'service_role_dashboard_metrics'
  ) THEN
    CREATE POLICY "service_role_dashboard_metrics" ON dashboard_metrics
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;


CREATE TABLE IF NOT EXISTS weekly_tasks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL,
  description  TEXT,
  completed    BOOLEAN     NOT NULL DEFAULT FALSE,
  week         DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weekly_tasks_user_week ON weekly_tasks(user_id, week DESC);

ALTER TABLE weekly_tasks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'weekly_tasks' AND policyname = 'service_role_weekly_tasks'
  ) THEN
    CREATE POLICY "service_role_weekly_tasks" ON weekly_tasks
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;


CREATE TABLE IF NOT EXISTS competitor_alerts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  alert_type  TEXT,
  message     TEXT,
  read        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_competitor_alerts_user ON competitor_alerts(user_id, created_at DESC);

ALTER TABLE competitor_alerts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'competitor_alerts' AND policyname = 'service_role_competitor_alerts'
  ) THEN
    CREATE POLICY "service_role_competitor_alerts" ON competitor_alerts
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
