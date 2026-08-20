-- ─────────────────────────────────────────────────────────────────────────
-- Migration 025: DB-level enforcement of organizations.profile_limit
--
-- The API also checks getEntitlement().canCreateProfile before inserting, but an
-- application-level count is NOT race-safe: two parallel "create the 11th profile"
-- requests can both read count=10 and both insert. This trigger is the backstop.
--
-- Race safety comes from SELECT ... FOR UPDATE on the org row: concurrent inserts
-- for the SAME org serialise on that lock, so the second only counts after the
-- first has committed — it then sees the new row and is rejected at the limit.
--
-- Only 'active' profiles count toward the limit (archived free a slot). Archiving
-- is an UPDATE, so this BEFORE INSERT trigger never blocks it.
--
-- Idempotent (CREATE OR REPLACE / DROP TRIGGER IF EXISTS). Review only.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_profile_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit INT;
  v_count INT;
BEGIN
  -- Archived / non-active inserts don't consume a slot.
  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  -- Serialise concurrent creates for this org on the org row lock.
  SELECT profile_limit INTO v_limit
  FROM organizations WHERE id = NEW.org_id
  FOR UPDATE;

  IF v_limit IS NULL THEN
    RAISE EXCEPTION 'PROFILE_LIMIT_REACHED: org % has no profile_limit', NEW.org_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_count
  FROM doctor_profiles
  WHERE org_id = NEW.org_id AND status = 'active';

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'PROFILE_LIMIT_REACHED: org % is at its % active-profile limit', NEW.org_id, v_limit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_profile_limit ON doctor_profiles;
CREATE TRIGGER trg_enforce_profile_limit
  BEFORE INSERT ON doctor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_limit();

NOTIFY pgrst, 'reload schema';
