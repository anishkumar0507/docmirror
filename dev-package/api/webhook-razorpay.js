'use strict';

require('../lib/env');

const crypto  = require('crypto');
const { getSupabaseClient } = require('../lib/supabase-client');

function verifySignature(rawBody, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return expected === signature;
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
