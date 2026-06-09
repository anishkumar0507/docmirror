'use strict';

require('../lib/env');

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // Sprint 3: run weekly monitor audits for active subscribers
  console.log('[weekly-check] cron triggered — monitor audits not yet implemented');
  return res.json({ ok: true, message: 'Weekly monitor check scheduled (implementation pending)' });
}

module.exports = handler;
