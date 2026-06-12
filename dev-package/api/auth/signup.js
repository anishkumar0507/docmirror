'use strict';

require('../../lib/env');
const { getSupabaseClient } = require('../../lib/supabase-client');

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Standalone sign-up is DISABLED — accounts are created only at payment
  // (the $49 Monitor checkout). This prevents accounts being created without payment.
  return res.status(403).json({
    error: 'Accounts are created when you subscribe. Choose a plan to get started.',
    code:  'SIGNUP_VIA_CHECKOUT_ONLY',
  });

  /* eslint-disable no-unreachable */
  const { email, password, name } = req.body || {};
  if (!email)    return res.status(400).json({ error: 'email is required' });
  if (!password) return res.status(400).json({ error: 'password is required' });
  if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });

  const supabase = getSupabaseClient();

  try {
    // Create auth user (email_confirm: true skips email verification)
    const { data: { user }, error: authErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authErr) {
      if (authErr.message?.toLowerCase().includes('already registered')) {
        return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
      }
      console.error('[signup] auth.admin.createUser error:', authErr.message);
      return res.status(400).json({ error: authErr.message });
    }

    // Create profile row linked to auth user
    const { error: profileErr } = await supabase.from('profiles').insert({
      id:    user.id,
      email: user.email,
      name:  (name || '').trim() || null,
      plan:  'free',
    });

    if (profileErr) {
      console.error('[signup] profiles insert error:', profileErr.message);
      // Auth user was created — don't fail hard, profile can be lazily created
    }

    console.log(`[signup] new user id=${user.id} email=${user.email}`);
    return res.status(201).json({ userId: user.id, email: user.email });

  } catch (err) {
    console.error('[signup] unexpected error:', err.message);
    return res.status(500).json({ error: 'Signup failed: ' + err.message });
  }
}

module.exports = handler;
