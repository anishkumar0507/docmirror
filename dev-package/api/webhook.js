'use strict';

require('../lib/env');

const Stripe = require('stripe');

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sig       = req.headers['stripe-signature'];
  const secret    = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (!stripeKey || !secret) {
    console.error('[webhook] STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET not set');
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  const stripe = new Stripe(stripeKey);
  let event;

  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.error('[webhook] signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature invalid' });
  }

  console.log(`[webhook] event: ${event.type}`);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const auditId = session.metadata?.auditId || session.client_reference_id;
    const email   = session.metadata?.email   || session.customer_email;

    if (!auditId || !email) {
      console.error('[webhook] missing auditId or email in session metadata');
      return res.json({ received: true });
    }

    console.log(`[webhook] payment complete — auditId: ${auditId}  email: ${email}`);

    res.json({ received: true });

    const { generateReport } = require('./report');
    generateReport({ auditId, email }).catch(err => {
      console.error('[webhook] generateReport failed:', err.message);
    });
    return;
  }

  return res.json({ received: true });
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
