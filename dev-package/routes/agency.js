'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Agency (multi-doctor) plan: signup → checkout → verify → provisioned org.
//
// Deliberately NOT modelled on routes/verify-subscription-payment.js. That file
// creates the account AFTER payment and, when the email already exists, resets
// its password to whatever was typed at checkout — which lets anyone who knows a
// customer's email take over the account by starting a purchase. Nothing here
// copies that shape:
//
//   • The account is created BEFORE payment, by the person who owns the inbox.
//   • An email that already has an account is a 409 telling them to sign in. We
//     never touch an existing account's password. Ever.
//   • checkout and verify both require a verified Bearer token, so every step
//     acts on the user the token proves, never on an email in a request body.
//
// WHAT IS TRUSTED: the auth token, env config, and Razorpay's own API.
// WHAT IS NOT: anything in the request body except the ids needed to look the
// payment up at Razorpay — which are then re-verified against Razorpay itself.
//
// Provisioning is gated on THREE independent facts read from Razorpay after the
// HMAC check, not on the browser's say-so:
//   1. status    — the subscription is actually active/authenticated
//   2. amount    — the plan bills exactly what pricing.js says it should
//   3. currency  — in the currency we quoted
// plus a binding check that the subscription was created for THIS user.
//
// profile_limit is read from lib/pricing.js ORG_PLANS. It is never taken from
// the request — a client cannot ask for a bigger org.
// ─────────────────────────────────────────────────────────────────────────────

require('../lib/env');

const pricing    = require('../lib/pricing');
const payments   = require('../lib/payments');
const planGuard  = require('../lib/payments/plan-guard');
const { getSupabaseClient } = require('../lib/supabase-client');

const AGENCY_PLAN_KEY = 'agency';
const ORG_TYPE        = 'agency';
const BILLING_CURRENCY = 'INR';   // the agency plan is INR-only this phase

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

// Server-resolved price for the agency plan. Never accepts a client amount.
function agencyPrice() {
  const p = pricing.orgPlanPrice(AGENCY_PLAN_KEY, BILLING_CURRENCY);
  if (!p) throw new Error(`agency plan has no ${BILLING_CURRENCY} price configured`);
  return p;
}

function planId() {
  return process.env.RAZORPAY_AGENCY_PLAN_ID || '';
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agency/signup   { email, password, name? }
// Creates the account up front. No payment has happened yet, so the account is
// created on the FREE plan — nothing is granted here.
// ─────────────────────────────────────────────────────────────────────────────
async function signup(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email    = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const name     = String(req.body?.name || '').trim();

  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
  }

  const supabase = getSupabaseClient();
  if (!supabase) return res.status(500).json({ error: 'Auth is not configured' });

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,
  });

  if (createErr || !created?.user) {
    const msg = (createErr?.message || '').toLowerCase();
    if (msg.includes('already')) {
      // An existing account is NOT an opportunity to reset its password. Send
      // them to sign in; their credentials stay exactly as they were.
      console.log(`[agency-signup] email already registered — asking them to sign in (no account touched)`);
      return res.status(409).json({
        error: 'An account with this email already exists. Please sign in, then start the agency plan from your dashboard.',
        code: 'ACCOUNT_EXISTS',
      });
    }
    console.error('[agency-signup] createUser failed:', createErr?.message);
    return res.status(500).json({ error: 'Could not create the account. Please try again.' });
  }

  const userId = created.user.id;
  const { error: profErr } = await supabase.from('profiles').upsert({
    id: userId, email, name: name || null,
    plan: 'free',                       // nothing granted until payment verifies
    updated_at: new Date().toISOString(),
  });
  if (profErr) console.warn(`[agency-signup] profile upsert warn userId=${userId}: ${profErr.message}`);

  console.log(`[agency-signup] account created userId=${userId} plan=free (unpaid)`);
  return res.status(201).json({ ok: true, userId, email });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agency/checkout    (requireAuth)
// Creates the Razorpay subscription for the AUTHENTICATED user. The plan and the
// amount come from env + lib/pricing.js; the request body is not read at all.
// ─────────────────────────────────────────────────────────────────────────────
async function checkout(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const keyId  = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const plan   = planId();

  if (!keyId || !secret) return res.status(500).json({ error: 'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not configured' });
  if (!plan) {
    return res.status(500).json({ error: 'RAZORPAY_AGENCY_PLAN_ID not configured — create the agency plan in the Razorpay dashboard first' });
  }

  const userId = req.user.id;
  const email  = req.user.email || '';
  const price  = agencyPrice();

  console.log(
    `[agency-checkout] userId=${userId} planSuffix=${plan.slice(-4)} ` +
    `keyMode=${planGuard.keyMode()} expected=${price.amount} ${price.currency}`
  );

  // Same guard the monitor checkout uses: prove the plan exists in this key's
  // mode and bills exactly what we quote, BEFORE any subscription exists.
  const check = await planGuard.verifyPlan(plan, price.amount, price.currency, 'agency-checkout');
  if (!check.ok) {
    return res.status(503).json({ error: planGuard.blockedMessage(check.reason), code: check.reason });
  }

  try {
    const sub = await payments.get('razorpay').createSubscription({
      email,
      auditId:          null,
      regionTier:       'IN',
      country:          'IN',
      planId:           plan,
      expectedUnits:    price.amount,
      expectedCurrency: price.currency,
      // Binds the subscription to this user. The notes are written here,
      // server-side, and read back FROM Razorpay at verification — a browser
      // cannot forge them or claim someone else's subscription.
      planKind:         'agency',
      userId,
    });

    console.log(`[agency-checkout] created subscription=${sub.subscriptionId} userId=${userId}`);
    return res.json({
      subscriptionId: sub.subscriptionId,
      shortUrl:       sub.shortUrl,
      keyId,
      amount:         price.amount,
      currency:       price.currency,
      display:        price.display,
      profileLimit:   price.profileLimit,
    });
  } catch (err) {
    console.error('[agency-checkout] error:', err.message);
    return res.status(500).json({ error: 'Could not start the agency subscription. Please try again.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agency/verify   { subscriptionId, paymentId, signature }   (requireAuth)
// Verifies the payment three ways against Razorpay, then provisions the org.
// ─────────────────────────────────────────────────────────────────────────────
async function verify(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const subscriptionId = String(req.body?.subscriptionId || '').trim();
  const paymentId      = String(req.body?.paymentId || '').trim();
  const signature      = String(req.body?.signature || '').trim();
  const userId         = req.user.id;

  if (!subscriptionId || !paymentId || !signature) {
    return res.status(400).json({ error: 'subscriptionId, paymentId and signature are required' });
  }

  const rz = payments.get('razorpay');

  // ── 0. HMAC over `${paymentId}|${subscriptionId}` ──────────────────────────
  const sig = await rz.verifySubscription({ subscriptionId, paymentId, signature });
  if (!sig.ok) {
    if (sig.reason === 'no_secret') return res.status(500).json({ error: 'RAZORPAY_KEY_SECRET not configured' });
    console.error(`[agency-verify] signature invalid subId=${subscriptionId} userId=${userId}`);
    return res.status(400).json({ error: 'Payment signature invalid — possible tampered request' });
  }

  // ── Read the truth from Razorpay. Nothing below trusts the request body. ───
  let sub, plan;
  try {
    sub  = await rz.fetchSubscription(subscriptionId);
    plan = await rz.fetchPlan(sub.plan_id);
  } catch (e) {
    console.error(`[agency-verify] could not read subscription/plan from Razorpay: ${(e.error && e.error.description) || e.message}`);
    return res.status(502).json({ error: 'Could not confirm the payment with Razorpay. Please refresh in a moment.' });
  }

  const expected = agencyPrice();

  // ── Binding: this subscription must be the one WE created for THIS user ────
  const notedUser = sub.notes && sub.notes.userId;
  if (notedUser && notedUser !== userId) {
    console.error(`[agency-verify] SUBSCRIPTION/USER MISMATCH subId=${subscriptionId} notes.userId=${notedUser} token.userId=${userId}`);
    return res.status(403).json({ error: 'This subscription belongs to a different account.' });
  }
  if (sub.plan_id !== planId()) {
    console.error(`[agency-verify] WRONG PLAN subId=${subscriptionId} plan=${sub.plan_id} expected=${planId()}`);
    return res.status(400).json({ error: 'That payment is not for the agency plan.' });
  }

  // ── Three-factor check: status + amount + currency ─────────────────────────
  const ACCEPTED = ['active', 'authenticated', 'charged'];
  const factors = {
    status:   ACCEPTED.includes(sub.status),
    amount:   plan.item && plan.item.amount === expected.amount,
    currency: plan.item && plan.item.currency === expected.currency,
  };
  console.log(
    `[agency-verify] subId=${subscriptionId} userId=${userId} status=${sub.status} ` +
    `planAmount=${plan.item && plan.item.amount} planCurrency=${plan.item && plan.item.currency} ` +
    `expected=${expected.amount} ${expected.currency} factors=${JSON.stringify(factors)}`
  );
  if (!factors.status || !factors.amount || !factors.currency) {
    const failed = Object.keys(factors).filter(k => !factors[k]);
    console.error(`[agency-verify] REJECTED subId=${subscriptionId} failed=[${failed.join(',')}]`);
    return res.status(400).json({
      error: factors.status
        ? 'The subscription does not match the agency plan price. Nothing has been provisioned — please contact support.'
        : 'Your subscription is not active yet. If you were charged, refresh in a minute or contact support.',
      code: 'VERIFICATION_FAILED',
      failed,
    });
  }

  // ── Provision. Every value below is server-derived. ────────────────────────
  const result = await provisionAgencyOrg({
    userId,
    email: req.user.email || '',
    subscriptionId,
    razorpayPlanId: sub.plan_id,
    profileLimit: expected.profileLimit,   // from ORG_PLANS, never the request
  });

  if (!result.ok) {
    // The payment is real. Never pretend this succeeded, and never roll back a
    // step that DID land — a rollback would leave a paying customer with less
    // than they have now, and every step here is safe to re-run.
    return res.status(500).json({
      ok: false,
      error: 'Payment confirmed, but we could not finish setting up your agency workspace. ' +
             'Your subscription is active — press Retry setup, or contact support with this id.',
      code: 'PROVISIONING_FAILED',
      failedStep: result.failedStep,
      subscriptionId,
      completedSteps: result.completed,
      retryable: true,
    });
  }

  return res.json({
    ok: true,
    orgId: result.orgId,
    plan: 'agency',
    profileLimit: expected.profileLimit,
    steps: result.completed,
    redirect: '/dashboard',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// provisionAgencyOrg — the only writer of agency state.
//
// IDEMPOTENT, STEP BY STEP. Every step is safe to run again, so a failed run can
// simply be retried and will finish whatever is still missing instead of
// duplicating what already landed. A step that succeeded is NEVER rolled back:
// the payment is real, and partial provisioning is strictly better for the
// customer than none.
//
// ORDER MATTERS. profiles.plan used to run FIRST, and when a DB constraint
// rejected 'agency' it returned early — so the org, the membership and the
// subscription row were never even attempted, five times in a row. The steps are
// now ordered so the ones that have never failed run first and the riskiest runs
// LAST, which means a failure at the end still leaves a usable workspace behind.
//
//   1. organization    (create, or adopt+upgrade the one this user owns)
//   2. org_members     (upsert owner — the PK makes a repeat a no-op)
//   3. subscriptions   (insert; a duplicate is success, not an error)
//   4. profiles.plan   (LAST — the gate every entitlement reads, and the write
//                       that actually failed in production)
// ─────────────────────────────────────────────────────────────────────────────

// Supabase surfaces the useful part of a Postgres failure in code/details/hint,
// not in message. Logging only message is what hid a plain check-constraint
// violation through five customer attempts.
function logDbError(step, ctx, err) {
  console.error(
    `[agency-provision] STEP FAILED step=${step} ${ctx} ` +
    `code=${(err && err.code) || '?'} message=${(err && err.message) || '?'} ` +
    `details=${(err && err.details) || '-'} hint=${(err && err.hint) || '-'}`
  );
}

async function provisionAgencyOrg({ userId, email, subscriptionId, razorpayPlanId, profileLimit }) {
  const supabase = getSupabaseClient();
  const ctx = `userId=${userId} subId=${subscriptionId}`;
  const completed = [];
  const fail = (step, err) => {
    logDbError(step, ctx, err);
    console.error(`[agency-provision] ABORTED at ${step}; completed so far: [${completed.join(', ')}]`);
    return { ok: false, failedStep: step, completed, error: err };
  };

  if (!supabase) return fail('db_client', { message: 'Supabase client unavailable' });

  // ── 1. organization ───────────────────────────────────────────────────────
  let orgId = null;
  try {
    const { data: mems, error: memErr } = await supabase
      .from('org_members').select('org_id, role').eq('user_id', userId);
    if (memErr) return fail('organization:lookup', memErr);

    const owned = (mems || []).find(m => m.role === 'owner');
    if (owned) {
      // Re-run, or an upgrade from a solo org: adopt it rather than making a second.
      orgId = owned.org_id;
      const { error } = await supabase.from('organizations')
        .update({ type: ORG_TYPE, plan: 'agency', profile_limit: profileLimit })
        .eq('id', orgId);
      if (error) return fail('organization:upgrade', error);
      console.log(`[agency-provision] ✓ organization upgraded orgId=${orgId} limit=${profileLimit} ${ctx}`);
    } else {
      const { data: prof } = await supabase.from('profiles').select('email, name').eq('id', userId).maybeSingle();
      const orgName = (prof?.name || prof?.email || email || 'Agency').trim();
      const { data: org, error } = await supabase.from('organizations')
        .insert({ name: orgName, type: ORG_TYPE, plan: 'agency', profile_limit: profileLimit })
        .select('id').single();
      if (error || !org) return fail('organization:create', error || { message: 'insert returned no row' });
      orgId = org.id;
      console.log(`[agency-provision] ✓ organization created orgId=${orgId} name="${orgName}" limit=${profileLimit} ${ctx}`);
    }
    completed.push('organization');
  } catch (e) { return fail('organization', e); }

  // ── 2. org_members ────────────────────────────────────────────────────────
  try {
    const { error } = await supabase.from('org_members')
      .upsert({ org_id: orgId, user_id: userId, role: 'owner' }, { onConflict: 'org_id,user_id' });
    if (error) return fail('org_members', error);
    completed.push('org_members');
    console.log(`[agency-provision] ✓ owner membership orgId=${orgId} ${ctx}`);
  } catch (e) { return fail('org_members', e); }

  // ── 3. subscriptions ──────────────────────────────────────────────────────
  // razorpay_subscription_id is UNIQUE, so a retry collides — which means the
  // row is already there. That is success.
  try {
    const { error } = await supabase.from('subscriptions').insert({
      user_id: userId, plan: 'agency', status: 'active',
      razorpay_subscription_id: subscriptionId,
      razorpay_plan_id: razorpayPlanId,
      start_date: new Date().toISOString(),
    });
    if (error && !/duplicate|unique|23505/i.test(`${error.code} ${error.message}`)) {
      return fail('subscriptions', error);
    }
    completed.push('subscriptions');
    console.log(`[agency-provision] ✓ subscription row ${error ? '(already present)' : 'inserted'} ${ctx}`);
  } catch (e) { return fail('subscriptions', e); }

  // ── 4. profiles.plan — LAST, because this is the one that broke ───────────
  try {
    const { data, error } = await supabase.from('profiles')
      .update({ plan: 'agency', updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id, plan');
    if (error) return fail('profiles_plan', error);
    if (!data || !data.length) {
      return fail('profiles_plan', { message: `no profiles row matched id=${userId}` });
    }
    completed.push('profiles_plan');
    console.log(`[agency-provision] ✓ profiles.plan=agency ${ctx}`);
  } catch (e) { return fail('profiles_plan', e); }

  console.log(`[agency-provision] PROVISIONED orgId=${orgId} limit=${profileLimit} steps=[${completed.join(', ')}] ${ctx}`);
  return { ok: true, orgId, completed };
}

// provisionAgencyOrg is exported so scripts/reconcile-agency.js can finish a
// stuck signup with the EXACT same code path the live route uses.
module.exports = { signup, checkout, verify, provisionAgencyOrg };
