'use strict';

require('../../lib/env');
const { getSupabaseClient, getSupabaseAuthClient } = require('../../lib/supabase-client');

/** A network/stall failure (NOT a wrong password). These must not be reported as bad creds. */
function isTransientAuthError(err) {
  const m = (err?.message || '').toLowerCase();
  return /fetch failed|timeout|abort|network|socket|econn|enotfound|etimedout|503|429|temporarily/.test(m);
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let { email, password } = req.body || {};
  if (!email)    return res.status(400).json({ error: 'email is required' });
  if (!password) return res.status(400).json({ error: 'password is required' });
  email = String(email).trim().toLowerCase(); // GoTrue is case-insensitive; normalise anyway

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return res.status(500).json({ success: false, error: 'Auth not configured' });
  }

  const authClient = getSupabaseAuthClient() || getSupabaseClient();
  const t0 = Date.now();

  // Sign in with one retry on a transient stall.
  let data = null, error = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await authClient.auth.signInWithPassword({ email, password }).catch(e => ({ data: null, error: e }));
    data = r.data; error = r.error;
    if (data?.session) break;
    if (error && isTransientAuthError(error) && attempt < 2) {
      console.warn(`[auth/login] transient on attempt ${attempt} email=${email}: ${error.message}`);
      continue;
    }
    break;
  }

  if (!data?.session) {
    // CRUCIAL: a timeout/network failure is NOT a credential failure. Returning
    // "invalid credentials" here was making valid logins look wrong during the
    // Supabase stalls. Surface a 503 so the user retries instead of doubting creds.
    if (error && isTransientAuthError(error)) {
      console.error(`[auth/login] SERVICE error email=${email} (${Date.now() - t0}ms): ${error.message}`);
      return res.status(503).json({ success: false, error: 'Login service is busy right now — please try again in a moment.', retryable: true });
    }
    console.log(`[auth/login] invalid creds email=${email} (${Date.now() - t0}ms) reason=${error?.message || 'no session'}`);
    return res.status(401).json({ success: false, error: 'Invalid email or password' });
  }

  // Fetch plan from profiles (service client — bypasses RLS). Non-fatal: default 'free'.
  let plan = 'free', name = '';
  try {
    const svc = getSupabaseClient();
    const { data: profile } = await svc
      .from('profiles').select('plan, name').eq('id', data.user.id).single();
    if (profile) { plan = profile.plan || 'free'; name = profile.name || ''; }
  } catch (e) {
    console.warn(`[auth/login] profile fetch warn email=${email}: ${e.message}`);
  }

  console.log(`[auth/login] success email=${email} userId=${data.user.id} plan=${plan} (${Date.now() - t0}ms)`);

  return res.json({
    success:      true,
    accessToken:  data.session.access_token,
    refreshToken: data.session.refresh_token,
    userId:       data.user.id,
    plan,
    name,
  });
}

module.exports = handler;
