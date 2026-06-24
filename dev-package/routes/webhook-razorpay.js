'use strict';

require('../lib/env');

const crypto  = require('crypto');
const { getSupabaseClient } = require('../lib/supabase-client');
const auditCache  = require('../lib/audit-cache');
const paidReports = require('../lib/paid-reports');
const { afterResponse } = require('../lib/after-response');

function verifySignature(rawBody, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return expected === signature;
}

// Statuses that mean another path already OWNS this order (verify-payment's
// pipeline is in-flight, or the report is finished). The webhook backstop must
// not touch these — re-driving would risk a duplicate report/email. Note 'failed'
// is deliberately NOT here: a failed attempt may be followed by a successful
// retry, which payment.captured is allowed to re-drive.
const CAPTURE_OWNED = new Set(['generating', 'delivered', 'generated']);

// ── payment.captured (one-time ₹1,599 report) — verified-payment backstop ────
// The browser normally unlocks the report via /api/verify-payment. If the user
// closes the tab right after paying, this webhook (signature already verified
// above) is the reliable fallback: it maps the payment → auditId via the order
// notes, and runs the SAME idempotent pipeline. Idempotent + status-guarded, so
// it never double-generates an order verify-payment (or reconcile) already drove.
// Returns a background task to run after the 200 response, or null if nothing to do.
async function planPaymentCaptured(event) {
  const pay     = event.payload?.payment?.entity || {};
  const orderId = pay.order_id;
  const email   = pay.email || '';

  // Subscription charges also arrive as payment.captured but carry no order_id
  // for a report — those are handled by subscription.charged. Skip them here.
  if (!orderId) {
    console.log('[rzp-webhook] payment.captured without order_id — not a report order, skip');
    return null;
  }

  const auditId = await auditCache.resolveAuditIdFromOrder(orderId, null);
  if (!auditId || !auditCache.isValidAuditId(auditId)) {
    console.log(`[rzp-webhook] payment.captured order=${orderId} has no report auditId in notes — skip`);
    return null;
  }

  // Idempotency: only act when this order is still 'pending' (verify-payment
  // never ran — e.g. the tab was closed) or 'failed' (a retry succeeded). If
  // verify-payment/reconcile already owns it, skip to avoid double generation.
  const row = await paidReports.get(auditId);
  if (row && (row.delivered_at || CAPTURE_OWNED.has(row.status))) {
    console.log(`[rzp-webhook] payment.captured auditId=${auditId} already status=${row.status} delivered=${!!row.delivered_at} — no-op`);
    return null;
  }

  // Need the cached audit data to generate. If it is gone, support/reconcile path.
  const cache = await auditCache.getDetailed(auditId);
  if (!cache.hit || !cache.data) {
    console.warn(`[rzp-webhook] payment.captured auditId=${auditId} but audit_cache MISS — cannot generate from webhook`);
    return null;
  }

  await paidReports.updateStatus(auditId, { status: 'generating', stripe_session_id: orderId });
  const recipient = email || row?.email || cache.data.email || '';
  console.log(`[rzp-webhook] payment.captured backstop → generating auditId=${auditId} email=${recipient}`);

  const { runReportPipeline } = require('./report');
  return () => runReportPipeline({ auditId, email: recipient, userId: null });
}

// ── payment.failed — record the failure (never unlocks anything) ─────────────
async function handlePaymentFailed(event) {
  const pay     = event.payload?.payment?.entity || {};
  const orderId = pay.order_id;
  if (!orderId) { console.log('[rzp-webhook] payment.failed without order_id — skip'); return; }

  const auditId = await auditCache.resolveAuditIdFromOrder(orderId, null);
  if (!auditId || !auditCache.isValidAuditId(auditId)) {
    console.log(`[rzp-webhook] payment.failed order=${orderId} not a report order — skip`);
    return;
  }
  // Non-destructive: only record 'failed' when the order is still 'pending'.
  // If it's already generating/delivered (a successful attempt), leave it alone.
  // A later successful payment.captured is still allowed to re-drive a 'failed' row.
  const row = await paidReports.get(auditId);
  if (row && row.status !== 'pending') {
    console.log(`[rzp-webhook] payment.failed auditId=${auditId} but already status=${row.status} — leaving as-is`);
    return;
  }
  await paidReports.updateStatus(auditId, { status: 'failed' });
  console.log(`[rzp-webhook] payment.failed recorded auditId=${auditId} reason=${pay.error_description || pay.error_reason || '(none)'}`);
}

async function handler(req, res) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[rzp-webhook] RAZORPAY_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const sig     = req.headers['x-razorpay-signature'];
  const rawBody = req.body; // must be raw Buffer — registered with express.raw()

  if (!sig) {
    console.error('[rzp-webhook] missing x-razorpay-signature header');
    return res.status(400).json({ error: 'Missing signature' });
  }

  if (!verifySignature(rawBody, sig, secret)) {
    console.error('[rzp-webhook] signature mismatch');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const eventType = event.event;

  // ── Payment events (one-time ₹1,599 report) ───────────────────────────────
  if (eventType === 'payment.captured' || eventType === 'payment.failed') {
    try {
      if (eventType === 'payment.captured') {
        const task = await planPaymentCaptured(event);
        // Respond fast (Razorpay expects a quick 200); the pipeline runs after.
        if (task) afterResponse(task, `rzp-webhook:payment.captured`);
      } else {
        await handlePaymentFailed(event);
      }
    } catch (err) {
      console.error(`[rzp-webhook] ${eventType} processing error:`, err.message);
      // 200 so Razorpay doesn't retry on our internal errors.
    }
    return res.json({ received: true });
  }

  // ── Subscription events ($49 Monitor) ─────────────────────────────────────
  const payload   = event.payload?.subscription?.entity || {};
  const subId     = payload.id;
  const notes     = payload.notes || {};
  const userId    = notes.user_id;

  console.log(`[rzp-webhook] event=${eventType} subId=${subId} userId=${userId}`);

  const supabase = getSupabaseClient();

  try {
    switch (eventType) {
      case 'subscription.activated': {
        // Activate subscription + promote user plan to 'monitor'
        await supabase.from('subscriptions')
          .update({
            status:       'active',
            start_date:   new Date().toISOString(),
            updated_at:   new Date().toISOString(),
          })
          .eq('razorpay_subscription_id', subId);

        if (userId) {
          await supabase.from('profiles')
            .update({ plan: 'monitor', updated_at: new Date().toISOString() })
            .eq('id', userId);
          console.log(`[rzp-webhook] user ${userId} plan → monitor`);
        }
        break;
      }

      case 'subscription.charged': {
        // Update renewal date from next charge timestamp
        const nextChargeAt = payload.charge_at
          ? new Date(payload.charge_at * 1000).toISOString()
          : null;

        await supabase.from('subscriptions')
          .update({
            status:       'active',
            renewal_date: nextChargeAt,
            updated_at:   new Date().toISOString(),
          })
          .eq('razorpay_subscription_id', subId);
        break;
      }

      case 'subscription.cancelled':
      case 'subscription.completed': {
        await supabase.from('subscriptions')
          .update({
            status:     eventType === 'subscription.cancelled' ? 'cancelled' : 'completed',
            updated_at: new Date().toISOString(),
          })
          .eq('razorpay_subscription_id', subId);

        if (userId) {
          // Downgrade: check if user has a $19 paid report — keep 'audit', otherwise 'free'
          const { data: paidRow } = await supabase
            .from('paid_reports')
            .select('id')
            .eq('user_id', userId)
            .eq('status', 'delivered')
            .limit(1)
            .single();

          const downgradePlan = paidRow ? 'audit' : 'free';
          await supabase.from('profiles')
            .update({ plan: downgradePlan, updated_at: new Date().toISOString() })
            .eq('id', userId);
          console.log(`[rzp-webhook] user ${userId} plan → ${downgradePlan} (subscription ended)`);
        }
        break;
      }

      case 'subscription.pending':
      case 'subscription.halted': {
        await supabase.from('subscriptions')
          .update({ status: 'past_due', updated_at: new Date().toISOString() })
          .eq('razorpay_subscription_id', subId);
        break;
      }

      default:
        console.log(`[rzp-webhook] unhandled event type: ${eventType}`);
    }

    return res.json({ received: true });

  } catch (err) {
    console.error('[rzp-webhook] processing error:', err.message);
    // Return 200 so Razorpay doesn't retry indefinitely on our DB errors
    return res.json({ received: true, warning: err.message });
  }
}

module.exports = handler;
