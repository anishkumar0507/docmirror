'use strict';

require('../lib/env');

const { cleanDoctorName } = require('../lib/audit-helpers');
const { buildPdfBuffer, RateLimitError } = require('./report');
const { runOncePerUser } = require('../lib/pdf-jobs');
const { isRateLimitError } = require('../lib/claude-client');

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { auditData } = req.body || {};
  if (!auditData?.doctorName) return res.status(400).json({ error: 'auditData.doctorName required' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  console.log(`[download-pdf] request for: ${auditData.doctorName}`);

  try {
    // One PDF job per user — duplicate clicks join the in-flight job
    const pdfBuffer = await runOncePerUser(req, auditData, () => buildPdfBuffer(auditData));

    const safeName = cleanDoctorName(auditData.doctorName).replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '-');
    console.log(`[download-pdf] done — ${Math.round(pdfBuffer.length / 1024)} KB`);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="DocMirror-Report-Dr-${safeName}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(Buffer.from(pdfBuffer));

  } catch (err) {
    console.error('[download-pdf] error:', err.message);

    if (err instanceof RateLimitError || isRateLimitError(err)) {
      return res.status(429).json({
        error: 'Our AI service is busy right now. Please wait 30 seconds and try again.',
        code: 'rate_limit',
        retryAfter: err.retryAfter || 30,
      });
    }

    res.status(500).json({
      error: 'PDF generation failed. Please try again in a moment.',
      code: 'pdf_error',
      detail: err.message,
    });
  }
}

module.exports = handler;
