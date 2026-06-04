-- ─────────────────────────────────────────────────────────────────────────
-- The Doc Mirror — Complete Supabase Schema
-- Run this ENTIRE file in Supabase SQL Editor before going live
-- Project: thedocmirror
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. EMAIL CAPTURES (free tool email submission) ────────────────────────
CREATE TABLE IF NOT EXISTS email_captures (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  email       TEXT        NOT NULL,
  doctor_name TEXT,
  specialty   TEXT,
  city        TEXT,
  state       TEXT,
  score       INTEGER,
  audit_id    TEXT,
  source      TEXT        DEFAULT 'free_check',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. WAITLIST ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS waitlist (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  email      TEXT        UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. AUDIT CACHE (24hr TTL — prevents duplicate API calls) ─────────────
CREATE TABLE IF NOT EXISTS audit_cache (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_key           TEXT        UNIQUE NOT NULL,
  doctor_name         TEXT,
  specialty           TEXT,
  city                TEXT,
  state               TEXT,
  score               INTEGER,
  audit_data          JSONB       NOT NULL,
  youtube_data        JSONB,
  brand_search_data   JSONB,
  social_data         JSONB,
  website_data        JSONB,
  patient_journey     JSONB,
  ninety_day_plan     JSONB,
  seo_keywords        JSONB,
  content_strategy    JSONB,
  competitor_narrative TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  expires_at          TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours'
);

-- ── 4. PAID REPORTS ($19 one-time) ────────────────────────────────────────
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

-- ── 5. SUBSCRIBERS (Monitor only — DFY removed in v4) ───────────────────────────────
CREATE TABLE IF NOT EXISTS subscribers (
  id                     UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  email                  TEXT        NOT NULL,
  stripe_customer_id     TEXT        UNIQUE,
  stripe_subscription_id TEXT,
  plan                   TEXT        NOT NULL
                         CHECK (plan IN ('monitor')),
  status                 TEXT        DEFAULT 'active'
                         CHECK (status IN ('active', 'cancelled', 'past_due', 'trialing')),
  doctor_name            TEXT,
  specialty              TEXT,
  city                   TEXT,
  state                  TEXT,
  last_audit_id          TEXT,
  last_score             INTEGER,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. WEEKLY REPORTS (Monitor cron output) ───────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_reports (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  subscriber_id   UUID        REFERENCES subscribers(id) ON DELETE CASCADE,
  week_of         DATE        NOT NULL,
  score           INTEGER,
  score_prev      INTEGER,
  score_change    INTEGER,
  local_rank      INTEGER,
  review_count    INTEGER,
  rating          DECIMAL(3,1),
  audit_data      JSONB,
  pdf_url         TEXT,
  alerts          JSONB,
  email_sent_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (subscriber_id, week_of)
);

-- ── INDEXES ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_audit_cache_key        ON audit_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_audit_cache_expires    ON audit_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_cache_spec_city  ON audit_cache(specialty, city);
CREATE INDEX IF NOT EXISTS idx_email_captures_email   ON email_captures(email);
CREATE INDEX IF NOT EXISTS idx_subscribers_email      ON subscribers(email);
CREATE INDEX IF NOT EXISTS idx_subscribers_status     ON subscribers(status);
CREATE INDEX IF NOT EXISTS idx_subscribers_stripe     ON subscribers(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_weekly_sub_week        ON weekly_reports(subscriber_id, week_of);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────────────────
ALTER TABLE email_captures  ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_cache     ENABLE ROW LEVEL SECURITY;
ALTER TABLE paid_reports    ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscribers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_reports  ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (used by API routes)
-- Anon role can only insert email_captures and waitlist (used by frontend)
CREATE POLICY "anon_insert_email_captures"
  ON email_captures FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "anon_insert_waitlist"
  ON waitlist FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "service_all_audit_cache"
  ON audit_cache FOR ALL TO service_role
  USING (true);

CREATE POLICY "service_all_paid_reports"
  ON paid_reports FOR ALL TO service_role
  USING (true);

CREATE POLICY "service_all_subscribers"
  ON subscribers FOR ALL TO service_role
  USING (true);

CREATE POLICY "service_all_weekly_reports"
  ON weekly_reports FOR ALL TO service_role
  USING (true);

-- ── STORAGE BUCKET (PDF reports) ─────────────────────────────────────────
-- Run this in Supabase Dashboard → Storage → New Bucket
-- Name: reports
-- Public: false (signed URLs only)
-- Max file size: 10MB
-- Allowed MIME types: application/pdf

-- ── AUTO-CLEANUP EXPIRED CACHE ────────────────────────────────────────────
-- Run this manually weekly, or set up pg_cron if available:
-- DELETE FROM audit_cache WHERE expires_at < NOW();


-- ═══════════════════════════════════════════════════════════════════════════
-- v4 ADDITIONS: Preview pages + new pillar columns + remove DFY
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS preview_pages (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  slug           TEXT        UNIQUE NOT NULL,
  audit_id       TEXT,
  doctor_name    TEXT        NOT NULL,
  specialty      TEXT,
  city           TEXT,
  state          TEXT,
  audit_data     JSONB       NOT NULL,
  is_public      BOOLEAN     DEFAULT FALSE,
  email          TEXT,
  view_count     INTEGER     DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  made_public_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_preview_slug   ON preview_pages(slug);
CREATE INDEX IF NOT EXISTS idx_preview_public ON preview_pages(is_public);

-- Public read of public preview pages, service role can do everything
ALTER TABLE preview_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_public_previews" ON preview_pages FOR SELECT TO anon USING (is_public = TRUE);
CREATE POLICY "service_all_previews"      ON preview_pages FOR ALL    TO service_role USING (true);

-- Add v4 audit_cache columns
ALTER TABLE audit_cache
  ADD COLUMN IF NOT EXISTS ai_visibility_data JSONB,
  ADD COLUMN IF NOT EXISTS directories_data   JSONB,
  ADD COLUMN IF NOT EXISTS patient_loss_data  JSONB,
  ADD COLUMN IF NOT EXISTS preview_slug       TEXT;

-- v4: Remove DFY plan from subscribers
ALTER TABLE subscribers DROP CONSTRAINT IF EXISTS subscribers_plan_check;
ALTER TABLE subscribers ADD CONSTRAINT subscribers_plan_check CHECK (plan IN ('monitor'));
