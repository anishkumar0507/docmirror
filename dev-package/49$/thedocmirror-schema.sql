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

-- ── 5. SUBSCRIBERS (Monitor + Done For You) ───────────────────────────────
CREATE TABLE IF NOT EXISTS subscribers (
  id                     UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  email                  TEXT        NOT NULL,
  stripe_customer_id     TEXT        UNIQUE,
  stripe_subscription_id TEXT,
  plan                   TEXT        NOT NULL
                         CHECK (plan IN ('monitor', 'dfy')),
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

-- ═══════════════════════════════════════════════════════════════════════════
-- v6 MONITOR ADDITIONS (6 new tables for $49 tier)
-- Run after v4-v5 migrations.
-- ═══════════════════════════════════════════════════════════════════════════

-- Monitor subscriber table (extends users with monitor-specific config)
CREATE TABLE IF NOT EXISTS monitor_subscribers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email              TEXT NOT NULL,
  practice_name      TEXT,
  doctor_name_clean  TEXT NOT NULL,
  specialty          TEXT NOT NULL,
  city               TEXT NOT NULL,
  state              TEXT,
  region             TEXT CHECK (region IN ('US','IN','OTHER')),
  subscribed_at      TIMESTAMPTZ DEFAULT NOW(),
  weekly_cron_day    INT DEFAULT 1 CHECK (weekly_cron_day BETWEEN 0 AND 6),
  weekly_cron_hour   INT DEFAULT 9 CHECK (weekly_cron_hour BETWEEN 0 AND 23),
  active             BOOLEAN DEFAULT TRUE,
  stripe_subscription_id TEXT UNIQUE,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ms_user ON monitor_subscribers(user_id);
CREATE INDEX IF NOT EXISTS idx_ms_active ON monitor_subscribers(active) WHERE active = TRUE;

-- Weekly score snapshots (Feature 1, 9, 17)
CREATE TABLE IF NOT EXISTS weekly_score_snapshots (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id      UUID NOT NULL REFERENCES monitor_subscribers(id) ON DELETE CASCADE,
  week_of            DATE NOT NULL,
  overall_score      INT NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  google_score       INT NOT NULL,
  ai_score           INT NOT NULL,
  chatgpt_score      INT,
  gemini_score       INT,
  claude_score       INT,
  perplexity_score   INT,
  pillars            JSONB NOT NULL,
  ai_ranks           JSONB NOT NULL,
  queries_run        JSONB,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(subscriber_id, week_of)
);
CREATE INDEX IF NOT EXISTS idx_wss_subscriber_week ON weekly_score_snapshots(subscriber_id, week_of DESC);

-- Competitor snapshots (Feature 2, 4, 14, 18)
CREATE TABLE IF NOT EXISTS competitor_snapshots (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id        UUID NOT NULL REFERENCES monitor_subscribers(id) ON DELETE CASCADE,
  week_of              DATE NOT NULL,
  competitor_name      TEXT NOT NULL,
  competitor_place_id  TEXT NOT NULL,
  score                INT NOT NULL,
  rating               NUMERIC(2,1),
  review_count         INT,
  photo_count          INT,
  local_rank           INT,
  ai_mentions_count    INT,
  new_posts_this_week  INT,
  recent_changes       JSONB,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(subscriber_id, week_of, competitor_place_id)
);
CREATE INDEX IF NOT EXISTS idx_cs_subscriber_week ON competitor_snapshots(subscriber_id, week_of DESC);

-- Weekly tasks (Feature 5)
CREATE TABLE IF NOT EXISTS weekly_tasks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id         UUID NOT NULL REFERENCES monitor_subscribers(id) ON DELETE CASCADE,
  week_of               DATE NOT NULL,
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL,
  estimated_minutes     INT,
  location              TEXT,
  pillar                TEXT,
  estimated_score_gain  INT,
  copy_paste_content    TEXT,
  completed             BOOLEAN DEFAULT FALSE,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wt_subscriber_week ON weekly_tasks(subscriber_id, week_of DESC);

-- Content packs (Feature 6, 16)
CREATE TABLE IF NOT EXISTS content_packs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id   UUID NOT NULL REFERENCES monitor_subscribers(id) ON DELETE CASCADE,
  week_of         DATE NOT NULL,
  campaign_theme  TEXT,
  platform        TEXT NOT NULL CHECK (platform IN ('instagram_reel','instagram_carousel','instagram_post','gbp_post','facebook_post','whatsapp_status','blog')),
  headline        TEXT NOT NULL,
  body            TEXT NOT NULL,
  hashtags        TEXT[],
  image_prompt    TEXT,
  script_seconds  INT,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cp_subscriber_week ON content_packs(subscriber_id, week_of DESC);

-- Awareness calendar (Feature 13) — seeded from awareness-calendar.json
CREATE TABLE IF NOT EXISTS awareness_calendar (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observance_name TEXT NOT NULL,
  month           INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  day             INT CHECK (day BETWEEN 1 AND 31),
  specialty_tags  TEXT[] NOT NULL,
  region_tags     TEXT[] NOT NULL,
  campaign_theme  TEXT NOT NULL,
  description     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ac_month ON awareness_calendar(month);
CREATE INDEX IF NOT EXISTS idx_ac_specialty_tags ON awareness_calendar USING GIN(specialty_tags);
CREATE INDEX IF NOT EXISTS idx_ac_region_tags ON awareness_calendar USING GIN(region_tags);

-- Reputation alerts (Feature 8)
CREATE TABLE IF NOT EXISTS reputation_alerts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id        UUID NOT NULL REFERENCES monitor_subscribers(id) ON DELETE CASCADE,
  detected_at          TIMESTAMPTZ DEFAULT NOW(),
  source               TEXT NOT NULL CHECK (source IN ('google','practo','healthgrades','facebook')),
  review_rating        INT NOT NULL CHECK (review_rating BETWEEN 1 AND 5),
  review_snippet       TEXT NOT NULL,
  reviewer_name        TEXT,
  topics               TEXT[],
  severity             TEXT CHECK (severity IN ('critical','concerning','moderate')),
  suggested_response   TEXT,
  responded            BOOLEAN DEFAULT FALSE,
  responded_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ra_subscriber ON reputation_alerts(subscriber_id, detected_at DESC) WHERE responded = FALSE;

-- Seed script for awareness_calendar — run once during initial deployment.
-- Reads /database/awareness-calendar.json and inserts each observance.
-- Use Supabase SQL editor or a one-off migration script.
