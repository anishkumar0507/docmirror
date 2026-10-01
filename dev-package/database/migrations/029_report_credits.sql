-- ─────────────────────────────────────────────────────────────────────────
-- Migration 029: report_credits — the buy-first, redeem-later one-time report
--
-- Distinct from the EXISTING anonymous "scan first, pay after" report flow
-- (paid_reports + audit_cache, unchanged, still works exactly as it did). This
-- table backs a SECOND, authenticated purchase path: pay for a report before
-- you know which doctor it's for, then redeem it later on
-- /pages/redeem-report.html.
--
-- payment_id is UNIQUE so the same Razorpay payment can never grant a second
-- credit, whether it is granted by routes/verify-payment.js (the client
-- callback) or routes/webhook-razorpay.js (the backstop) — both call the same
-- lib/report-credits.js grantCredit(), and the second caller's insert is a
-- harmless duplicate-key no-op.
--
-- SAFETY
-- CREATE TABLE IF NOT EXISTS + guarded policy/index creation — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS report_credits (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  payment_id         TEXT        NOT NULL UNIQUE,   -- Razorpay payment id — the tamper-proof idempotency key
  order_audit_id     TEXT,                          -- paid_reports.audit_id this purchase's order was tracked under
  provider           TEXT        NOT NULL DEFAULT 'razorpay',
  currency           TEXT        NOT NULL,
  amount_units       INTEGER     NOT NULL,           -- minor units (paise/cents), what was actually charged
  status             TEXT        NOT NULL DEFAULT 'available'
                                 CHECK (status IN ('available', 'used')),
  doctor_ref         TEXT,                           -- set at redemption: "<doctor name>, <city>"
  redeemed_audit_id  TEXT,                            -- the NEW auditId minted at redemption (the actual report/PDF)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_report_credits_user_status ON report_credits(user_id, status);
CREATE INDEX IF NOT EXISTS idx_report_credits_redeemed_audit_id ON report_credits(redeemed_audit_id);

ALTER TABLE report_credits ENABLE ROW LEVEL SECURITY;

-- Service role (every server route) has unrestricted access — the same pattern
-- migration 004 (profiles) and 001 (paid_reports) use.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'report_credits' AND policyname = 'service_role_report_credits'
  ) THEN
    CREATE POLICY "service_role_report_credits" ON report_credits
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- A user may read their OWN credits (used by the redeem page to show "you have
-- N credits" without a server round-trip in the browser, if that path is ever
-- used) but never write — every write goes through the service-role routes
-- (grant/consume), never directly from the browser.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'report_credits' AND policyname = 'users_read_own_report_credits'
  ) THEN
    CREATE POLICY "users_read_own_report_credits" ON report_credits
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

COMMENT ON TABLE report_credits IS
  'One-time PDF report credits bought before the doctor is known (buy-first, redeem-later). See lib/report-credits.js, routes/report-credits.js. Distinct from paid_reports, which tracks the anonymous scan-first report purchase and every Razorpay order (including the order this credit was purchased under, linked via order_audit_id).';

NOTIFY pgrst, 'reload schema';
