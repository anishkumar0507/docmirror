'use strict';

require('../lib/env');

const { jobToken, triggerStage } = require('../lib/report-trigger');
const { formatFetchError } = require('../lib/supabase-client');
const { runOncePerUser } = require('../lib/pdf-jobs');

// ── Pipeline Stage 1 (insights) ───────────────────────────────────────────
// Runs ONLY the 9 Claude prompts and persists insights (audit_cache + reports).
// This is the stage the dashboard waits on — once it finishes, every AI section
// fills in. It then triggers Stage 2 (PDF) as a separate invocation so Puppeteer
// never eats into this stage's 60s budget. Protected by an HMAC job token.
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

  console.log(`[generate-report] ▶ insights stage auditId=${auditId} email=${email}`);

  try {
    const { runInsightsStage } = require('./report');
    // Deduplicated so a duplicate trigger joins the in-flight job instead of
    // spending Claude credits twice.
    const result = await runOncePerUser(
      { body: { auditId, email }, headers: {}, socket: {} },
      { auditId, email },
      () => runInsightsStage({ auditId, email, userId: userId || null })
    );
    console.log(`[generate-report] ✓ insights ready auditId=${auditId} — triggering PDF stage`);

    // Chain to Stage 2. Fire-and-forget; /api/reconcile re-drives if it's dropped.
    await triggerStage(req, 'pdf', { auditId, email, userId: userId || null });

    return res.json({ ok: true, stage: 'insights', nextStage: 'pdf', score: result?.d?.score ?? null });
  } catch (err) {
    console.error('[generate-report] insights stage FAILED:', formatFetchError(err));
    return res.status(500).json({ ok: false, stage: 'insights', error: err.message, code: err.code || 'INSIGHTS_FAILED' });
  }
}

module.exports = handler;
