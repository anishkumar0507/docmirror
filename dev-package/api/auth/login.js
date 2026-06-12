'use strict';

require('../../lib/env');
const { getSupabaseClient } = require('../../lib/supabase-client');

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};
  if (!email)    return res.status(400).json({ error: 'email is required' });
  if (!password) return res.status(400).json({ error: 'password is required' });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return res.status(500).json({ success: false, error: 'Auth not configured' });
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data?.session) {
      console.log(`[auth/login] failed email=${email} reason=${error?.message}`);
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    // Fetch plan from profiles table for the dashboard to use
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan, name')
      .eq('id', data.user.id)
      .single();

    console.log(`[auth/login] success email=${email} userId=${data.user.id} plan=${profile?.plan || 'free'}`);

    return res.json({
      success:      true,
      accessToken:  data.session.access_token,
      refreshToken: data.session.refresh_token,
      userId:       data.user.id,
      plan:         profile?.plan || 'free',
      name:         profile?.name || '',
    });

  } catch (err) {
    console.error('[auth/login] error:', err.message);
    return res.status(500).json({ success: false, error: 'Login failed' });
  }
}

module.exports = handler;
