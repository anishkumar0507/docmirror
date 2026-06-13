'use strict';

require('../lib/env');

const { getSupabaseClient } = require('../lib/supabase-client');
const auditCache = require('../lib/audit-cache');

// ── Pipeline reconciler (safety net) ──────────────────────────────────────
// The staged pipeline chains insights → pdf → email via fire-and-forget self-
// calls. On Vercel a frozen lambda can drop an outbound trigger, leaving an order
// stuck (the 4 "generating" + 2 "pending" rows seen in production). This endpoint
// scans paid_reports for non-terminal orders, inspects what's actually been
// produced (insights? PDF?), and re-triggers the correct next stage. Every stage
// is idempotent, so re-driving an order that is actually fine is a cheap no-op.
//
// Wired to a Vercel cron (every minute) AND callable opportunistically by the
// dashboard. Gated by RECONCILE_SECRET (or the x-vercel-cron header) if set.

const TERMINAL = new Set(['delivered', 'generated', 'failed']);
const MAX_AGE_HOURS = 24;
const MAX_CANDIDATES = 25;
const TIME_BUDGET_MS = 45_000; // stay under the 60s function cap; leftovers wait for the next run

function authorized(req) {
  const secret = process.env.RECONCILE_SECRET;
  if (!secret) return true; // no secret configured → allow (stages are HMAC-guarded anyway)
  if (req.headers['x-vercel-cron']) return true;
  const provided = req.query?.key || req.headers['x-reconcile-key'];
  return provided === secret;
}

/** Decide which stage an order needs based on the artifacts that actually exist. */
async function nextStageFor(supabase, auditId) {
  const cache = await auditCache.getDetailed(auditId);
  if (!cache.hit || !cache.data) return null; // no audit data — can't generate
  const ins = cache.data.insights;
  const hasInsights = !!(ins && Array.isArray(ins.fixes) && ins.fixes.length);
  if (!hasInsights) return 'insights';

  // Insights exist — is the PDF in storage?
  let pdfExists = false;
  try {
    const { data } = await supabase.storage.from('reports').download(`${auditId}.pdf`);
    pdfExists = !!data;
  } catch { pdfExists = false; }
  return pdfExists ? 'email' : 'pdf';
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (!authorized(req)) return res.status(403).json({ error: 'forbidden' });

  const supabase = getSupabaseClient();
  if (!supabase) return res.json({ ok: false, reason: 'no_supabase' });

  const sinceIso = new Date(Date.now() - MAX_AGE_HOURS * 3600 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from('paid_reports')
    .select('audit_id, email, status, pdf_url, delivered_at, created_at')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) {
    console.error('[reconcile] query failed:', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }

  // An order is done if its status is terminal OR it has a delivery timestamp
  // (covers the case where a status write was blocked by the check constraint).
  const candidates = (rows || [])
    .filter(r => r.audit_id && !TERMINAL.has(r.status) && !r.delivered_at)
    .slice(0, MAX_CANDIDATES);

  console.log(`[reconcile] scanning ${rows?.length || 0} recent orders — ${candidates.length} non-terminal`);

  // Run the pipeline IN-PROCESS for each stuck order (idempotent — it resumes from
  // whatever artifact already exists). No fire-and-forget self-calls. Time-budgeted
  // so reconcile itself never exceeds the function cap; leftovers wait for next run.
  const { runReportPipeline } = require('./report');
  const started = Date.now();
  const actions = [];
  for (const r of candidates) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      console.log(`[reconcile] time budget reached — ${actions.length} processed, remainder deferred`);
      break;
    }
    const stage = await nextStageFor(supabase, r.audit_id);
    if (!stage) {
      actions.push({ auditId: r.audit_id, status: r.status, action: 'skip_no_audit_data' });
      continue;
    }
    try {
      const result = await runReportPipeline({ auditId: r.audit_id, email: r.email });
      actions.push({ auditId: r.audit_id, from: r.status, resumedAt: stage, insights: result.insights, pdf: result.pdf, emailSent: result.emailSent });
      console.log(`[reconcile] resumed auditId=${r.audit_id} emailSent=${result.emailSent}`);
    } catch (e) {
      actions.push({ auditId: r.audit_id, status: r.status, error: e.message });
      console.warn(`[reconcile] error auditId=${r.audit_id}:`, e.message);
    }
  }

  return res.json({ ok: true, scanned: rows?.length || 0, processed: actions.length, actions });
}

module.exports = handler;
