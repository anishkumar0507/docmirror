-- ─────────────────────────────────────────────────────────────────────────
-- Migration 027: allow 'agency' as a profiles.plan value
--
-- WHY
-- profiles.plan is the single source of truth every gate reads
-- (lib/entitlements.js). Migration 004 pinned it to ('free','audit','monitor'):
--
--   plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','audit','monitor'))
--
-- so writing plan='agency' after an agency subscription is paid would be
-- rejected by the DB and the buyer would be left paid-but-unprovisioned.
--
-- organizations.type already accepts 'agency' (migration 024); this is only the
-- profiles side.
--
-- SAFETY
-- Purely widening: every value that was legal before is still legal, so no
-- existing row can violate the new constraint and nothing is rewritten. The old
-- constraint is dropped and re-added under the SAME name, inside one transaction,
-- so there is never a window where profiles.plan is unconstrained.
--
-- Idempotent: re-running drops and recreates the same constraint.
-- Review only — DO NOT APPLY until approved.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_plan_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('free', 'audit', 'monitor', 'agency'));

COMMIT;

COMMENT ON COLUMN profiles.plan IS
  'Effective plan, read by lib/entitlements.js: free | audit (one-time report) | monitor (single-doctor subscription) | agency (multi-doctor org subscription). agency implies every monitor feature.';

-- Reload PostgREST schema cache (fixes PGRST204 after DDL)
NOTIFY pgrst, 'reload schema';
