'use strict';

const crypto = require('crypto');
require('../lib/env');

const auditCache   = require('../lib/audit-cache');
const reportsStore = require('../lib/reports-store');
const { getSupabaseClient, formatFetchError } = require('../lib/supabase-client');

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
  console.log(`[verify-sub] payment verified ✓ subId=${subscriptionId} email=${cleanEmail}`);

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
    await supabase.from('profiles').upsert({
      id: userId, email: cleanEmail,
      name: (name || '').trim() || null,
      plan: 'monitor', updated_at: new Date().toISOString(),
    });
    console.log(`[verify-sub] account CREATED userId=${userId} email=${cleanEmail}`);
  } else if (createErr && (createErr.message || '').toLowerCase().includes('already')) {
    // Email already has an account — upgrade it to monitor.
    accountExisted = true;
    const { data: prof } = await supabase
      .from('profiles').select('id').ilike('email', cleanEmail).limit(1).maybeSingle();
    userId = prof?.id || null;
    if (userId) {
      await supabase.from('profiles')
        .update({ plan: 'monitor', updated_at: new Date().toISOString() })
        .eq('id', userId);
      console.log(`[verify-sub] existing account upgraded to monitor userId=${userId}`);
    } else {
      console.warn(`[verify-sub] existing auth user but no profile row for ${cleanEmail}`);
    }
  } else {
    console.error('[verify-sub] account creation failed:', createErr?.message);
    return res.status(500).json({ error: 'Payment succeeded but account creation failed. Contact support — your subscription is active.' });
  }

  // ── 3. Record the subscription row (now we have a user_id) ─────────────────
  if (userId) {
    await supabase.from('subscriptions').insert({
      user_id: userId, plan: 'monitor', status: 'active',
      razorpay_subscription_id: subscriptionId,
      razorpay_plan_id: process.env.RAZORPAY_MONITOR_PLAN_ID || null,
      start_date: new Date().toISOString(),
    }).then(({ error }) => { if (error) console.warn('[verify-sub] subscription insert warn:', error.message); });
  }

  // ── 4. Establish a session so the dashboard opens immediately ─────────────
  let session = null;
  try {
    const { data: signIn } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
    session = signIn?.session || null;
  } catch (e) {
    console.warn('[verify-sub] sign-in after payment warn:', e.message);
  }

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

  // ── 6. Respond immediately (session lets the dashboard load right away) ────
  res.json({
    ok:           true,
    accountCreated: !accountExisted,
    needsLogin:   !session,           // existing account whose password didn't match
    accessToken:  session?.access_token  || null,
    refreshToken: session?.refresh_token || null,
    userId,
    email:        cleanEmail,
    message:      session
      ? 'Subscription activated. Your dashboard is ready — your first report PDF is generating.'
      : 'Subscription activated. This email already has an account — please log in to open your dashboard.',
  });

  // ── 7. Background: generate PDF + email (fire-and-forget) ─────────────────
  if (auditId && auditData) {
    setImmediate(async () => {
      try {
        const { generateReport } = require('./report');
        const result = await generateReport({ auditId, email: cleanEmail, userId });
        if (result.pdfUrl) {
          await supabase.from('reports').update({ pdf_url: result.pdfUrl }).eq('audit_id', auditId);
        }
        console.log(`[verify-sub bg] report generated auditId=${auditId} emailSent=${result.emailSent}`);
      } catch (bgErr) {
        console.error('[verify-sub bg] PDF generation error (non-fatal):', formatFetchError(bgErr));
      }
    });
  }
}

module.exports = handler;
