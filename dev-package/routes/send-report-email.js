'use strict';

require('../lib/env');

const { jobToken } = require('../lib/report-trigger');
const { formatFetchError } = require('../lib/supabase-client');
const { runOncePerUser } = require('../lib/pdf-jobs');

// ── Pipeline Stage 3 (email) ──────────────────────────────────────────────
// Downloads the PDF rendered by Stage 2 from storage and emails it. Marks
// paid_reports delivered (or 'generated' if the email send fails — the PDF is
// still downloadable). Final stage. Protected by an HMAC job token.
async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { auditId, email, token } = req.body || {};
  if (!auditId || !email || !token) {
    return res.status(400).json({ error: 'auditId, email, token are required' });
  }
  if (token !== jobToken(auditId, email)) {
    console.warn(`[send-report-email] rejected — bad token auditId=${auditId}`);
    return res.status(403).json({ error: 'Invalid job token' });
  }

  console.log(`[send-report-email] ▶ email stage auditId=${auditId} email=${email}`);

  try {
    const { runEmailStage } = require('./report');
    const result = await runOncePerUser(
      { body: { auditId, email: `email:${email}` }, headers: {}, socket: {} },
      { auditId, email: `email:${email}` },
      () => runEmailStage({ auditId, email })
    );
    console.log(`[send-report-email] ✓ done auditId=${auditId} emailSent=${result.emailSent}`);
    return res.json({ ok: true, stage: 'email', emailSent: result.emailSent, pdfUrl: result.pdfUrl || null });
  } catch (err) {
    console.error('[send-report-email] email stage FAILED:', formatFetchError(err));
    return res.status(500).json({ ok: false, stage: 'email', error: err.message, code: err.code || 'EMAIL_FAILED' });
  }
}

module.exports = handler;
