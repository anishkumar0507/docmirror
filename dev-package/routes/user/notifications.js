'use strict';

require('../../lib/env');
const { getSupabaseClient } = require('../../lib/supabase-client');
const { requireAuth }       = require('../../lib/auth-middleware');

// GET  /api/notifications        → list latest notifications
// POST /api/notifications        → { id } mark one read, or { all:true } mark all read
async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  await new Promise((resolve, reject) =>
    requireAuth(req, res, err => err ? reject(err) : resolve())
  ).catch(() => {});
  if (res.headersSent) return;

  const supabase = getSupabaseClient();
  const userId   = req.user.id;
  if (!supabase) return res.json({ ok: true, notifications: [] });

  try {
    if (req.method === 'POST') {
      const body = req.body || {};
      let q = supabase.from('notifications').update({ read: true }).eq('user_id', userId);
      if (body.all) { /* mark all */ }
      else if (body.id) q = q.eq('id', body.id);
      else return res.status(400).json({ error: 'Provide { id } or { all:true }' });
      const { error } = await q;
      if (error) throw error;
      return res.json({ ok: true });
    }

    const { data, error } = await supabase
      .from('notifications')
      .select('id, type, severity, title, message, meta, read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return res.json({ ok: true, notifications: data || [], unread: (data || []).filter(n => !n.read).length });
  } catch (err) {
    console.error('[notifications] error:', err.message);
    return res.status(500).json({ error: 'Could not load notifications' });
  }
}

module.exports = handler;
