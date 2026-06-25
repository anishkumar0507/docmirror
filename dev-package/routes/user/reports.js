'use strict';

require('../../lib/env');
const { getSupabaseClient } = require('../../lib/supabase-client');
const { requireAuth } = require('../../lib/auth-middleware');
const reportsStore = require('../../lib/reports-store');

// ─────────────────────────────────────────────────────────────────────────────
// Returns the authenticated user's reports, fully populated.
//
// The reports TABLE is unreliable in the live DB (writes historically failed due to
// a missing unique constraint), so audit_cache.audit_data is treated as the source of
// truth. For every audit_id the user paid for, we synthesize a complete report object
// from audit_cache (score, reviews, rating, competitors, insights, …) and overlay any
// pdf_url / stored fields from the reports + paid_reports tables. Missing reports rows
// are healed in the background so the table converges to correct state.
// ─────────────────────────────────────────────────────────────────────────────

// In-memory throttle so repeated polls on a warm instance don't each spawn a
// pipeline. Best-effort (per-instance); the pipeline is idempotent regardless.
const _backstopAt = new Map();
function shouldBackstop(auditId) {
  const now = Date.now();
  const last = _backstopAt.get(auditId) || 0;
  if (now - last < 120_000) return false;
  _backstopAt.set(auditId, now);
  return true;
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  await new Promise((resolve, reject) =>
    requireAuth(req, res, err => err ? reject(err) : resolve())
  ).catch(() => {});
  if (res.headersSent) return;

  const supabase  = getSupabaseClient();
  const userId    = req.user.id;
  const userEmail = (req.user.email || '').toLowerCase();

  if (!supabase) return res.json([]);

  try {
    // ── 1. Collect audit_ids belonging to this user ──────────────────────────
    const auditIds = new Set();
    const pdfByAudit   = {};   // audit_id → pdf_url
    const dateByAudit  = {};   // audit_id → created_at
    const rowByAudit   = {};   // audit_id → existing reports row

    // 1a. reports already linked by user_id
    const { data: ownedRows } = await supabase
      .from('reports')
      .select(reportsStore.SELECT_FIELDS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);
    (ownedRows || []).forEach(r => {
      if (!r.audit_id) return;
      auditIds.add(r.audit_id);
      rowByAudit[r.audit_id] = r;
      if (r.pdf_url) pdfByAudit[r.audit_id] = r.pdf_url;
      if (r.created_at) dateByAudit[r.audit_id] = r.created_at;
    });

    // 1b. paid_reports for this user (by user_id OR email) — covers anonymous $19 buys
    //     and monitor first reports, and lets us backfill/link.
    const orFilter = userEmail
      ? `user_id.eq.${userId},email.ilike.${userEmail}`
      : `user_id.eq.${userId}`;
    const { data: paidRows } = await supabase
      .from('paid_reports')
      .select('audit_id, email, pdf_url, status, user_id, created_at')
      .or(orFilter)
      .order('created_at', { ascending: false })
      .limit(100);
    (paidRows || []).forEach(p => {
      if (!p.audit_id) return;
      auditIds.add(p.audit_id);
      if (p.pdf_url && !pdfByAudit[p.audit_id]) pdfByAudit[p.audit_id] = p.pdf_url;
      if (p.created_at && !dateByAudit[p.audit_id]) dateByAudit[p.audit_id] = p.created_at;
    });

    if (auditIds.size === 0) return res.json([]);

    const ids = [...auditIds];

    // ── 2. Load audit_cache (source of truth for scores/competitors/insights) ─
    const { data: cacheRows } = await supabase
      .from('audit_cache')
      .select('cache_key, audit_data, created_at')
      .in('cache_key', ids);
    const cacheByAudit = {};
    (cacheRows || []).forEach(c => { cacheByAudit[c.cache_key] = c; });

    // ── 3. Build complete report objects ─────────────────────────────────────
    const reports = ids.map(id => {
      const cache = cacheByAudit[id];
      const ad    = cache ? (cache.audit_data || {}) : {};
      const row   = rowByAudit[id] || {};

      const base = reportsStore.reportFromAuditData(id, ad);
      const created_at =
        dateByAudit[id] || (cache && cache.created_at) || row.created_at || new Date().toISOString();

      // Multi-platform visibility scores — read straight from the audit's existing
      // aiVisibility data (same source the AI Rank Tracker uses). Never fabricated:
      // a platform with no stored value stays null so the UI shows "Pending".
      const ai = ad.aiVisibility || {};
      const overall = row.score != null ? row.score : base.score;
      const num = v => (typeof v === 'number' && !isNaN(v)) ? v : null;

      return {
        id:           row.id || id,
        audit_id:     id,
        doctor_name:  row.doctor_name  || base.doctor_name,
        score:        overall,
        overall_score: overall,
        google_score:  num(ai.google),
        chatgpt_score: num(ai.chatgpt),
        gemini_score:  num(ai.gemini),
        claude_score:  num(ai.claude),
        review_count: row.review_count != null ? row.review_count : base.review_count,
        rating:       row.rating       != null ? row.rating       : base.rating,
        photo_count:  row.photo_count  != null ? row.photo_count  : base.photo_count,
        specialty:    row.specialty    || base.specialty,
        city:         row.city         || base.city,
        competitors:  (Array.isArray(row.competitors) && row.competitors.length) ? row.competitors : base.competitors,
        pdf_url:      pdfByAudit[id]   || row.pdf_url || null,
        insights:     ad.insights      || null,
        created_at,
      };
    }).filter(r => r.score != null || r.doctor_name)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // ── 4. Self-heal + link (fire-and-forget — never block the response) ──────
    healAndLink(supabase, userId, userEmail, reports, rowByAudit);

    // ── 4b. Hobby-plan backstop (no cron): if the newest paid report still has
    // no AI insights AND it's old enough that the original pipeline should have
    // finished, resume it in the background of this poll. Gated by an age check
    // (don't race the in-flight run) and an in-memory throttle (each poll is a
    // fresh Vercel invocation, so runOncePerUser can't dedupe across them).
    const newest = reports[0];
    if (newest && newest.audit_id && !newest.insights) {
      const ageMs = Date.now() - new Date(newest.created_at || 0).getTime();
      if (ageMs > 90_000 && shouldBackstop(newest.audit_id)) {
        try {
          const { afterResponse } = require('../../lib/after-response');
          const { runReportPipeline } = require('../report');
          console.log(`[user/reports] backstop resuming stuck order auditId=${newest.audit_id} ageMs=${ageMs}`);
          afterResponse(
            () => runReportPipeline({ auditId: newest.audit_id, email: userEmail || newest.email, userId }),
            `poll-resume:${newest.audit_id}`
          );
        } catch (e) { console.warn('[user/reports] backstop trigger warn:', e.message); }
      }
    }

    return res.json(reports.slice(0, 50));
  } catch (err) {
    console.error('[user/reports] error:', err.message);
    return res.status(500).json({ error: 'Could not load reports' });
  }
}

/** Background: ensure reports rows exist + linked to this user; upgrade plan. */
function healAndLink(supabase, userId, userEmail, reports, rowByAudit) {
  Promise.resolve().then(async () => {
    try {
      for (const r of reports) {
        const existing = rowByAudit[r.audit_id];
        if (!existing) {
          // Create the missing reports row from synthesized data
          await reportsStore.upsertReport(supabase, {
            audit_id: r.audit_id, user_id: userId, doctor_name: r.doctor_name,
            score: r.score, review_count: r.review_count, rating: r.rating,
            photo_count: r.photo_count, specialty: r.specialty, city: r.city,
            competitors: r.competitors, pdf_url: r.pdf_url,
          });
        } else if (!existing.user_id) {
          await supabase.from('reports').update({ user_id: userId }).eq('audit_id', r.audit_id);
        }
      }

      // Link orphan paid_reports by email
      if (userEmail) {
        await supabase.from('paid_reports')
          .update({ user_id: userId })
          .ilike('email', userEmail).is('user_id', null);
      }

      // Upgrade plan free → audit if they have any paid report
      if (reports.length > 0) {
        await supabase.from('profiles')
          .update({ plan: 'audit', updated_at: new Date().toISOString() })
          .eq('id', userId).eq('plan', 'free');
      }
    } catch (e) {
      console.warn('[user/reports] heal warn:', e.message);
    }
  });
}

module.exports = handler;
