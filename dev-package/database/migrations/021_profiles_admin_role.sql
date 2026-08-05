-- ─────────────────────────────────────────────────────────────────────────
-- Migration 021: profiles.role — the smallest admin flag the CMS needs
--
-- Run this in: Supabase dashboard → SQL Editor
-- Run order:   017 → 018 → 019 → 020 → 021
--
-- Adds one column to the existing profiles table rather than introducing a
-- separate admins table, so there is one place to ask "who is this user".
-- Every existing row becomes role = 'user' automatically and nothing currently
-- reads the column, so existing logins, plans and dashboards are unaffected.
--
-- No middleware is added here — requireAdmin belongs to Phase 4. This
-- migration only makes it possible to answer the question, and makes it
-- impossible for a user to answer it in their own favour.
--
-- ── The security problem this has to solve ────────────────────────────────
-- profiles carries this policy from migration 004:
--
--     CREATE POLICY "users_own_profile" ON profiles
--       FOR ALL USING (auth.uid() = id);
--
-- FOR ALL, and with WITH CHECK omitted PostgreSQL reuses the USING expression
-- as the WITH CHECK — so a logged-in user may INSERT, UPDATE and DELETE their
-- own row. The anon key that authorises such a request is public by design:
-- routes/config.js serves it to every browser. Migrations 001–016 contain no
-- GRANT or REVOKE at all, so the table still carries Supabase's default
-- "ALL to anon, authenticated, service_role".
--
-- Adding a `role` column to that table therefore creates two self-promotion
-- paths, not one:
--   • UPDATE their own row, setting role = 'admin'
--   • DELETE their row (or never have one — profiles rows are created lazily)
--     and INSERT a fresh one with id = auth.uid() and role = 'admin'
--
-- Step 4 below closes both, unconditionally, without changing what any
-- existing flow is allowed to do. Step 5 is a broader lockdown that is
-- recommended but optional, and is called out separately because it changes
-- an existing production permission.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. The column. Postgres 11+ fills a NOT NULL DEFAULT without rewriting the
--    table, so this is fast and safe on a live profiles table.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

-- 2. Constrain the values. Added as a named constraint (rather than inline)
--    so re-running this migration cannot stack duplicate anonymous CHECKs.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_role_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_role_check CHECK (role IN ('user', 'admin'));
  END IF;
END $$;

-- 3. Admins are a handful of rows in a table of customers, so index only them.
CREATE INDEX IF NOT EXISTS idx_profiles_admin
  ON profiles (id) WHERE role = 'admin';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. THE INVARIANT: only a trusted server role may set or change `role`.
--
-- A trigger rather than a policy or a column grant, because those cannot
-- express this rule:
--   • RLS WITH CHECK sees only the new row, so it cannot say "role must not
--     have changed" — only "role must equal some literal", which would also
--     block the server.
--   • Column-level REVOKE does not work while a table-level UPDATE grant
--     exists: in PostgreSQL the table-level privilege already covers every
--     column, and revoking one column does not subtract from it.
--
-- The trigger holds regardless of what the grants happen to be, so it keeps
-- working even if someone later runs the common
-- "GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated" snippet,
-- or adds a permissive policy. It is the layer that actually guarantees the
-- requirement; step 5 is defence in depth on top of it.
--
-- SECURITY INVOKER (the default) is REQUIRED and must not be changed to
-- SECURITY DEFINER: the check reads current_user, and under SECURITY DEFINER
-- that would resolve to the function owner and always pass.
--
-- PostgREST runs each request as the role named in the JWT — 'authenticated'
-- for a logged-in browser, 'anon' for a public one, 'service_role' for the
-- server's service key. The SQL editor runs as 'postgres'. The rolsuper /
-- rolbypassrls fallback keeps this working if Supabase ever renames its
-- privileged roles; both attributes are only ever held by privileged roles.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION profiles_guard_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  -- Trusted writers: the server's service-role client, and the database owner
  -- running migrations or the admin bootstrap in the SQL editor.
  IF current_user IN ('service_role', 'postgres', 'supabase_admin')
     OR COALESCE(
          (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user),
          false
        )
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A user creating their own profile row may only create a plain user.
    IF NEW.role IS DISTINCT FROM 'user' THEN
      RAISE EXCEPTION
        'profiles.role may only be assigned by the server (attempted %)', NEW.role
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: every other column may still be written by whoever the grants and
  -- policies allow. Only role is frozen.
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION
      'profiles.role may only be changed by the server (% -> %)', OLD.role, NEW.role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'profiles_guard_role'
  ) THEN
    CREATE TRIGGER profiles_guard_role
      BEFORE INSERT OR UPDATE ON profiles
      FOR EACH ROW EXECUTE FUNCTION profiles_guard_role();
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. OPTIONAL, RECOMMENDED: make the database match how the app actually works.
--
-- Not required for the admin invariant — step 4 already guarantees that. This
-- step exists because every profiles write in this application is already
-- server-side, so the client write privileges are unused capability:
--
--   reads   routes/user/me.js, routes/user/dashboard.js, routes/auth/login.js,
--           routes/reconcile.js, routes/weekly-check.js
--   writes  routes/user/me.js (lazy INSERT + plan upgrade/expiry UPDATE),
--           routes/verify-subscription-payment.js (upsert),
--           routes/webhook-razorpay.js (plan UPDATE),
--           routes/user/reports.js, routes/reconcile.js
--
-- All of them use getSupabaseClient(), the service-role client. Every browser
-- page that loads supabase-js (auth.html, dashboard.html, audit-history.html,
-- checkout*.html, reset-password.html) uses it exclusively for auth calls —
-- signInWithPassword, setSession, getSession, updateUser(password),
-- resetPasswordForEmail, signOut. There is not one .from('profiles') call, or
-- any .from() call at all, anywhere under public/.
--
-- SIDE EFFECT YOU SHOULD DECIDE ON: this also closes a pre-existing hole that
-- has nothing to do with the CMS. The same "users_own_profile" policy today
-- lets a user UPDATE their own `plan` — a self-service upgrade from 'free' to
-- 'monitor', which is the $49 tier. Revoking table-level UPDATE closes that
-- too, and it cannot be scoped to a single column for the reason in step 4.
--
-- If you would rather review that separately, comment out the REVOKE below.
-- The admin invariant is unaffected either way; you would simply be leaving
-- the existing plan behaviour exactly as it is today.
--
-- SELECT is deliberately left in place: "users_own_profile" already restricts
-- a read to the caller's own row, and revoking it could break a future
-- client-side profile read for no security gain. service_role is never named
-- in this REVOKE and holds its own grants, so no server flow is affected.
-- ─────────────────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles FROM anon, authenticated;

-- Immediately re-state the server's own access. service_role is not named in
-- the REVOKE above and therefore keeps everything it had — but on the one
-- table where a mistake would break signup, login, checkout and every webhook
-- at once, "unaffected" should be visible in the SQL rather than inferred from
-- which roles the previous line omits. Granting a privilege that is already
-- held is a no-op, so this cannot change anything except a broken outcome.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO service_role;

-- ── Creating the first admin ──────────────────────────────────────────────
-- Left commented out: this migration inserts and updates no data.
--
-- Run it in the SQL editor, which connects as 'postgres' and is therefore a
-- trusted writer under step 4. Note that profiles rows are NOT created
-- automatically — there is no trigger on auth.users; routes/user/me.js and
-- routes/verify-subscription-payment.js create them lazily. So an account made
-- straight from the Supabase dashboard may have an auth.users row and no
-- profiles row, which is why this is an upsert rather than an UPDATE.
--
-- INSERT INTO profiles (id, email, name, plan, role)
-- SELECT u.id,
--        u.email,
--        COALESCE(u.raw_user_meta_data ->> 'name', ''),
--        'free',
--        'admin'
--   FROM auth.users u
--  WHERE lower(u.email) = lower('replace-with-your-admin@example.com')
-- ON CONFLICT (id) DO UPDATE SET role = 'admin';
--
-- Verify afterwards:
--   SELECT email, plan, role FROM profiles WHERE role = 'admin';
--
-- Confirm the guard is live (should raise insufficient_privilege):
--   SET LOCAL ROLE authenticated;
--   UPDATE profiles SET role = 'admin' WHERE id = '<some-uuid>';
--   RESET ROLE;

NOTIFY pgrst, 'reload schema';
