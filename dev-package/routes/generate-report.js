'use strict';

require('../lib/env');

const { jobToken } = require('../lib/report-trigger');
const { formatFetchError } = require('../lib/supabase-client');

// Background worker — runs the full report pipeline (parallel Claude prompts →
// persist insights + report row → render PDF → upload → email) as its OWN Vercel
// invocation, with its own 60s budget, so the payment request can return instantly.
// Triggered by lib/report-trigger.js; protected by an HMAC token.
async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { auditId, email, userId, token } = req.body || {};
  if (!auditId || !email || !token) {
    return res.status(400).json({ error: 'auditId, email, token are required' });
  }
  if (token !== jobToken(auditId, email)) {
    console.warn(`[generate-report] rejected — bad token auditId=${auditId}`);
    return res.status(403).json({ error: 'Invalid job token' });
  }

  console.log(`[generate-report] ▶ worker start auditId=${auditId} email=${email}`);

  try {
    const { generateReport } = require('./report');
    // generateReport is itself deduplicated (runOncePerUser), so a duplicate trigger
    // joins the in-flight job instead of generating twice.
    const result = await generateReport({ auditId, email, userId: userId || null });
    console.log(`[generate-report] ✓ worker done auditId=${auditId} emailSent=${result.emailSent} pdf=${result.pdfUrl ? 'yes' : 'no'}`);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[generate-report] worker FAILED:', formatFetchError(err));
    return res.status(500).json({ ok: false, error: err.message, code: err.code || 'GENERATION_FAILED' });
  }
}

module.exports = handler;
