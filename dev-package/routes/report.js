'use strict';

const path = require('path');
const fs   = require('fs');
require('../lib/env');

const auditCache            = require('../lib/audit-cache');
const paidReports           = require('../lib/paid-reports');
const reportsStore          = require('../lib/reports-store');
const { getSupabaseClient } = require('../lib/supabase-client');
const { runClaudePrompt, RateLimitError, getQueueStats } = require('../lib/claude-client');
const { runOncePerUser }    = require('../lib/pdf-jobs');
const { launchBrowser }     = require('../lib/puppeteer-loader');
const { createGmailTransport } = require('../lib/gmail');
const {
  cleanDoctorName,
  detectRegion,
  computePillarsV5,
  validatePillarTotal,
  buildPdfPlaceholders,
} = require('../lib/audit-helpers');

// ── Supabase ───────────────────────────────────────────────────────────────
function db() {
  return getSupabaseClient();
}

// ── Run all Claude prompts SEQUENTIALLY via global queue ──────────────────
// Previously Promise.all fired ~10 concurrent connections → 429 rate_limit_error.
// Now one request at a time with retry/backoff. Social + compliance merged (9→8).
async function runAllPrompts(d) {
  const city      = d.city || (d.cityState || '').split(',')[0].trim();
  const state     = d.state || (d.cityState || '').split(',')[1]?.trim() || '';
  const specialty = d.specialty || 'General Practice';
  const score     = d.score || 0;
  const name      = cleanDoctorName(d.doctorName || '');
  const comps     = (d.competitors || []).slice(0, 3);
  const issuesTxt = (d.issues || [])
    .map(i => typeof i === 'string' ? i : i.text || '')
    .filter(Boolean)
    .join('; ') || 'low review count, incomplete profile';

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

  const region = d.region || 'IN';

  // OPTIMIZATION: merge social calendar + compliance donts into ONE API call (saves 1 request)
  const socialAndCompliancePrompt = `For Dr. ${name}, ${specialty} in ${city}, ${state} (${region === 'IN' ? 'India' : 'US'}):

1) 30-day social media strategy (specialty-appropriate topics only).
2) 5 specialty-specific compliance cautions for social media.
${region === 'IN' ? 'Reference MCI/IMC where relevant.' : 'Reference FTC/FDA/HIPAA where relevant.'}

Return ONLY valid JSON:
{"socialContent":{"categories":{"cat1":["..."],"cat2":["..."],"cat3":["..."],"cat4":["..."]},"topics":[{"title":"...","catNum":"1"}],"calendar":[{"week":1,"mon":{"cat":"Education","catNum":"1","topic":"..."},"wed":{"cat":"Lifestyle","catNum":"2","topic":"..."},"fri":{"cat":"Community","catNum":"4","topic":"..."}}]},"specialtyDonts":["caution1","caution2","caution3","caution4","caution5"]}
Provide 12 topics and 4 calendar weeks.`;

  const promptSteps = [
    { key: 'fixes',             label: 'fixes',               prompt: fixesPrompt,               optional: false },
    { key: 'narrative',         label: 'competitor-narrative', prompt: narrativePrompt,           optional: true,  fallback: { narrative: '' } },
    { key: 'execSummary',       label: 'exec-summary',         prompt: execSummaryPrompt,         optional: false },
    { key: 'responseTemplates', label: 'review-templates',     prompt: responseTemplatesPrompt,   optional: false },
    { key: 'seo',               label: 'seo-keywords',         prompt: seoPrompt,                 optional: false },
    { key: 'content',           label: 'content-strategy',     prompt: contentPrompt,             optional: false },
    { key: 'journey',           label: 'patient-journey',      prompt: journeyPrompt,             optional: false },
    { key: 'plan',              label: '90-day-plan',          prompt: planPrompt,                optional: false },
    { key: 'socialCompliance',  label: 'social-compliance',    prompt: socialAndCompliancePrompt, optional: true,  fallback: { socialContent: {}, specialtyDonts: [] } },
  ];

  const results  = {};
  const totalSteps = promptSteps.filter(s => s.prompt).length;

  console.log(`[pdf] dispatching ${totalSteps} prompts (concurrency-limited):`, getQueueStats());

  // Fire all prompts at once — the claude-client queue throttles to MAX_CONCURRENCY
  // and retries 429s. This replaces the old strictly-serial loop (~55s → ~15-20s).
  await Promise.all(promptSteps.map(async (step) => {
    if (!step.prompt) { results[step.key] = step.fallback || {}; return; }
    try {
      results[step.key] = await runClaudePrompt(step.prompt, {
        label:     step.label,
        maxTokens: step.label === 'review-templates' ? 1200 : 2500,
      });
    } catch (err) {
      if (step.optional) {
        console.warn(`[pdf] optional prompt "${step.label}" failed — using fallback:`, err.message);
        results[step.key] = step.fallback || {};
      } else {
        throw err;
      }
    }
  }));

  const socialCompliance = results.socialCompliance || {};

  return {
    fixes:               results.fixes?.fixes             || [],
    competitorNarrative: results.narrative?.narrative     || '',
    execSummary:         results.execSummary,
    responseTemplates:   results.responseTemplates,
    seoKeywords:         results.seo,
    contentStrategy:     results.content,
    patientJourney:      results.journey,
    ninetyDayPlan:       results.plan,
    socialContent:       socialCompliance.socialContent   || {},
    specialtyDonts:      socialCompliance.specialtyDonts  || [],
  };
}

/** Enrich raw audit payload with V5 pillars/score and validate the total. */
function enrichAuditData(auditData) {
  const city    = auditData.city  || (auditData.cityState || '').split(',')[0].trim();
  const state   = auditData.state || (auditData.cityState || '').split(',')[1]?.trim() || '';
  const region  = auditData.region || detectRegion(city, state);
  const pillars = computePillarsV5(auditData);

  const d = {
    ...auditData,
    city, state, region,
    score: pillars.total,
    pillars: {
      gmb: pillars.gmb, rating: pillars.rating, reviews: pillars.reviews,
      photos: pillars.photos, rank: pillars.rank,
      aiVisibility: pillars.aiVisibility, directories: pillars.directories,
    },
    doctorNameClean: cleanDoctorName(auditData.doctorName),
    generatedAt:     auditData.generatedAt || new Date().toISOString(),
  };

  const v = validatePillarTotal(d);
  if (!v.valid) throw new Error(`Pillar calculation error: ${v.actual} ≠ ${v.expected}`);
  return d;
}

/** Normalise raw Claude results into the persisted `insights` shape. */
function extractInsights(ai) {
  return {
    fixes:               ai.fixes               || [],
    competitorNarrative: ai.competitorNarrative  || '',
    execSummary:         ai.execSummary          || null,
    responseTemplates:   ai.responseTemplates    || null,
    seoKeywords:         ai.seoKeywords          || null,
    contentStrategy:     ai.contentStrategy      || null,
    patientJourney:      ai.patientJourney       || null,
    ninetyDayPlan:       ai.ninetyDayPlan        || null,
    socialContent:       ai.socialContent        || null,
    specialtyDonts:      ai.specialtyDonts       || [],
  };
}

/** Render the PDF from already-enriched data + already-generated AI content. */
async function renderPdfFromAi(d, ai) {
  const full = {
    ...d,
    ...ai,
    complianceFramework: d.region === 'IN'
      ? 'MCI Code of Ethics, IMC Regulations 2002, and the Drugs & Magic Remedies Act 1954'
      : 'FTC Guidelines, FDA Social Media Guidance, and HIPAA Privacy Rules',
  };

  const templatePath = path.join(__dirname, '../public/pdf-report-template.html');
  let html = fs.readFileSync(templatePath, 'utf8');
  const placeholders = buildPdfPlaceholders(full, 15);
  for (const [token, value] of Object.entries(placeholders)) {
    html = html.split(token).join(value);
  }

  const orphans = html.match(/{{[A-Z0-9_]+}}/g);
  if (orphans) {
    throw new Error(`Unreplaced placeholders: ${[...new Set(orphans)].join(', ')}`);
  }

  return renderPdf(html);
}

/**
 * Build PDF buffer — shared by download-pdf and generateReport.
 * Returns { buffer: Buffer, insights: Object } so callers can save the AI data to the DB.
 */
async function buildPdfBuffer(auditData) {
  const d   = enrichAuditData(auditData);
  const ai  = await runAllPrompts(d);
  const buffer = await renderPdfFromAi(d, ai);
  return { buffer, insights: extractInsights(ai) };
}

// ── Render PDF with Puppeteer (ESM-safe via lib/puppeteer-loader) ──────────
async function renderPdf(html) {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45000 });
    return await page.pdf({
      format:           'A4',
      printBackground:  true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } finally {
    await browser.close();
  }
}

// ── Send email via Gmail (nodemailer) ─────────────────────────────────────
async function sendEmail(email, doctorName, pdfBuffer) {
  const transporter = createGmailTransport();
  const cleanName   = cleanDoctorName(doctorName);
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
    <p>Your complete 15-page Doctor Visibility Report is attached as a PDF. It includes:</p>
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
    <p style="margin-top:24px;color:#6B7A8D;font-size:13px">Questions? Reply to this email or reach us at thedocmirror@gmail.com</p>
  </div>
</div>`,
    attachments: [{
      filename:    `DocMirror-Report-Dr-${cleanName.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`,
      content:     Buffer.from(pdfBuffer),
      contentType: 'application/pdf',
    }],
  });
}

// ── Verify "reports" bucket exists in Supabase Storage ────────────────────
// Called at startup and before first upload attempt.
async function verifyReportsBucket(supabase) {
  if (!supabase) return { ok: false, reason: 'supabase_not_configured' };
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) {
      console.error('[storage] listBuckets failed:', error.message);
      return { ok: false, reason: error.message };
    }
    const found = (buckets || []).some(b => b.name === 'reports');
    if (!found) {
      console.error(
        '[storage] bucket "reports" NOT FOUND. ' +
        'Create it in Supabase → Storage → New bucket → name: reports → Public: true. ' +
        'Also ensure the service role key has storage.objects INSERT permission.'
      );
      return { ok: false, reason: 'bucket_not_found' };
    }
    console.log('[storage] bucket "reports" exists ✓');
    return { ok: true };
  } catch (err) {
    console.error('[storage] verifyReportsBucket exception:', err.message);
    return { ok: false, reason: err.message };
  }
}

// ── Staged pipeline ───────────────────────────────────────────────────────
// The report pipeline is split into THREE independent serverless invocations so
// no single one can exceed the Vercel 60s cap:
//
//   Stage 1 (insights)  runInsightsStage  — 9 Claude prompts → persist insights
//   Stage 2 (pdf)       runPdfStage       — Puppeteer render → upload → pdf_url
//   Stage 3 (email)     runEmailStage     — email the PDF
//
// Each stage is idempotent (re-running a completed stage is a cheap no-op) and
// updates paid_reports.status so /api/reconcile can re-drive any stage whose
// fire-and-forget trigger was dropped by a frozen lambda. Insights are persisted
// FIRST so the dashboard fills its AI sections long before the PDF/email finish.

/** Load + enrich the audit payload, or throw AuditCacheError if it's missing. */
async function loadEnrichedAudit(canonicalId) {
  const cacheResult = await auditCache.getDetailed(canonicalId);
  if (!cacheResult.hit || !cacheResult.data) {
    const diagnostic = auditCache.formatDiagnostic(cacheResult);
    console.error(`[report] audit_cache MISS  cache_key=${canonicalId}`, JSON.stringify(diagnostic));
    const { AuditCacheError } = auditCache;
    throw new AuditCacheError(
      cacheResult.code || 'CACHE_MISS',
      cacheResult.message || `No audit data for cache_key=${canonicalId}`,
      cacheResult
    );
  }
  return { d: enrichAuditData(cacheResult.data), raw: cacheResult.data, source: cacheResult.source };
}

/** True once the AI insights have actually been generated for this audit. */
function hasInsights(raw) {
  const ins = raw && raw.insights;
  return !!(ins && (Array.isArray(ins.fixes) && ins.fixes.length || ins.execSummary || ins.patientJourney));
}

const STORAGE_PATH = (id) => `${id}.pdf`;

async function publicPdfUrl(supabase, canonicalId) {
  try {
    const { data } = supabase.storage.from('reports').getPublicUrl(STORAGE_PATH(canonicalId));
    return data?.publicUrl || null;
  } catch { return null; }
}

/** Download a previously-uploaded PDF from storage as a Buffer (null if absent). */
async function downloadPdfBuffer(supabase, canonicalId) {
  try {
    const { data, error } = await supabase.storage.from('reports').download(STORAGE_PATH(canonicalId));
    if (error || !data) return null;
    const arrBuf = await data.arrayBuffer();
    return Buffer.from(arrBuf);
  } catch { return null; }
}

/** Upload a rendered PDF and return its public URL (null on failure). */
async function uploadPdfBuffer(supabase, canonicalId, pdfBuffer) {
  const uploadPath = STORAGE_PATH(canonicalId);
  const { error: upErr } = await supabase.storage
    .from('reports')
    .upload(uploadPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });
  if (upErr) {
    console.error(`[storage] upload FAILED  path=${uploadPath}  statusCode=${upErr.statusCode}  message=${upErr.message}`);
    if (upErr.statusCode === 404 || upErr.message?.includes('not found')) {
      console.error('[storage] Bucket "reports" missing. Fix: Supabase → Storage → New bucket → name=reports, Public=true');
    }
    return null;
  }
  const url = await publicPdfUrl(supabase, canonicalId);
  console.log(`[storage] upload OK  pdfUrl=${url}`);
  return url;
}

// ── Stage 1: Claude prompts → persist insights ────────────────────────────
// Heaviest non-PDF stage (~15-40s). Persists insights to audit_cache (dashboard
// source of truth) AND reports.insights, then writes the report row with score/
// competitors so the dashboard has full data before any PDF exists.
async function runInsightsStage({ auditId, email, userId = null }) {
  const canonicalId = auditCache.normalizeAuditId(auditId);
  console.log(`[stage:insights] ▶ auditId=${canonicalId} email=${email}`);
  const supabase = db();
  const { d, raw, source } = await loadEnrichedAudit(canonicalId);
  console.log(`[stage:insights] audit loaded source=${source} doctor=${d.doctorName} score=${d.score}/100`);

  let insights = raw.insights;
  if (hasInsights(raw)) {
    console.log(`[stage:insights] insights already present — skipping Claude prompts`);
  } else {
    // status stays 'generating' (an allowed value) through this stage. On failure
    // we DON'T mark 'failed' (which is terminal) — leaving 'generating' lets
    // /api/reconcile retry the stage. Insights/PDF presence is the real signal.
    await paidReports.updateStatus(canonicalId, { status: 'generating' });
    const ai = await runAllPrompts(d);
    insights = extractInsights(ai);
    if (supabase) {
      await auditCache.mergeAuditData(canonicalId, { insights, score: d.score });
      const row = reportsStore.reportFromAuditData(canonicalId, d, { insights });
      if (userId) row.user_id = userId;
      const res = await reportsStore.upsertReport(supabase, row);
      console.log(`[stage:insights] persisted insights + report row  row=${res.action || res.reason}`);
    }
  }
  return { auditId: canonicalId, d, insights };
}

// ── Stage 2: render PDF → upload ──────────────────────────────────────────
async function runPdfStage({ auditId, email }) {
  const canonicalId = auditCache.normalizeAuditId(auditId);
  console.log(`[stage:pdf] ▶ auditId=${canonicalId}`);
  const supabase = db();
  const { d, raw } = await loadEnrichedAudit(canonicalId);
  const insights = raw.insights || extractInsights({});

  let pdfBuffer = supabase ? await downloadPdfBuffer(supabase, canonicalId) : null;
  let pdfUrl = null;
  if (pdfBuffer) {
    pdfUrl = await publicPdfUrl(supabase, canonicalId);
    console.log(`[stage:pdf] PDF already in storage — skipping render (${Math.round(pdfBuffer.length / 1024)} KB)`);
  } else {
    // On render failure, leave status 'generating' (not terminal) so reconcile retries.
    console.log('[stage:pdf] rendering PDF (Puppeteer)...');
    pdfBuffer = await renderPdfFromAi(d, insights);
    console.log(`[stage:pdf] PDF ready — ${Math.round(pdfBuffer.length / 1024)} KB`);
    if (supabase) {
      pdfUrl = await uploadPdfBuffer(supabase, canonicalId, pdfBuffer);
      if (pdfUrl) {
        const upRes = await reportsStore.upsertReport(supabase, { audit_id: canonicalId, pdf_url: pdfUrl });
        if (!upRes.ok) console.warn('[stage:pdf] reports pdf_url update warn:', upRes.error?.message || upRes.reason);
      }
    } else {
      console.warn('[stage:pdf] Supabase not configured — PDF not stored');
    }
  }
  // Record pdf_url on paid_reports without changing status (stays 'generating').
  if (pdfUrl) await paidReports.updateStatus(canonicalId, { pdf_url: pdfUrl });
  return { auditId: canonicalId, d, pdfUrl, pdfBuffer };
}

// ── Stage 3: email the PDF ────────────────────────────────────────────────
async function runEmailStage({ auditId, email }) {
  const canonicalId = auditCache.normalizeAuditId(auditId);
  console.log(`[stage:email] ▶ auditId=${canonicalId} email=${email}`);
  const supabase = db();

  // Idempotency guard — never re-email an order that was already delivered. This
  // makes the email stage safe to re-trigger from /api/reconcile.
  const existing = await paidReports.get(canonicalId);
  if (existing && (existing.delivered_at || existing.status === 'delivered')) {
    console.log(`[stage:email] already delivered — skipping send  auditId=${canonicalId}`);
    return { success: true, emailSent: true, alreadyDelivered: true, pdfUrl: existing.pdf_url || null };
  }

  const { d, raw } = await loadEnrichedAudit(canonicalId);

  // Prefer the already-rendered PDF in storage; re-render only as a last resort.
  let pdfBuffer = supabase ? await downloadPdfBuffer(supabase, canonicalId) : null;
  if (!pdfBuffer) {
    console.warn('[stage:email] no stored PDF — re-rendering before send');
    pdfBuffer = await renderPdfFromAi(d, raw.insights || extractInsights({}));
  }

  let emailSent = false;
  console.log(`[stage:email] sending to ${email}  doctor=${d.doctorNameClean}...`);
  try {
    await sendEmail(email, d.doctorName || 'Doctor', pdfBuffer);
    emailSent = true;
    console.log(`[stage:email] sent ✓  to=${email}`);
  } catch (mailErr) {
    console.error(`[stage:email] FAILED  to=${email}  error=${mailErr.message}`);
    if (mailErr.responseCode) console.error(`[stage:email] SMTP response code: ${mailErr.responseCode}`);
    if (mailErr.response)     console.error(`[stage:email] SMTP server response: ${mailErr.response}`);
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      console.error('[stage:email] GMAIL_USER or GMAIL_APP_PASSWORD env var is missing');
    }
  }

  const pdfUrl = supabase ? await publicPdfUrl(supabase, canonicalId) : null;
  await paidReports.updateStatus(canonicalId, {
    status:       emailSent ? 'delivered' : 'generated',
    pdf_url:      pdfUrl,
    delivered_at: new Date().toISOString(),
  });
  console.log(`[stage:email] ${emailSent ? '✓ delivered' : 'email failed — status=generated (downloadable)'}  auditId=${canonicalId}`);
  return { success: true, emailSent, pdfUrl };
}

/**
 * Run the WHOLE pipeline (insights → pdf → storage → email) in ONE process,
 * sequentially and idempotently. This is the reliable production path: callers
 * invoke it under waitUntil (see lib/after-response) so it finishes in the
 * background of the payment response without the fragile HTTP self-call chain.
 *
 * Never throws — each stage is logged and a partial failure is reported in the
 * return value so /api/reconcile (or the next call) can resume. Deduplicated per
 * audit/email so concurrent triggers join one run instead of doubling work.
 */
async function runReportPipeline({ auditId, email, userId = null }) {
  const fakeReq = { body: { auditId, email }, headers: {}, socket: {} };
  return runOncePerUser(fakeReq, { auditId, email }, async () => {
    const t0 = Date.now();
    const result = { auditId, insights: false, pdf: false, emailSent: false, pdfUrl: null, error: null };
    console.log(`[pipeline] ▶ start auditId=${auditId} email=${email}`);

    try {
      const ins = await runInsightsStage({ auditId, email, userId });
      result.insights = true;
      console.log(`[pipeline] ✓ insights done (${Date.now() - t0}ms) auditId=${auditId}`);

      try {
        const pdf = await runPdfStage({ auditId, email });
        result.pdf = !!pdf.pdfUrl || !!pdf.pdfBuffer;
        result.pdfUrl = pdf.pdfUrl || null;
        console.log(`[pipeline] ✓ pdf done (${Date.now() - t0}ms) auditId=${auditId} pdf=${result.pdf ? 'stored' : 'rendered'}`);

        const mail = await runEmailStage({ auditId, email });
        result.emailSent = mail.emailSent;
        result.pdfUrl = mail.pdfUrl || result.pdfUrl;
        if (mail.emailSent) {
          console.log(`[report] ✓ complete auditId=${auditId} email=${email} pdfUrl=${result.pdfUrl || '(none)'} totalMs=${Date.now() - t0}`);
        } else {
          console.warn(`[pipeline] email NOT sent auditId=${auditId} — status=generated (PDF downloadable). reconcile/login will not retry; check Gmail logs.`);
        }
      } catch (pdfOrMailErr) {
        result.error = pdfOrMailErr.message;
        console.error(`[pipeline] ✗ pdf/email stage failed auditId=${auditId}: ${formatPipelineErr(pdfOrMailErr)} — reconcile will resume`);
      }
    } catch (insErr) {
      result.error = insErr.message;
      console.error(`[pipeline] ✗ insights stage failed auditId=${auditId}: ${formatPipelineErr(insErr)} — reconcile will resume`);
    }

    console.log(`[pipeline] ◀ end auditId=${auditId} insights=${result.insights} pdf=${result.pdf} emailSent=${result.emailSent} totalMs=${Date.now() - t0}`);
    return result;
  });
}

function formatPipelineErr(err) {
  try { return require('../lib/supabase-client').formatFetchError(err); }
  catch { return err.message; }
}

/**
 * Back-compat alias. Some callers/tests expect generateReport to return the
 * old shape; map the pipeline result onto it.
 */
async function generateReport({ auditId, email, userId = null }) {
  const r = await runReportPipeline({ auditId, email, userId });
  return {
    success: true,
    pdfGenerated: r.pdf,
    emailSent: r.emailSent,
    pdfUrl: r.pdfUrl,
  };
}

// ── HTTP handler (manual trigger / test) ──────────────────────────────────
async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { auditId, email } = req.body || {};
  if (!auditId || !email) return res.status(400).json({ error: 'auditId and email required' });

  // Respond immediately — generation is async and can take 60-180 seconds
  res.json({ ok: true, message: 'Report generation started. PDF will arrive in ~60 seconds.' });
  generateReport({ auditId, email }).catch(err =>
    console.error('[report] handler error:', err.message)
  );
}

module.exports = handler;
module.exports.generateReport    = generateReport;
module.exports.runReportPipeline = runReportPipeline;
module.exports.runInsightsStage  = runInsightsStage;
module.exports.runPdfStage       = runPdfStage;
module.exports.runEmailStage     = runEmailStage;
module.exports.loadEnrichedAudit = loadEnrichedAudit;
module.exports.buildPdfBuffer    = buildPdfBuffer;
module.exports.renderPdf         = renderPdf;
module.exports.runAllPrompts     = runAllPrompts;
module.exports.verifyReportsBucket = verifyReportsBucket;
module.exports.RateLimitError    = RateLimitError;
module.exports.computePillars    = computePillarsV5;
