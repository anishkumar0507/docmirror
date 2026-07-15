-- Migration 015: subscription access window — cancel now, keep access until cycle end
-- Supports self-serve "Cancel subscription": the Razorpay subscription is cancelled
-- IMMEDIATELY (auto-pay stops, no future charges), but the user keeps
-- profiles.plan = 'monitor' until the end of the already-paid billing cycle.
--   access_until  — end of the paid cycle; after this, lazy-expiry downgrades the plan
--   cancelled_at  — when the user cancelled
-- The actual downgrade happens on read (routes/user/me.js) and via the reconcile
-- backstop (routes/reconcile.js), since there is no reliable daily cron.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS access_until TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
