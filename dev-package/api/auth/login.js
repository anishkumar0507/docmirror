'use strict';

require('../../lib/env');

const { getSupabaseClient } = require('../../lib/supabase-client');

function db() {
  return getSupabaseClient();
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.json({ success: false, error: 'Auth not configured' });
  }

  try {
    const supabase = db();
    const { data: reports } = await supabase
      .from('paid_reports')
      .select('id')
      .eq('email', email)
      .eq('status', 'delivered')
      .limit(1);

    if (reports?.length) return res.json({ success: true });

    const { data: monitors } = await supabase
      .from('subscribers')
      .select('id')
      .eq('email', email)
      .eq('status', 'active')
      .limit(1);

    if (monitors?.length) return res.json({ success: true });

    return res.status(401).json({ success: false, error: 'No active subscription found for this email' });
  } catch (err) {
    console.error('[auth/login]', err.message);
    return res.status(500).json({ success: false, error: 'Login failed' });
  }
}

module.exports = handler;
