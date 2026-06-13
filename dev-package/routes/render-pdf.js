'use strict';

require('../lib/env');

const { jobToken, triggerStage } = require('../lib/report-trigger');
const { formatFetchError } = require('../lib/supabase-client');
const { runOncePerUser } = require('../lib/pdf-jobs');

// ── Pipeline Stage 2 (pdf) ────────────────────────────────────────────────
// Renders the PDF with Puppeteer, uploads it to Supabase Storage, and records the
// pdf_url. Reads the insights persisted by Stage 1 from audit_cache, so it never
// re-runs Claude. Idempotent: if the PDF already exists in storage it is reused.
// Triggers Stage 3 (email) on completion. Protected by an HMAC job token.
async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { auditId, email, userId, token } = req.body || {};
  if (!auditId || !email || !token) {
    return res.status(400).json({ error: 'auditId, email, token are required' });
  }
  if (token !== jobToken(auditId, email)) {
    console.warn(`[render-pdf] rejected — bad token auditId=${auditId}`);
    return res.status(403).json({ error: 'Invalid job token' });
  }

  console.log(`[render-pdf] ▶ pdf stage auditId=${auditId}`);

  try {
    const { runPdfStage } = require('./report');
    const result = await runOncePerUser(
      { body: { auditId, email: `pdf:${email}` }, headers: {}, socket: {} },
      { auditId, email: `pdf:${email}` },
      () => runPdfStage({ auditId, email })
    );
    console.log(`[render-pdf] ✓ pdf ready auditId=${auditId} pdf=${result?.pdfUrl ? 'yes' : 'no'} — triggering email stage`);

    await triggerStage(req, 'email', { auditId, email, userId: userId || null });

    return res.json({ ok: true, stage: 'pdf', nextStage: 'email', pdfUrl: result?.pdfUrl || null });
  } catch (err) {
    console.error('[render-pdf] pdf stage FAILED:', formatFetchError(err));
    return res.status(500).json({ ok: false, stage: 'pdf', error: err.message, code: err.code || 'PDF_FAILED' });
  }
}

module.exports = handler;
