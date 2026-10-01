'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// The buy-first, redeem-later one-time report: list credits/history, redeem a
// credit into an actual report, and hand out a private signed-URL download.
//
// Everything here is requireAuth-gated — a credit belongs to an account, and
// every write is scoped to req.user.id, never an id from the request body.
// Purchase (order creation + payment verification + credit granting) lives in
// routes/checkout.js + routes/verify-payment.js + lib/report-credits.js — this
// file is redeem + delivery only.
// ─────────────────────────────────────────────────────────────────────────────

require('../lib/env');

const auditCache    = require('../lib/audit-cache');
const reportCredits = require('../lib/report-credits');
const reportsStore  = require('../lib/reports-store');
const { getSupabaseClient } = require('../lib/supabase-client');
const { afterResponse } = require('../lib/after-response');
const { getSignedDownloadUrl } = require('../lib/report-storage-private');

function mintAuditId() {
  return `tdm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/report-credits   (requireAuth)
// Available credit count + full purchase/redemption history, for the redeem
// page ("you have N reports to redeem") and a "past purchased reports" list.
// ─────────────────────────────────────────────────────────────────────────────
async function list(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const all = await reportCredits.listCredits(req.user.id);
  const available = all.filter((c) => c.status === 'available');
  const used = all.filter((c) => c.status === 'used');

  // Attach ready:true/false per redeemed report, so the redeem page can stop
  // polling once every credit's PDF has actually landed instead of polling on
  // a fixed timer regardless of state.
  const auditIds = used.map((c) => c.redeemed_audit_id).filter(Boolean);
  let readySet = new Set();
  if (auditIds.length) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data } = await supabase.from('reports').select('audit_id, pdf_url').in('audit_id', auditIds);
      readySet = new Set((data || []).filter((r) => r.pdf_url).map((r) => r.audit_id));
    }
  }
  used.forEach((c) => { c.ready = c.redeemed_audit_id ? readySet.has(c.redeemed_audit_id) : false; });

  res.json({
    availableCount: available.length,
    available,
    used,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/report-credits/redeem   { auditData }   (requireAuth)
//
// auditData is the raw result of a fresh POST /api/audit call the redeem page
// runs client-side FIRST (same shape routes/generate-report-entitled.js already
// accepts from "a fresh free check" — nothing new invented here). This route
// never runs the scan itself; it only spends a credit on an already-run one.
// ─────────────────────────────────────────────────────────────────────────────
async function redeem(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const userId    = req.user.id;
  const email     = req.user.email || '';
  const auditData = req.body && req.body.auditData;

  if (!auditData || typeof auditData !== 'object' || !auditData.doctorName) {
    return res.status(400).json({ error: 'auditData (from running the scan) is required' });
  }

  // ── 1. Must have a credit to spend ──────────────────────────────────────────
  const credit = await reportCredits.findAvailableCredit(userId);
  if (!credit) {
    return res.status(404).json({ error: 'No available report credit on this account.', code: 'NO_CREDIT' });
  }

  // ── 2. Mint + cache the report this credit is being spent on ───────────────
  const auditId = mintAuditId();
  try {
    await auditCache.set(auditId, auditData);
  } catch (e) {
    console.error(`[report-credits] audit_cache set failed userId=${userId} auditId=${auditId}: ${e.message}`);
    return res.status(503).json({ error: 'Could not save the scan result. Please try again.' });
  }

  // ── 3. Atomically consume the credit — race-safe (see lib/report-credits.js).
  const city = auditData.city || (auditData.cityState || '').split(',')[0].trim();
  const doctorRef = [auditData.doctorName, city].filter(Boolean).join(', ');
  const consumed = await reportCredits.consumeCredit({ creditId: credit.id, userId, doctorRef, redeemedAuditId: auditId });
  if (!consumed.ok) {
    return res.status(409).json({
      error: consumed.reason === 'already_consumed'
        ? 'That report credit was already used (maybe in another tab).'
        : 'Could not redeem the credit. Please try again.',
      code: consumed.reason === 'already_consumed' ? 'ALREADY_CONSUMED' : 'CONSUME_FAILED',
    });
  }

  console.log(`[report-credits] redeemed creditId=${credit.id} userId=${userId} auditId=${auditId} doctorRef="${doctorRef}"`);

  // ── 4. Placeholder report row (same pattern verify-payment.js uses) so the
  //      redeem page has real numbers on its first poll. ─────────────────────
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const placeholder = reportsStore.reportFromAuditData(auditId, auditData, {});
      placeholder.user_id = userId;
      await reportsStore.upsertReport(supabase, placeholder);
    } catch (e) {
      console.warn('[report-credits] placeholder write warn:', e.message);
    }
  }

  // ── 5. Run the SAME pipeline every other report uses (unchanged). ──────────
  const { runReportPipeline } = require('./report');
  afterResponse(() => runReportPipeline({ auditId, email, userId }), `report-credit:${auditId}`);

  return res.json({
    ok: true,
    generating: true,
    reportId: auditId,
    message: 'Generating your report — it will appear below shortly.',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/report-credits/download/:auditId   (requireAuth)
// Ownership is checked against report_credits (this endpoint only serves
// reports that were redeemed from a credit), then a short-lived signed URL is
// handed out from the PRIVATE bucket — never the pipeline's public URL.
// ─────────────────────────────────────────────────────────────────────────────
async function download(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const auditId = String(req.params.auditId || '').trim();
  if (!auditId) return res.status(400).json({ error: 'auditId is required' });

  const owner = await reportCredits.findByRedeemedAuditId(auditId);
  if (!owner || owner.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Report not found.' });
  }

  const supabase = getSupabaseClient();
  const url = await getSignedDownloadUrl(supabase, auditId);
  if (!url) {
    return res.status(202).json({ ready: false, message: 'Your PDF is still generating. Try again in a moment.' });
  }
  return res.json({ ready: true, url });
}

module.exports = { list, redeem, download };
