'use strict';

require('../lib/env');

const Razorpay = require('razorpay');
const { getSupabaseClient } = require('../lib/supabase-client');
const { requireAuth } = require('../lib/auth-middleware');

// Self-serve cancel: stop Razorpay auto-pay IMMEDIATELY, but keep the user's
// Monitor access until the end of the already-paid billing cycle (access_until).
// The actual plan downgrade happens later via lazy-expiry (routes/user/me.js +
// routes/reconcile.js), so cancelling never instantly kills paid access.
async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // requireAuth populates req.user (same pattern as routes/user/me.js)
  await new Promise((resolve, reject) =>
    requireAuth(req, res, err => err ? reject(err) : resolve())
  ).catch(() => {}); // requireAuth already sent response on failure
  if (res.headersSent) return;

  const supabase = getSupabaseClient();
  if (!supabase) return res.status(500).json({ error: 'Database not configured' });

  const userId = req.user.id;

  // 1. Find the user's ACTIVE subscription
  const { data: sub, error: subErr } = await supabase
    .from('subscriptions')
    .select('razorpay_subscription_id, renewal_date, status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (subErr || !sub || !sub.razorpay_subscription_id) {
    return res.status(404).json({ error: 'No active subscription found' });
  }
  const razorpaySubId = sub.razorpay_subscription_id;

  const razorpay = new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });

  // 2. FIRST fetch the live subscription to capture the current paid-cycle end
  //    (current_end = unix seconds = "month end").
  let accessUntil = null;
  try {
    const live = await razorpay.subscriptions.fetch(razorpaySubId);
    if (live && live.current_end) {
      accessUntil = new Date(live.current_end * 1000).toISOString();
    }
  } catch (e) {
    console.warn('[cancel-subscription] Razorpay fetch warn:', e.message);
  }
  if (!accessUntil) accessUntil = sub.renewal_date || null; // fall back to stored renewal date

  // 3. THEN cancel on Razorpay IMMEDIATELY (cancel-at-cycle-end = false → auto-pay stops now).
  try {
    await razorpay.subscriptions.cancel(razorpaySubId, false);
    console.log(`[cancel-subscription] Razorpay ${razorpaySubId} cancelled (immediate) user=${userId}`);
  } catch (e) {
    const msg = (e && (e.error && e.error.description)) || (e && e.message) || String(e);
    // Already cancelled/completed → treat as success and continue.
    if (/already|cancelled|not.*active|non.?active|completed/i.test(msg)) {
      console.log(`[cancel-subscription] Razorpay reports already cancelled (${msg}) — continuing`);
    } else {
      console.error('[cancel-subscription] Razorpay cancel failed:', msg);
      return res.status(502).json({ error: 'Could not cancel with the payment provider. Please try again.' });
    }
  }

  // 4. Update the subscription row. Do NOT downgrade profiles.plan here — the user
  //    keeps 'monitor' until access_until (lazy-expiry performs the downgrade).
  const nowIso = new Date().toISOString();
  const update = { status: 'cancelled', cancelled_at: nowIso, updated_at: nowIso };
  if (accessUntil) update.access_until = accessUntil;

  const { error: updErr } = await supabase
    .from('subscriptions')
    .update(update)
    .eq('user_id', userId)
    .eq('razorpay_subscription_id', razorpaySubId);

  if (updErr) {
    // Defensive: if access_until/cancelled_at columns aren't migrated yet, don't crash —
    // retry a minimal update so the subscription is still marked cancelled. The
    // subscription.cancelled webhook is a further backstop for access_until.
    console.warn('[cancel-subscription] subscription update warn (retrying minimal):', updErr.message);
    await supabase
      .from('subscriptions')
      .update({ status: 'cancelled', updated_at: nowIso })
      .eq('user_id', userId)
      .eq('razorpay_subscription_id', razorpaySubId)
      .then(() => {}, () => {});
  }

  return res.status(200).json({ ok: true, access_until: accessUntil });
}

module.exports = handler;
