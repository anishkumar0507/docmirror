-- ─────────────────────────────────────────────────────────────────────────
-- Migration 026: pin a doctor_profile to its exact Google listing
--
-- WHY
-- Today a profile stores only name/speciality/city, so every audit re-runs the
-- Places TEXT SEARCH and re-guesses which listing is this doctor. When more than
-- one listing matches the name+city, /api/audit returns needsSelection and the
-- dashboard has nowhere to put the answer — the run just fails with
-- "Several Google listings match …".
--
-- /api/audit already ACCEPTS placeId in its request body (routes/audit.js) and
-- skips the text search entirely when one is given — the trusted path. Storing
-- the Place ID the scan resolved therefore makes every future audit for this
-- profile run against that exact listing: no re-search, no ambiguity.
--
-- COLUMNS
--   place_id          Google Place ID (e.g. "ChIJ…") for this doctor's listing.
--   google_maps_url   Canonical maps link for that listing (audit returns it).
--   parent_speciality Broad specialty group (`spp`) the scan form resolved.
--                     /api/audit uses it for competitor discovery; without it
--                     competitor search falls back to the narrow specialty.
--
-- ALL NULLABLE — the 5 existing profiles keep place_id NULL and their audits
-- keep running by name exactly as they do today. Nothing is backfilled here.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). Review only — DO NOT APPLY until approved.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE doctor_profiles
  ADD COLUMN IF NOT EXISTS place_id          TEXT,
  ADD COLUMN IF NOT EXISTS google_maps_url   TEXT,
  ADD COLUMN IF NOT EXISTS parent_speciality TEXT;

-- Partial index: only rows that actually have a listing pinned. Supports
-- "is this listing already claimed in my org?" lookups without indexing the
-- NULLs of every name-only profile.
CREATE INDEX IF NOT EXISTS idx_doctor_profiles_place_id
  ON doctor_profiles(place_id)
  WHERE place_id IS NOT NULL;

COMMENT ON COLUMN doctor_profiles.place_id IS
  'Google Place ID of this doctor''s listing, captured by the Add-doctor scan. NULL = no public Google listing found (organic / GMB-missing); audits for that profile fall back to name search.';
COMMENT ON COLUMN doctor_profiles.google_maps_url IS
  'Canonical Google Maps URL for place_id, as returned by /api/audit.';
COMMENT ON COLUMN doctor_profiles.parent_speciality IS
  'Broad specialty group (the scan form''s spp) — used by /api/audit for competitor discovery.';

-- Reload PostgREST schema cache (fixes PGRST204 after DDL)
NOTIFY pgrst, 'reload schema';
