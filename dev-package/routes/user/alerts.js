'use strict';

require('../../lib/env');
const { getSupabaseClient } = require('../../lib/supabase-client');
const { requireAuth } = require('../../lib/auth-middleware');

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  await new Promise((resolve, reject) =>
    requireAuth(req, res, err => err ? reject(err) : resolve())
  ).catch(() => {});
  if (res.headersSent) return;

  const supabase = getSupabaseClient();
  const { data: rows, error } = await supabase
    .from('competitor_alerts')
    .select('id, alert_type, message, read, created_at')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[user/alerts] query error:', error.message);
    return res.status(500).json({ error: 'Could not load alerts' });
  }

  return res.json(rows || []);
}

module.exports = handler;
