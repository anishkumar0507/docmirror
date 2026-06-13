'use strict';

const crypto = require('crypto');
require('../lib/env');

const auditCache   = require('../lib/audit-cache');
const reportsStore = require('../lib/reports-store');
const { afterResponse } = require('../lib/after-response');
const { getSupabaseClient, getSupabaseAuthClient } = require('../lib/supabase-client');

/** Sign in with one retry — a transient Supabase stall must not look like a bad password. */
async function signInWithRetry(cleanEmail, password) {
  const authClient = getSupabaseAuthClient() || getSupabaseClient();
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { data, error } = await authClient.auth.signInWithPassword({ email: cleanEmail, password });
      if (data?.session) return { session: data.session, error: null };
      if (error) {
        const transient = /fetch failed|timeout|abort|network|socket|503|429/i.test(error.message || '');
        if (transient && attempt < 2) { console.warn(`[verify-sub] sign-in transient (attempt ${attempt}): ${error.message}`); continue; }
        return { session: null, error };
      }
    } catch (e) {
      if (attempt < 2) { console.warn(`[verify-sub] sign-in threw (attempt ${attempt}): ${e.message}`); continue; }
      return { session: null, error: e };
    }
  }
  return { session: null, error: new Error('sign-in failed') };
}

// $49 Monitor — payment first, THEN account.
// The account (auth user + profile + subscription) is created here, only after the
// Razorpay signature is verified. Nothing is created before payment.
async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    subscriptionId, paymentId, signature,
    auditId: clientAuditId, email, password, name,
  } = req.body || {};

  if (!subscriptionId || !paymentId || !signature || !email) {
    return res.status(400).json({ error: 'subscriptionId, paymentId, signature, email all required' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'A password of at least 8 characters is required to create your account' });
  }

  // ── 1. Verify Razorpay subscription payment signature ─────────────────────
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) return res.status(500).json({ error: 'RAZORPAY_KEY_SECRET not configured' });

  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${paymentId}|${subscriptionId}`)
    .digest('hex');

  if (expected !== signature) {
    console.error(`[verify-sub] signature MISMATCH subId=${subscriptionId} paymentId=${paymentId}`);
    return res.status(400).json({ error: 'Payment signature invalid — possible tampered request' });
  }

  const supabase = getSupabaseClient();
  if (!supabase) return res.status(500).json({ error: 'Auth not configured' });

  const cleanEmail = email.trim().toLowerCase();
  console.log(`[verify-sub] ① payment verified ✓ subId=${subscriptionId} email=${cleanEmail}`);

  // ── 2. Create the account (or upgrade an existing one) — AFTER payment ─────
  let userId = null;
  let accountExisted = false;

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: cleanEmail,
    password,
    email_confirm: true,
  });

  if (created && created.user) {
    userId = created.user.id;
    const { error: profErr } = await supabase.from('profiles').upsert({
      id: userId, email: cleanEmail,
      name: (name || '').trim() || null,
      plan: 'monitor', updated_at: new Date().toISOString(),
    });
    if (profErr) console.warn(`[verify-sub] profile upsert warn userId=${userId}: ${profErr.message}`);
    console.log(`[verify-sub] ② account CREATED + profile(plan=monitor) userId=${userId} email=${cleanEmail}`);
  } else if (createErr && (createErr.message || '').toLowerCase().includes('already')) {
    // Email already has an account — upgrade it to monitor.
    accountExisted = true;
    // Resolve the auth user id (prefer auth.users — the profile row may be missing).
    let prof = null;
    try {
      const r = await supabase.from('profiles').select('id').ilike('email', cleanEmail).limit(1).maybeSingle();
      prof = r.data;
    } catch (_) {}
    if (!prof?.id) {
      // No profile row — find the auth user directly and create the profile.
      try {
        const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
        const u = (list?.users || []).find(x => (x.email || '').toLowerCase() === cleanEmail);
        if (u) prof = { id: u.id };
      } catch (e) { console.warn('[verify-sub] listUsers lookup warn:', e.message); }
    }
    userId = prof?.id || null;
    if (userId) {
      // Reset the password to what they just typed so the post-payment sign-in
      // (and all future logins) always work — the #1 cause of "Invalid login
      // credentials" for paying users was a stale/forgotten password on re-purchase.
      try {
        await supabase.auth.admin.updateUserById(userId, { password, email_confirm: true });
        console.log(`[verify-sub] existing account — password reset to checkout password userId=${userId}`);
      } catch (e) {
        console.warn(`[verify-sub] password reset warn userId=${userId}: ${e.message}`);
      }
      await supabase.from('profiles').upsert({
        id: userId, email: cleanEmail, plan: 'monitor', updated_at: new Date().toISOString(),
      });
      console.log(`[verify-sub] ② existing account upgraded to monitor userId=${userId}`);
    } else {
      console.warn(`[verify-sub] existing auth user but could not resolve id for ${cleanEmail}`);
    }
  } else {
    console.error('[verify-sub] account creation failed:', createErr?.message);
    return res.status(500).json({ error: 'Payment succeeded but account creation failed. Contact support — your subscription is active.' });
  }

  // ── 3. Record the subscription row (now we have a user_id) ─────────────────
  if (userId) {
    const { error: subErr } = await supabase.from('subscriptions').insert({
      user_id: userId, plan: 'monitor', status: 'active',
      razorpay_subscription_id: subscriptionId,
      razorpay_plan_id: process.env.RAZORPAY_MONITOR_PLAN_ID || null,
      start_date: new Date().toISOString(),
    });
    if (subErr) console.warn('[verify-sub] subscription insert warn:', subErr.message);
    else console.log(`[verify-sub] ③ subscription ACTIVATED userId=${userId} sub=${subscriptionId}`);
  }

  // ── 4. Establish a session so the dashboard opens immediately ─────────────
  // Uses the dedicated anon auth client (not the service client) and retries once
  // so a transient Supabase stall never forces the user to the login page.
  const { session, error: signInErr } = await signInWithRetry(cleanEmail, password);
  if (session) console.log(`[verify-sub] ④ session CREATED userId=${userId} (dashboard will open logged in)`);
  else console.warn(`[verify-sub] ④ session NOT created userId=${userId} reason=${signInErr?.message || 'unknown'} → needsLogin`);

  // ── 5. Save the first report from cached audit data ───────────────────────
  let auditId = clientAuditId ? auditCache.normalizeAuditId(clientAuditId) : null;
  if (auditId && !auditCache.isValidAuditId(auditId)) auditId = null;

  let auditData = null;
  if (auditId && userId) {
    const cacheResult = await auditCache.getDetailed(auditId);
    if (cacheResult.hit && cacheResult.data) {
      auditData = cacheResult.data;
      const reportRow = reportsStore.reportFromAuditData(auditId, auditData);
      reportRow.user_id = userId;
      const upRes = await reportsStore.upsertReport(supabase, reportRow);
      if (!upRes.ok) console.warn('[verify-sub] reports upsert warn:', upRes.error?.message || upRes.reason);
      else console.log(`[verify-sub] report row ${upRes.action} auditId=${auditId} userId=${userId}`);
    } else {
      console.warn('[verify-sub] audit_cache MISS — first report will be created on weekly run');
    }
  }

  // ── 6. Run the report pipeline in the background of this response ──────────
  // waitUntil keeps the invocation alive until insights → pdf → storage → email
  // finish — no fragile self-call chain. Reconcile is the backstop.
  if (auditId && auditData) {
    const { runReportPipeline } = require('./report');
    afterResponse(() => runReportPipeline({ auditId, email: cleanEmail, userId }), `monitor-report:${auditId}`);
  }

  // ── 7. Respond immediately (session lets the dashboard load right away) ────
  const redirectTarget = session ? '/dashboard.html' : '/pages/auth.html?tab=login';
  console.log(`[verify-sub] ⑤ responding ok=true needsLogin=${!session} redirectTarget=${redirectTarget} userId=${userId}`);
  return res.json({
    ok:           true,
    accountCreated: !accountExisted,
    needsLogin:   !session,           // existing account whose password didn't match
    accessToken:  session?.access_token  || null,
    refreshToken: session?.refresh_token || null,
    userId,
    email:        cleanEmail,
    plan:         'monitor',
    redirectTarget,
    generating:   true,
    message:      session
      ? 'Subscription activated. Your dashboard is ready — your report is generating now.'
      : 'Subscription activated. This email already has an account — please log in to open your dashboard.',
  });
}

module.exports = handler;
