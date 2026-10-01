'use strict';

require('../lib/env');

const crypto  = require('crypto');
const { getSupabaseClient } = require('../lib/supabase-client');
const auditCache  = require('../lib/audit-cache');
const paidReports = require('../lib/paid-reports');
const { afterResponse } = require('../lib/after-response');
const payments = require('../lib/payments');
const subscriptionFlow = require('../lib/payments/subscription-flow');
const reportCredits = require('../lib/report-credits');
const { provisionAgencyOrg } = require('./agency');
const { provisionMonitor } = require('./checkout-monitor');

// notes.plan (set at createSubscription time — see lib/payments/subscription-
// flow.js createTierSubscription and, for the OLD anonymous Monitor flow,
// routes/checkout-subscription.js) -> the tierId to provision. Legacy values
// ('agency' from before routes/agency.js was made region-aware, 'monitor' from
// the anonymous flow) map onto the same tierId their new equivalents use.
const TIER_ID_FOR_NOTE_PLAN = {
  org_monthly: 'org_monthly', agency: 'org_monthly',
  single_doctor_monthly: 'single_doctor_monthly', monitor: 'single_doctor_monthly',
};

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

// ── payment.captured (one-time report / report credit) — verified-payment backstop ──
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

  // Need the cached audit data to generate. If it is gone, this is either the
  // buy-first report-credit purchase (routes/checkout.js never caches audit
  // data for those — nothing to generate yet, no doctor chosen) or a genuinely
  // lost order for the support/reconcile path.
  const cache = await auditCache.getDetailed(auditId);
  if (!cache.hit || !cache.data) {
    if (row && row.tier_id === 'report_onetime' && row.user_id) {
      // Same idempotent grant routes/verify-payment.js uses — payment_id is
      // UNIQUE, so if the client callback already granted this, this is a
      // harmless no-op, never a second credit for the same payment.
      const grant = await reportCredits.grantCredit({
        userId: row.user_id, paymentId: pay.id, orderAuditId: auditId,
        currency: row.currency, amountUnits: row.amount_units,
      });
      if (grant.ok) {
        await paidReports.updateStatus(auditId, { status: 'delivered', stripe_session_id: orderId, delivered_at: new Date().toISOString() });
        console.log(`[rzp-webhook] payment.captured backstop → report credit granted auditId=${auditId} userId=${row.user_id} created=${grant.created}`);
      } else {
        console.error(`[rzp-webhook] payment.captured backstop credit grant FAILED auditId=${auditId} userId=${row.user_id} reason=${grant.reason}`);
      }
      return null;
    }
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

  // ── Payment events (one-time report / report credit) ─────────────────────
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

  // ── Subscription events (Monitor + Agency, INR and USD) ────────────────────
  const payload   = event.payload?.subscription?.entity || {};
  const subId     = payload.id;
  const notes     = payload.notes || {};
  // notes.userId (camelCase) is what createSubscription actually writes (see
  // lib/payments/razorpay.js) — notes.user_id (snake_case) was read here before
  // and never matched anything, so this branch could never activate a plan; it
  // silently relied on the client-callback verify route every time instead.
  const userId    = notes.userId || '';

  console.log(`[rzp-webhook] event=${eventType} subId=${subId} userId=${userId} notesPlan=${notes.plan || '?'}`);

  const supabase = getSupabaseClient();

  try {
    switch (eventType) {
      case 'subscription.activated': {
        // Activate subscription (provider-neutral state) unconditionally —
        // idempotent, safe even if a plan/provisioning step below is skipped.
        await supabase.from('subscriptions')
          .update({
            status:       'active',
            start_date:   new Date().toISOString(),
            updated_at:   new Date().toISOString(),
          })
          .eq('razorpay_subscription_id', subId);

        // Full plan activation is a BACKSTOP here — the client-callback verify
        // route (routes/agency.js / routes/checkout-monitor.js) is what
        // normally does this, immediately after payment. This only matters when
        // the tab closed before that call landed. Anonymous Monitor purchases
        // (routes/checkout-subscription.js) carry no notes.userId and are
        // deliberately left alone — that flow's OWN verify route
        // (routes/verify-subscription-payment.js, not touched by this change)
        // is still the only thing that activates them.
        const tierId = TIER_ID_FOR_NOTE_PLAN[notes.plan];
        if (userId && tierId) {
          let plan;
          try {
            plan = await payments.get('razorpay').fetchPlan(payload.plan_id);
          } catch (e) {
            console.warn(`[rzp-webhook] could not fetch plan for backstop subId=${subId}: ${e.message}`);
            break;
          }
          // Same three-factor check the verify routes run, minus the per-call
          // HMAC (this whole payload is already signature-verified above).
          const check = subscriptionFlow.matchAndCheckTier({ expectedTierId: tierId, sub: payload, plan });
          if (!check.ok) {
            console.warn(`[rzp-webhook] backstop declined to provision subId=${subId} userId=${userId} reason=${check.reason} failed=${(check.failed || []).join(',')}`);
            break;
          }
          const result = tierId === 'org_monthly'
            ? await provisionAgencyOrg({
                userId, email: '', subscriptionId: subId, razorpayPlanId: payload.plan_id,
                profileLimit: check.tier.profileLimit, currency: check.tier.currency,
              })
            : await provisionMonitor({
                userId, subscriptionId: subId, razorpayPlanId: payload.plan_id, currency: check.tier.currency,
              });
          if (result.ok) console.log(`[rzp-webhook] backstop provisioned userId=${userId} tier=${tierId} subId=${subId}`);
          else console.error(`[rzp-webhook] backstop provisioning FAILED userId=${userId} tier=${tierId} subId=${subId} failedStep=${result.failedStep}`);
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
        const newStatus = eventType === 'subscription.cancelled' ? 'cancelled' : 'completed';

        // Capture the end of the paid cycle so access is downgraded LATER (lazy-
        // expiry), not immediately. Cancelling auto-pay must NOT instantly kill the
        // paid access the user already paid for.
        const cycleEnd    = payload.current_end || payload.ended_at || payload.end_at || payload.charge_at;
        const accessUntil = cycleEnd ? new Date(cycleEnd * 1000).toISOString() : null;

        // Only set access_until if it isn't already set (the cancel route sets it first).
        const update = { status: newStatus, updated_at: new Date().toISOString() };
        if (accessUntil) {
          try {
            const { data: existing } = await supabase.from('subscriptions')
              .select('access_until').eq('razorpay_subscription_id', subId).limit(1);
            if (!(existing && existing[0] && existing[0].access_until)) update.access_until = accessUntil;
          } catch (_) { update.access_until = accessUntil; } // best effort
        }

        let { error: upErr } = await supabase.from('subscriptions')
          .update(update).eq('razorpay_subscription_id', subId);
        if (upErr && update.access_until) {
          // access_until column may not be migrated yet — retry without it.
          console.warn('[rzp-webhook] subscription update warn (retry minimal):', upErr.message);
          await supabase.from('subscriptions')
            .update({ status: newStatus, updated_at: update.updated_at })
            .eq('razorpay_subscription_id', subId);
        }

        // NOTE: profiles.plan is deliberately NOT downgraded here. The user keeps
        // 'monitor' until access_until; lazy-expiry (routes/user/me.js + reconcile)
        // performs the downgrade then. This prevents an immediate cancel from
        // instantly killing paid access.
        console.log(`[rzp-webhook] subscription ${newStatus} subId=${subId} access_until=${update.access_until || '(unchanged)'} — plan downgrade deferred`);
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
