'use strict';

const { getSupabaseClient } = require('./supabase-client');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — missing Bearer token' });
  }
  const token = header.slice(7);
  try {
    const supabase = getSupabaseClient();
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized — invalid or expired token' });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error('[auth] getUser error:', err.message);
    return res.status(500).json({ error: 'Auth check failed' });
  }
}

// Non-blocking variant: attaches req.user if token is valid, but never blocks the request.
// Use on routes that work for both guests and logged-in users (e.g., /api/checkout).
async function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  const token = header.slice(7);
  try {
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser(token);
    req.user = user || null;
  } catch {
    req.user = null;
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
