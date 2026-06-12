-- Migration 010: Add insights JSONB column to reports table
-- Stores AI-generated content (fixes, exec summary, SEO keywords, content strategy,
-- patient journey, 90-day plan, review templates, social calendar, competitor narrative)
-- so the dashboard can display rich data without re-running Claude prompts.

ALTER TABLE reports ADD COLUMN IF NOT EXISTS insights JSONB;

-- Index for fast lookup (optional — JSONB top-level key queries benefit from this)
CREATE INDEX IF NOT EXISTS reports_insights_gin ON reports USING GIN (insights);

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'reports' AND column_name = 'insights';
