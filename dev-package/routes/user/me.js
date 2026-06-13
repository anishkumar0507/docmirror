'use strict';

require('../../lib/env');
const { getSupabaseClient, withSupabaseRetry } = require('../../lib/supabase-client');
const { requireAuth } = require('../../lib/auth-middleware');

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // requireAuth populates req.user
  await new Promise((resolve, reject) =>
    requireAuth(req, res, err => err ? reject(err) : resolve())
  ).catch(() => {}); // requireAuth already sent response on failure
  if (res.headersSent) return;

  const supabase = getSupabaseClient();
  const t0 = Date.now();
  const { data: profile, error } = await withSupabaseRetry(
    () => supabase.from('profiles').select('id, email, name, plan, created_at').eq('id', req.user.id).single(),
    { label: 'user-me-profile', attempts: 3 }
  );
  console.log(`[user/me] profile fetch ${Date.now() - t0}ms userId=${req.user.id} plan=${profile?.plan || '(none)'}${error ? ' err=' + error.message : ''}`);

  if (error || !profile) {
    // Profile row may not exist yet (created during signup but could fail)
    // Lazily create it from auth user data
    const { data: inserted, error: insertErr } = await supabase
      .from('profiles')
      .insert({ id: req.user.id, email: req.user.email, plan: 'free' })
      .select('id, email, name, plan, created_at')
      .single();

    if (insertErr) {
      console.error('[user/me] profile upsert failed:', insertErr.message);
      return res.status(500).json({ error: 'Could not load profile' });
    }
    return res.json(await maybeUpgradeAuditPlan(supabase, inserted, req.user));
  }

  return res.json(await maybeUpgradeAuditPlan(supabase, profile, req.user));
}

// A user who paid for a $19 audit (often anonymously, then signed up later) should be
// on the 'audit' plan so login routes them to their audit history — not pricing.
// Upgrades free → audit when any paid_reports row exists for their id or email.
async function maybeUpgradeAuditPlan(supabase, profile, user) {
  if (!profile || profile.plan !== 'free') return profile;
  try {
    const email = (user.email || '').toLowerCase();
    const orFilter = email ? `user_id.eq.${user.id},email.ilike.${email}` : `user_id.eq.${user.id}`;
    const { data: paid } = await supabase
      .from('paid_reports').select('audit_id').or(orFilter).limit(1);
    if (paid && paid.length) {
      await supabase.from('profiles')
        .update({ plan: 'audit', updated_at: new Date().toISOString() })
        .eq('id', user.id).eq('plan', 'free');
      return { ...profile, plan: 'audit' };
    }
  } catch (e) {
    console.warn('[user/me] plan upgrade check warn:', e.message);
  }
  return profile;
}

module.exports = handler;
