-- ─────────────────────────────────────────────────────────────────────────
-- Migration 024: Multi-doctor identity model (Phase 1 — DATA MODEL ONLY)
--
-- Splits identity into 3 layers so one login can own many doctor profiles
-- (hospital / clinic / agency), without changing any current behaviour:
--   organizations   — the billing/ownership entity
--   org_members     — which auth users belong to an org, and their role
--   doctor_profiles — the individual doctors under an org
--
-- Existing per-audit tables (reports, paid_reports) get TWO nullable link
-- columns each (doctor_profile_id, org_id). Nothing is made NOT NULL here, no
-- existing column is dropped/renamed, and user_id stays exactly as-is. The
-- backfill (scripts/backfill-orgs.js, STEP 2) populates the new columns; until
-- then they are simply NULL and the app runs unchanged.
--
-- Idempotent: safe to run more than once (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- Review only — DO NOT APPLY until approved.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. organizations ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT,
  type           TEXT        CHECK (type IN ('solo','clinic','hospital','agency')),
  plan           TEXT        DEFAULT 'free',
  profile_limit  INT         DEFAULT 1,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. org_members (who belongs to which org) ─────────────────────────────
CREATE TABLE IF NOT EXISTS org_members (
  org_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id  UUID NOT NULL REFERENCES profiles(id)      ON DELETE CASCADE,
  role     TEXT CHECK (role IN ('owner','admin','viewer')),
  PRIMARY KEY (org_id, user_id)
);

-- ── 3. doctor_profiles (the individual doctors under an org) ──────────────
CREATE TABLE IF NOT EXISTS doctor_profiles (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT,
  website     TEXT,
  speciality  TEXT,
  city        TEXT,
  status      TEXT        DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. Link columns on existing per-audit tables (nullable, additive) ─────
--     FK ON DELETE SET NULL: deleting an org/profile must NOT delete audit
--     history. user_id is left untouched.
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS doctor_profile_id UUID REFERENCES doctor_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS org_id            UUID REFERENCES organizations(id)   ON DELETE SET NULL;

ALTER TABLE paid_reports
  ADD COLUMN IF NOT EXISTS doctor_profile_id UUID REFERENCES doctor_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS org_id            UUID REFERENCES organizations(id)   ON DELETE SET NULL;

-- ── 5. Indexes ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_doctor_profiles_org       ON doctor_profiles(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user          ON org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_org               ON reports(org_id);
CREATE INDEX IF NOT EXISTS idx_reports_doctor_profile    ON reports(doctor_profile_id);
CREATE INDEX IF NOT EXISTS idx_paid_reports_org          ON paid_reports(org_id);
CREATE INDEX IF NOT EXISTS idx_paid_reports_doctor_profile ON paid_reports(doctor_profile_id);

-- ── 6. Membership helper (SECURITY DEFINER) ───────────────────────────────
--     Reads org_members as the table owner (which bypasses RLS since we do NOT
--     FORCE row-level security), so policies below can reference membership
--     WITHOUT the infinite recursion an org_members-on-org_members policy causes.
CREATE OR REPLACE FUNCTION public.is_org_member(p_org UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = p_org AND user_id = auth.uid()
  );
$$;

-- ── 7. RLS — new tables only ──────────────────────────────────────────────
--     A user may READ only the orgs they are a member of. Service role (used by
--     every API route) is fully exempt. RLS stays ENABLED — never disabled.
ALTER TABLE organizations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_profiles ENABLE ROW LEVEL SECURITY;

-- organizations
DROP POLICY IF EXISTS "service_role_organizations" ON organizations;
CREATE POLICY "service_role_organizations"
  ON organizations FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "members_read_organizations" ON organizations;
CREATE POLICY "members_read_organizations"
  ON organizations FOR SELECT USING (public.is_org_member(id));

-- org_members
DROP POLICY IF EXISTS "service_role_org_members" ON org_members;
CREATE POLICY "service_role_org_members"
  ON org_members FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "members_read_org_members" ON org_members;
CREATE POLICY "members_read_org_members"
  ON org_members FOR SELECT USING (public.is_org_member(org_id));

-- doctor_profiles
DROP POLICY IF EXISTS "service_role_doctor_profiles" ON doctor_profiles;
CREATE POLICY "service_role_doctor_profiles"
  ON doctor_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "members_read_doctor_profiles" ON doctor_profiles;
CREATE POLICY "members_read_doctor_profiles"
  ON doctor_profiles FOR SELECT USING (public.is_org_member(org_id));

-- NOTE: reports / paid_reports RLS is intentionally UNCHANGED in Phase 1.

-- ── 8. Reload PostgREST schema cache (fixes PGRST204 after DDL) ────────────
NOTIFY pgrst, 'reload schema';
