'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   GET /api/admin/me

   The gate every admin page calls on load. By the time this handler runs,
   requireAuth has validated the session and requireAdmin has confirmed
   profiles.role = 'admin' against the database, so reaching here at all is
   the answer. The three outcomes the client branches on:

     401 → no/expired session        → redirect to /admin/login
     403 → signed in, not an admin   → show "no admin access", stay put
     200 → admin                     → render the page

   Deliberately returns identity only. No tokens, no keys, no role-granting
   data of any kind.
   ────────────────────────────────────────────────────────────────────────── */

require('../../lib/env');

function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Defensive: this route is only ever mounted behind requireAuth + requireAdmin,
  // but never answer 200 on an assumption about middleware order.
  if (!req.admin || !req.admin.id) {
    return res.status(403).json({ error: 'Forbidden — admin access required' });
  }

  return res.json({
    id:    req.admin.id,
    email: req.admin.email,
    name:  req.admin.name || '',
    role:  'admin',
  });
}

module.exports = handler;
