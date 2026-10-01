-- ─────────────────────────────────────────────────────────────────────────
-- Migration 028: profiles.billing_currency — locks a paying customer to the
-- currency they were first charged in
--
-- WHY
-- Region resolution (lib/region.js) picks a tier from geo/force/switcher on
-- EVERY request. Without a lock, a customer who paid in INR could later be
-- geo-resolved to US (VPN, travel, a shared office IP) and see/be offered USD
-- pricing for their NEXT charge, which must never diverge from what their
-- existing Razorpay subscription/plan actually bills.
--
-- Set once, server-side, right after the first successful payment verification
-- (never from a request body) — see routes/checkout-monitor.js and
-- routes/agency.js. NULL means "never paid" — resolveRegion() then falls through
-- to the switcher/geo/default exactly as before this migration.
--
-- SAFETY
-- Purely additive (ADD COLUMN IF NOT EXISTS) — every existing row keeps working
-- with billing_currency NULL, which is the same as today's behavior (no lock).
-- Idempotent: safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS billing_currency TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_billing_currency_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_billing_currency_check
      CHECK (billing_currency IS NULL OR billing_currency IN ('INR', 'USD'));
  END IF;
END $$;

COMMENT ON COLUMN profiles.billing_currency IS
  'Currency this customer was first successfully charged in (INR|USD), set once after payment verification. NULL = never paid. lib/region.js locks resolveRegion() to this once set, so a later geo/switcher change never quotes or charges a paying customer in a different currency than their live subscription.';

-- ── paid_reports / subscriptions: what a buyer was actually quoted ─────────
-- These currency/amount/region columns were first drawn up in migration 016,
-- whose own follow-up (017) notes it was never actually applied anywhere — so
-- this migration re-declares them itself (all IF NOT EXISTS/ADD COLUMN, so this
-- is a no-op wherever 016 WAS applied) rather than depending on that. tier_id is
-- new: the lib/pricing.js tierId ('report_onetime'/'single_doctor_monthly'/
-- 'org_monthly') the row was created for, so routes/verify-payment.js and the
-- new subscription verify can look up exactly what was sold without re-deriving
-- it from a region lookup that could resolve differently by the time of verify.
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS provider     TEXT NOT NULL DEFAULT 'razorpay';
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS tier_id      TEXT;
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS region_tier  TEXT;
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS country      TEXT;
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS currency     TEXT;
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS amount_units INTEGER;  -- minor units (paise/cents)

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider                 TEXT NOT NULL DEFAULT 'razorpay';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS currency                 TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS tier_id                  TEXT;

UPDATE subscriptions
   SET provider_subscription_id = razorpay_subscription_id
 WHERE provider_subscription_id IS NULL
   AND razorpay_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_sub_id
  ON subscriptions(provider_subscription_id);

-- Reload PostgREST schema cache (fixes PGRST204 after DDL)
NOTIFY pgrst, 'reload schema';
