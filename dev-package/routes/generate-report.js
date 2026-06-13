'use strict';

require('../lib/env');

const { jobToken } = require('../lib/report-trigger');
const { formatFetchError } = require('../lib/supabase-client');
const { afterResponse } = require('../lib/after-response');

// ── Manual / external report trigger ──────────────────────────────────────
// The primary path is now the in-process pipeline run under waitUntil straight
// from the payment handlers (see lib/after-response + report.runReportPipeline),
// so there is NO fragile HTTP self-call chain. This endpoint remains as a manual
// re-trigger (support tooling, retries). It runs the FULL pipeline in the
// background of its own response. HMAC-token guarded.
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

  console.log(`[generate-report] ▶ manual pipeline trigger auditId=${auditId} email=${email}`);
  try {
    const { runReportPipeline } = require('./report');
    afterResponse(() => runReportPipeline({ auditId, email, userId: userId || null }), `manual-report:${auditId}`);
    return res.json({ ok: true, started: true, message: 'Report pipeline running in background.' });
  } catch (err) {
    console.error('[generate-report] FAILED to start:', formatFetchError(err));
    return res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = handler;
