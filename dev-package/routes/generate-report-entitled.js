'use strict';

require('../lib/env');

const auditCache  = require('../lib/audit-cache');
const { optionalAuth } = require('../lib/auth-middleware');
const { getEntitlement } = require('../lib/entitlements');
const { getSupabaseClient } = require('../lib/supabase-client');
const { afterResponse } = require('../lib/after-response');

// Abuse cap ONLY (not a paywall): a runaway client loop must not burn Puppeteer +
// Claude spend. Subscribers are unlimited in the product sense; this just stops a
// pathological loop. Counted in the DB (reports created by this user in the last
// hour) so it holds across serverless instances.
const MAX_GENERATIONS_PER_HOUR = 10;

// Resolve the user from the verified Bearer token. userId/email come ONLY from
// here — never from the request body/query.
function resolveUser(req) {
  return new Promise(resolve => { optionalAuth(req, {}, () => resolve(req.user || null)); });
}

// Mint a fresh auditId (same format the checkout routes use).
function mintAuditId() {
  return `tdm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// POST /api/generate-report-entitled  { auditId? , auditData? }
// Entitlement-gated, authenticated unlock + report generation for active
// subscribers. No Razorpay/PayPal order is created, referenced, or short-circuited
// here — this is purely an entitlement → unlock → generate path.
//
// Two shapes are accepted, because the FREE homepage check never mints an auditId
// (it is only minted at checkout):
//   • { auditId }   — a report already cached (e.g. a $19 report the user re-opens)
//   • { auditData }  — the raw audit object from the fresh free check; we mint the
//                      id and cache it server-side here, mirroring checkout.js.
// The response's `entitled` flag is what unlocks the preview. Generation is a
// best-effort side effect — an entitled subscriber unlocks even if we cannot cache
// the audit data for PDF generation (they still see the full on-page report).
async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await resolveUser(req);
  if (!user || !user.id) {
    // No valid token → not entitled. Return the paywall response (don't generate),
    // but do not hard-401 — the anonymous free funnel is handled elsewhere.
    return res.status(200).json({ ok: false, entitled: false, paywall: true, reason: 'not_authenticated' });
  }

  // Entitlement is the ONLY thing that authorises the unlock + work here.
  const ent = await getEntitlement(user.id);
  if (!ent.canGenerateReport) {
    return res.status(200).json({ ok: false, entitled: false, paywall: true, tier: ent.tier, reason: ent.reason });
  }

  // From here on the user is a verified, entitled subscriber → the preview unlocks
  // regardless of whether generation can proceed.
  const supabase = getSupabaseClient();

  // Resolve the auditId: an existing cached id, or mint a new one from raw
  // audit data posted by the fresh free check.
  let auditId = String(req.body?.auditId || req.body?.reportId || '').trim();
  const auditData = req.body?.auditData;
  let auditReady = false;

  if (auditId && auditCache.isValidAuditId(auditId)) {
    const cache = await auditCache.getDetailed(auditId).catch(() => ({ hit: false }));
    auditReady = !!(cache && cache.hit && cache.data);
  } else {
    auditId = '';
  }

  // No usable cached report but we have the raw audit object → mint + cache it now.
  if (!auditReady && auditData && typeof auditData === 'object') {
    const newId = mintAuditId();
    try {
      await auditCache.set(newId, auditData);
      auditId = newId;
      auditReady = true;
    } catch (e) {
      console.warn('[generate-entitled] audit_cache set failed:', e.message);
    }
  }

  // Entitled but nothing to generate from → still unlock the preview.
  if (!auditReady) {
    return res.status(200).json({
      ok: true, entitled: true, generating: false, tier: ent.tier,
      message: 'Unlocked — included in your plan.',
    });
  }

  // Rate limit (abuse protection only — never a paywall). Applies once we are
  // about to actually generate; the unlock above is never rate limited.
  try {
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await supabase
      .from('reports')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', oneHourAgo);
    if ((count || 0) >= MAX_GENERATIONS_PER_HOUR) {
      console.warn(`[generate-entitled] rate limit hit userId=${user.id} count=${count}`);
      // Still unlock — the cap only throttles PDF generation, not access.
      return res.status(200).json({
        ok: true, entitled: true, generating: false, rateLimited: true, tier: ent.tier,
        reportId: auditId,
        message: `Unlocked. New PDF generation is paused for a bit (max ${MAX_GENERATIONS_PER_HOUR}/hour).`,
      });
    }
  } catch (e) {
    // Fail OPEN on the counter (it is only abuse protection, never a paywall).
    console.warn('[generate-entitled] rate-limit count warn:', e.message);
  }

  console.log(`[generate-entitled] ▶ userId=${user.id} tier=${ent.tier} auditId=${auditId} — generating (no order)`);

  // Same proven mechanism as the paid flow: respond instantly, run the full
  // pipeline (insights → PDF → storage → email) under waitUntil (≤60s cap).
  // Puppeteer never blocks this response. userId is persisted on the report so it
  // appears in Reports & PDFs.
  const { runReportPipeline } = require('./report');
  afterResponse(
    () => runReportPipeline({ auditId, email: user.email, userId: user.id }),
    `entitled-report:${auditId}`
  );

  return res.status(200).json({
    ok: true,
    entitled: true,
    generating: true,
    reportId: auditId,
    tier: ent.tier,
    message: 'Your report is generating — it will unlock here and appear in Reports & PDFs shortly.',
  });
}

module.exports = handler;
