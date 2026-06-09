'use strict';

const path = require('path');
const fs   = require('fs');
require('../lib/env');

const { createClient }    = require('@supabase/supabase-js');
const Anthropic            = require('@anthropic-ai/sdk');
const auditStore           = require('../lib/audit-store');
const {
  cleanDoctorName,
  detectRegion,
  computePillarsV5,
  validatePillarTotal,
  buildPdfPlaceholders,
} = require('../lib/audit-helpers');

// ── Supabase ───────────────────────────────────────────────────────────────
function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// ── Claude prompt runner ───────────────────────────────────────────────────
async function runPrompt(client, prompt) {
  const msg = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 2500,
    messages:   [{ role: 'user', content: prompt }],
  });
  const raw = msg.content[0].text.trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(raw);
}

// ── Run all 8 Claude prompts in parallel ───────────────────────────────────
async function runAllPrompts(d) {
  const client   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const city     = d.city || (d.cityState || '').split(',')[0].trim();
  const state    = d.state || (d.cityState || '').split(',')[1]?.trim() || '';
  const specialty = d.specialty || 'General Practice';
  const score    = d.score || 0;
  const name     = cleanDoctorName(d.doctorName || '');
  const comps    = (d.competitors || []).slice(0, 3);
  const issuesTxt = (d.issues || []).map(i => typeof i === 'string' ? i : i.text || '').filter(Boolean).join('; ') || 'low review count, incomplete profile';

  const fixesPrompt = `Generate 5 prioritised fixes for Dr. ${name}, a ${specialty} in ${city}, ${state}.
Score: ${score}/100. Issues: ${issuesTxt}.
Each fix must be specific to ${specialty} (no inappropriate suggestions like before/after photos for psychiatrists).
For each: title, step-by-step instructions (under 15 min), copy-paste text where applicable, impact (high/medium/low), pillar, timeMinutes.
Respond ONLY with valid JSON (no markdown):
{"fixes":[{"title":"...","steps":"...","copyText":"...","impact":"high","pillar":"...","timeMinutes":10}]}`;

  const narrativePrompt = comps.length
    ? `Analyse competitive position for Dr. ${name} (score ${score}/100, ${d.rating}★, ${d.reviewCount} reviews) vs top competitors from Google Places: ${comps.map(c => `${c.name} (${c.reviewCount} reviews, ${c.rating}★, score ${c.googleScore}/100)`).join('; ')}.
Write exactly 3 sentences: (1) why top competitor wins, (2) most achievable gap to close, (3) realistic 90-day position.
Do NOT invent competitor names — only use the names provided.
Respond ONLY with valid JSON: {"narrative":"..."}`
    : null;

  const execSummaryPrompt = `Write an executive summary for Dr. ${name}'s visibility audit report.
Specialty: ${specialty} | City: ${city}, ${state} | Score: ${score}/100
Top issues: ${issuesTxt}
${comps.length ? `Competitors: ${comps.map(c => c.name).join(', ')}` : ''}

Return ONLY valid JSON:
{"headline":"One-line revenue impact (max 15 words)","paragraph1":"Where doctor stands today (2-3 sentences)","paragraph2":"Biggest gap and patient loss impact (2-3 sentences)","paragraph3":"What to do next (2-3 sentences)","top3Priorities":["Priority 1","Priority 2","Priority 3"]}`;

  const responseTemplatesPrompt = `Generate 3 Google review response templates for Dr. ${name}, ${specialty} in ${city}.
Keep each under 50 words. Professional, warm, HIPAA-safe (never confirm they are a patient).
1. For a 5-star positive review.
2. For a 3-star mixed/neutral review.
3. For a 1-2 star critical review.
Respond ONLY with valid JSON:
{"positive":"...","neutral":"...","critical":"..."}`;

  const seoPrompt = `Generate a keyword strategy for ${specialty} in ${city}, ${state}.
Primary (3-4 high-intent), Secondary (5-6 medium-intent), Long-tail (6-8 low-competition specific phrases).
Respond ONLY with valid JSON: {"primary":["..."],"secondary":["..."],"longTail":["..."]}`;

  const contentPrompt = `Content strategy for Dr. ${name}, ${specialty} in ${city}. Issues: ${issuesTxt}.
4 content pillars relevant to this specialty, 3 Reel ideas with hooks, 2 SEO blog titles, weekly posting cadence.
Respond ONLY with valid JSON:
{"pillars":["..."],"reelIdeas":[{"hook":"...","topic":"..."}],"blogTitles":["..."],"postingCadence":"..."}`;

  const journeyPrompt = `Map a 5-stage patient journey for ${specialty} in ${city}.
Stages: 1.Symptom Awareness 2.Searching for Help 3.Evaluating Doctor 4.Making Contact 5.Post-visit Advocacy.
Doctor data: Rating ${d.rating}, Reviews ${d.reviewCount}, Photos ${d.photoCount}, Website ${d.website ? 'yes' : 'no'}, Hours ${d.hasHours ? 'listed' : 'missing'}.
For each stage: status (winning/losing/neutral), touchpoint, currentGap if losing, winAction.
Respond ONLY with valid JSON:
{"stages":[{"stage":1,"name":"...","status":"winning","touchpoint":"...","currentGap":"","winAction":"..."}],"stagesWinning":0,"stagesLosing":0,"criticalStage":"..."}`;

  const planPrompt = `90-day visibility action plan for ${specialty} in ${city}. Score ${score}/100.
Issues: ${issuesTxt}.
Phase 1 (Days 1-30): Quick wins under 2 hours, no website needed.
Phase 2 (Days 31-60): Content creation and review generation.
Phase 3 (Days 61-90): Authority building and competitive positioning.
4-5 actions + 3 KPIs per phase, no hiring required, specialty-appropriate.
Respond ONLY with valid JSON:
{"phase1":{"focus":"...","actions":["..."],"kpis":["..."],"estimatedScoreGain":5},"phase2":{"focus":"...","actions":["..."],"kpis":["..."],"estimatedScoreGain":5},"phase3":{"focus":"...","actions":["..."],"kpis":["..."],"estimatedScoreGain":5},"projectedScoreAt90Days":${Math.min(100, score + 15)}}`;

  const [fixes, narrativeRes, execSummary, responseTemplates, seo, content, journey, plan] = await Promise.all([
    runPrompt(client, fixesPrompt),
    narrativePrompt ? runPrompt(client, narrativePrompt) : Promise.resolve({ narrative: '' }),
    runPrompt(client, execSummaryPrompt),
    runPrompt(client, responseTemplatesPrompt),
    runPrompt(client, seoPrompt),
    runPrompt(client, contentPrompt),
    runPrompt(client, journeyPrompt),
    runPrompt(client, planPrompt),
  ]);

  return {
    fixes:               fixes.fixes             || [],
    competitorNarrative: narrativeRes.narrative   || '',
    execSummary,
    responseTemplates,
    seoKeywords:         seo,
    contentStrategy:     content,
    patientJourney:      journey,
    ninetyDayPlan:       plan,
  };
}

// ── Render PDF with Puppeteer ──────────────────────────────────────────────
async function renderPdf(html) {
  let browser;
  if (process.env.VERCEL) {
    const chromium  = require('@sparticuz/chromium');
    const puppeteer = require('puppeteer-core');
    browser = await puppeteer.launch({
      args:           chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless:       chromium.headless,
    });
  } else {
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  }
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45000 });
    return await page.pdf({ format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }
}

// ── Send email via Gmail (nodemailer) ─────────────────────────────────────
async function sendEmail(email, doctorName, pdfBuffer) {
  const nodemailer  = require('nodemailer');
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  const cleanName = cleanDoctorName(doctorName);
  await transporter.sendMail({
    from:    `"The Doc Mirror" <${process.env.GMAIL_USER}>`,
    to:      email,
    subject: `Your Doctor Visibility Report — Dr. ${cleanName}`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#3D4D5C">
  <div style="background:#0A2540;padding:24px 32px;border-radius:12px 12px 0 0">
    <h1 style="color:#fff;margin:0;font-size:20px">The Doc <span style="color:#00A878">Mirror</span></h1>
    <p style="color:rgba(255,255,255,.6);margin:6px 0 0;font-size:13px">Full 7-Pillar AI Visibility Report</p>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="color:#0A2540;margin-top:0">Your Full Visibility Report is Ready</h2>
    <p>Hi Dr. ${cleanName},</p>
    <p>Your complete 13-page Doctor Visibility Report is attached as a PDF. It includes:</p>
    <ul style="color:#3D4D5C;line-height:1.9">
      <li>Executive summary with revenue impact</li>
      <li>AI Visibility scores (Google, ChatGPT, Gemini, Claude)</li>
      <li>7-Pillar breakdown with scores</li>
      <li>Patient Loss Estimate with methodology</li>
      <li>5 prioritised fixes with copy-paste text</li>
      <li>Competitor leaderboard (Google Places data)</li>
      <li>SEO keyword strategy</li>
      <li>Patient journey audit (5 stages)</li>
      <li>90-day action plan (3 phases)</li>
      <li>Monitor tier upsell details</li>
      <li>Methodology &amp; data sources</li>
    </ul>
    <p style="margin-top:24px;color:#6B7A8D;font-size:13px">Questions? Reply to this email or reach us at hello@thedocmirror.com</p>
  </div>
</div>`,
    attachments: [{
      filename:    `DocMirror-Report-Dr-${cleanName.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`,
      content:     Buffer.from(pdfBuffer),
      contentType: 'application/pdf',
    }],
  });
}

// ── generateReport — main pipeline ────────────────────────────────────────
async function generateReport({ auditId, email }) {
  console.log(`[report] ▶ start  auditId=${auditId}  email=${email}`);
  const supabase = db();

  await supabase.from('paid_reports').update({ status: 'generating' }).eq('audit_id', auditId);

  // 1. Fetch audit data (in-memory first, Supabase fallback)
  let d = auditStore.get(auditId);
  if (!d) {
    const { data: row, error } = await supabase
      .from('audit_cache').select('audit_data').eq('cache_key', auditId).single();
    if (error || !row?.audit_data) throw new Error(`audit_cache not found for ${auditId}`);
    d = row.audit_data;
  }
  console.log(`[report] audit data loaded — doctor: ${d.doctorName}`);

  // 2. Enrich with V5 fields
  const city    = d.city  || (d.cityState || '').split(',')[0].trim();
  const state   = d.state || (d.cityState || '').split(',')[1]?.trim() || '';
  const region  = d.region || detectRegion(city, state);
  const pillars = computePillarsV5(d);
  const score   = pillars.total;

  d = {
    ...d,
    city, state, region,
    score,
    pillars: { gmb: pillars.gmb, rating: pillars.rating, reviews: pillars.reviews, photos: pillars.photos, rank: pillars.rank, aiVisibility: pillars.aiVisibility, directories: pillars.directories },
    doctorNameClean: cleanDoctorName(d.doctorName || ''),
    generatedAt:     d.generatedAt || new Date().toISOString(),
  };

  // 3. Validate pillar total matches score
  const v = validatePillarTotal(d);
  if (!v.valid) {
    console.error(`[report] ✗ pillar mismatch — expected ${v.expected}, got ${v.actual} — aborting`);
    throw new Error(`Pillar total mismatch: ${v.actual} ≠ ${v.expected}`);
  }
  console.log(`[report] pillars valid — total ${v.actual}/100`);

  // 4. Run Claude prompts (all 8 in parallel)
  console.log('[report] running Claude prompts (8 parallel)...');
  const ai = await runAllPrompts(d);
  console.log('[report] prompts done');

  // Merge Claude output into d
  d = { ...d, ...ai };

  // 5. Load V5 template
  const templatePath = path.join(__dirname, '../public/pdf-report-template.html');
  let html = fs.readFileSync(templatePath, 'utf8');

  // 6. Replace every placeholder
  const placeholders = buildPdfPlaceholders(d, 13);
  for (const [token, value] of Object.entries(placeholders)) {
    html = html.split(token).join(value);
  }

  // 7. Check for unreplaced placeholders
  const orphans = html.match(/{{[A-Z0-9_]+}}/g);
  if (orphans) {
    const unique = [...new Set(orphans)];
    console.error('[report] ✗ unreplaced placeholders:', unique.join(', '));
    throw new Error(`Unreplaced placeholders in template: ${unique.join(', ')}`);
  }
  console.log('[report] ✓ no orphan placeholders');

  // 8. Render PDF
  console.log('[report] rendering PDF...');
  const pdfBuffer = await renderPdf(html);
  console.log(`[report] PDF ready — ${Math.round(pdfBuffer.length / 1024)} KB`);

  // 9. Upload to Supabase Storage (optional)
  let pdfUrl = null;
  try {
    const { error: upErr } = await supabase.storage.from('reports')
      .upload(`${auditId}.pdf`, pdfBuffer, { contentType: 'application/pdf', upsert: true });
    if (!upErr) {
      const { data: u } = supabase.storage.from('reports').getPublicUrl(`${auditId}.pdf`);
      pdfUrl = u?.publicUrl || null;
    }
  } catch (_) {}

  // 10. Send email
  console.log(`[report] sending email → ${email}`);
  await sendEmail(email, d.doctorName || 'Doctor', pdfBuffer);
  console.log('[report] email sent');

  // 11. Mark delivered
  await supabase.from('paid_reports').update({
    status: 'delivered', pdf_url: pdfUrl, delivered_at: new Date().toISOString(),
  }).eq('audit_id', auditId);

  console.log(`[report] ✓ done — Dr. ${d.doctorNameClean} → ${email}`);
}

// ── HTTP handler (manual trigger / test) ──────────────────────────────────
async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { auditId, email } = req.body || {};
  if (!auditId || !email) return res.status(400).json({ error: 'auditId and email required' });
  res.json({ ok: true, message: 'Report generation started. PDF will arrive in ~60 seconds.' });
  generateReport({ auditId, email }).catch(err => console.error('[report] handler error:', err.message));
}

module.exports = handler;
module.exports.generateReport = generateReport;
module.exports.renderPdf      = renderPdf;
// Legacy exports kept so download-pdf.js doesn't break during transition
module.exports.computePillars = computePillarsV5;
module.exports.runAllPrompts  = runAllPrompts;
