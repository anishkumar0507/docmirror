-- Migration 006: Razorpay subscription tracking for $49/month Monitor plan

CREATE TABLE IF NOT EXISTS subscriptions (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID        REFERENCES profiles(id) ON DELETE CASCADE,
  plan                      TEXT        NOT NULL DEFAULT 'monitor',
  status                    TEXT        NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('active','cancelled','past_due','pending','completed')),
  razorpay_subscription_id  TEXT        UNIQUE,
  razorpay_plan_id          TEXT,
  start_date                TIMESTAMPTZ,
  renewal_date              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status  ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_rzp_id  ON subscriptions(razorpay_subscription_id);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'subscriptions' AND policyname = 'service_role_subscriptions'
  ) THEN
    CREATE POLICY "service_role_subscriptions" ON subscriptions
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DROP TRIGGER IF EXISTS subscriptions_updated_at ON subscriptions;
CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
