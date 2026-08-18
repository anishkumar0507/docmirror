-- ─────────────────────────────────────────────────────────────────────────
-- STEP 2 companion — per-user backfill function (run ONCE in Supabase SQL
-- Editor before `node scripts/backfill-orgs.js --apply`).
--
-- Why a function: this project reaches Postgres only through the Supabase REST
-- API (no `pg`, no direct connection string), so a Node script cannot open a
-- real multi-statement transaction. A plpgsql function body IS one transaction —
-- so each backfill_org_for_user() call is all-or-nothing (no partial state).
--
-- Idempotent: re-running creates NO duplicates — it reuses the user's existing
-- solo org / doctor_profile and links only audits that are still NULL.
--
-- Note the column spelling: reports.specialty (American) → doctor_profiles.speciality (British).
-- ─────────────────────────────────────────────────────────────────────────

-- OUT column names are prefixed out_* so they never collide with the tables'
-- own org_id / doctor_profile_id columns (else "column reference is ambiguous").
CREATE OR REPLACE FUNCTION public.backfill_org_for_user(p_user_id UUID)
RETURNS TABLE (created_org BOOLEAN, out_org_id UUID, out_doctor_profile_id UUID,
               reports_linked INT, paid_linked INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id      UUID;
  v_profile_id  UUID;
  v_created     BOOLEAN := false;
  v_plan        TEXT;
  v_name        TEXT;
  v_email       TEXT;
  v_doctor_name TEXT;
  v_speciality  TEXT;
  v_city        TEXT;
  v_reports_linked INT := 0;
  v_paid_linked    INT := 0;
BEGIN
  SELECT plan, name, email INTO v_plan, v_name, v_email
  FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, 0, 0;  -- no such profile
    RETURN;
  END IF;

  -- Idempotency: has this user already been backfilled (owns a solo org)?
  SELECT o.id INTO v_org_id
  FROM organizations o
  JOIN org_members m ON m.org_id = o.id
  WHERE m.user_id = p_user_id AND m.role = 'owner' AND o.type = 'solo'
  LIMIT 1;

  -- Doctor details come from the user's most recent report (best available source).
  SELECT doctor_name, specialty, city
    INTO v_doctor_name, v_speciality, v_city
  FROM reports WHERE user_id = p_user_id
  ORDER BY created_at DESC LIMIT 1;

  IF v_org_id IS NULL THEN
    INSERT INTO organizations (name, type, plan, profile_limit)
    VALUES (COALESCE(v_name, v_email, 'Solo practice'), 'solo', COALESCE(v_plan, 'free'), 1)
    RETURNING id INTO v_org_id;

    INSERT INTO org_members (org_id, user_id, role)
    VALUES (v_org_id, p_user_id, 'owner')
    ON CONFLICT (org_id, user_id) DO NOTHING;

    v_created := true;
  END IF;

  -- Ensure exactly one doctor_profile for this org.
  SELECT dp.id INTO v_profile_id
  FROM doctor_profiles dp WHERE dp.org_id = v_org_id
  ORDER BY dp.created_at ASC LIMIT 1;

  IF v_profile_id IS NULL THEN
    INSERT INTO doctor_profiles (org_id, name, speciality, city, status)
    VALUES (v_org_id, COALESCE(v_doctor_name, v_name, v_email), v_speciality, v_city, 'active')
    RETURNING id INTO v_profile_id;
  END IF;

  -- Link audits — only rows not yet linked (idempotent). Columns qualified so
  -- they can never be read as the function's OUT parameters.
  UPDATE reports r SET org_id = v_org_id, doctor_profile_id = v_profile_id
  WHERE r.user_id = p_user_id AND r.org_id IS NULL;
  GET DIAGNOSTICS v_reports_linked = ROW_COUNT;

  UPDATE paid_reports pr SET org_id = v_org_id, doctor_profile_id = v_profile_id
  WHERE pr.user_id = p_user_id AND pr.org_id IS NULL;
  GET DIAGNOSTICS v_paid_linked = ROW_COUNT;

  RETURN QUERY SELECT v_created, v_org_id, v_profile_id, v_reports_linked, v_paid_linked;
END;
$$;
