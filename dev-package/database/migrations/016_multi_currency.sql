-- Migration 016: multi-currency / multi-provider groundwork
-- Region-aware pricing now charges in the buyer's currency (INR for India, USD
-- for US/INTL) instead of always INR. Record WHAT was charged and by WHICH
-- provider on each row so reconciliation is unambiguous once a second provider
-- (Cashfree) comes online in the next phase.
--
-- This migration is provider-neutral and additive only. razorpay_subscription_id
-- is intentionally NOT dropped — existing code still reads it; the new
-- provider_subscription_id is a superset backfilled from it.

-- paid_reports: what currency/amount/region/provider a one-time report was sold at.
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS provider     TEXT NOT NULL DEFAULT 'razorpay';
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS region_tier  TEXT;
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS country      TEXT;
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS currency     TEXT;
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS amount_units INTEGER;  -- minor units (paise/cents)

-- subscriptions: provider-neutral id + currency, alongside the legacy razorpay id.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider                 TEXT NOT NULL DEFAULT 'razorpay';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS currency                 TEXT;

-- Backfill the provider-neutral id from the existing Razorpay column so old rows
-- are usable through the new column immediately.
UPDATE subscriptions
   SET provider_subscription_id = razorpay_subscription_id
 WHERE provider_subscription_id IS NULL
   AND razorpay_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_sub_id
  ON subscriptions(provider_subscription_id);

NOTIFY pgrst, 'reload schema';
