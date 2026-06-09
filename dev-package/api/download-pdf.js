'use strict';

const fs = require('fs');
require('../lib/env');

const {
  cleanDoctorName,
  detectRegion,
  computePillarsV5,
  validatePillarTotal,
  buildPdfPlaceholders,
} = require('../lib/audit-helpers');
const { runAllPrompts, renderPdf } = require('./report');

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { auditData } = req.body || {};
  if (!auditData?.doctorName) return res.status(400).json({ error: 'auditData.doctorName required' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  console.log(`[download-pdf] generating for: ${auditData.doctorName}`);

  try {
    // Enrich with V5 fields
    const city    = auditData.city  || (auditData.cityState || '').split(',')[0].trim();
    const state   = auditData.state || (auditData.cityState || '').split(',')[1]?.trim() || '';
    const region  = auditData.region || detectRegion(city, state);
    const pillars = computePillarsV5(auditData);
    const d = {
      ...auditData,
      city, state, region,
      score:   pillars.total,
      pillars: { gmb: pillars.gmb, rating: pillars.rating, reviews: pillars.reviews, photos: pillars.photos, rank: pillars.rank, aiVisibility: pillars.aiVisibility, directories: pillars.directories },
      doctorNameClean: cleanDoctorName(auditData.doctorName),
      generatedAt:     auditData.generatedAt || new Date().toISOString(),
    };

    // Validate
    const v = validatePillarTotal(d);
    if (!v.valid) {
      console.error(`[download-pdf] pillar mismatch: ${v.actual} ≠ ${v.expected}`);
      return res.status(500).json({ error: 'Pillar calculation error' });
    }

    // Claude prompts
    console.log('[download-pdf] running Claude prompts...');
    const ai = await runAllPrompts(d);
    const full = { ...d, ...ai };

    // Load template and replace placeholders
    const templatePath = path.join(__dirname, '../public/pdf-report-template.html');
    let html = fs.readFileSync(templatePath, 'utf8');
    const placeholders = buildPdfPlaceholders(full, 13);
    for (const [token, value] of Object.entries(placeholders)) {
      html = html.split(token).join(value);
    }

    // Check for orphans
    const orphans = html.match(/{{[A-Z0-9_]+}}/g);
    if (orphans) {
      const unique = [...new Set(orphans)];
      console.error('[download-pdf] unreplaced placeholders:', unique.join(', '));
      return res.status(500).json({ error: 'Template error: ' + unique.join(', ') });
    }

    console.log('[download-pdf] rendering PDF...');
    const pdfBuffer = await renderPdf(html);
    console.log(`[download-pdf] done — ${Math.round(pdfBuffer.length / 1024)} KB`);

    const safeName = cleanDoctorName(auditData.doctorName).replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="DocMirror-Report-Dr-${safeName}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(Buffer.from(pdfBuffer));

  } catch (err) {
    console.error('[download-pdf] error:', err.message);
    res.status(500).json({ error: 'PDF generation failed: ' + err.message });
  }
}

module.exports = handler;
