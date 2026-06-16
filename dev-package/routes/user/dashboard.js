'use strict';

require('../../lib/env');
const { getSupabaseClient } = require('../../lib/supabase-client');
const { requireAuth }       = require('../../lib/auth-middleware');
const reportsStore          = require('../../lib/reports-store');
const { diffCompetitors }   = require('../../lib/monitor-alerts');
const { getCurrentCampaign } = require('../../lib/monthly-campaigns');

// Aggregated Monitor dashboard payload — one call powers the whole dashboard:
// current scores, week-over-week trend, competitor watchlist (with deltas),
// AI ranking, notifications, weekly tasks and the monthly content pack.
async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  await new Promise((resolve, reject) =>
    requireAuth(req, res, err => err ? reject(err) : resolve())
  ).catch(() => {});
  if (res.headersSent) return;

  const supabase = getSupabaseClient();
  const userId   = req.user.id;
  const email    = (req.user.email || '').toLowerCase();
  if (!supabase) return res.json({ ok: false, reason: 'supabase_not_configured' });

  try {
    // ── latest audit (source of truth for current AI scores + fallback) ──────
    const auditId = await latestAuditId(supabase, userId, email);
    let audit = {};
    if (auditId) {
      const { data: cache } = await supabase
        .from('audit_cache').select('audit_data').eq('cache_key', auditId).single();
      audit = (cache && cache.audit_data) || {};
    }
    const base = reportsStore.reportFromAuditData(auditId || 'none', audit);
    const ai = audit.aiVisibility || {};

    // ── parallel reads ───────────────────────────────────────────────────────
    const [profileR, snapsR, historyR, notifsR, tasksR, packR] = await Promise.all([
      supabase.from('profiles').select('name, plan').eq('id', userId).single(),
      supabase.from('competitor_snapshots').select('week, snapshot').eq('user_id', userId).order('week', { ascending: false }).limit(2),
      supabase.from('dashboard_metrics').select('week, visibility_score, google_score, ai_rank, review_count, rating').eq('user_id', userId).order('week', { ascending: true }).limit(52),
      supabase.from('notifications').select('id, type, severity, title, message, meta, read, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
      supabase.from('weekly_tasks').select('id, title, description, completed, week').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
      supabase.from('content_packs').select('month, campaign_name, campaign_theme, content').eq('user_id', userId).order('month', { ascending: false }).limit(1),
    ]);

    const snaps = snapsR.data || [];
    const currSnap = snaps[0] && snaps[0].snapshot;
    const prevSnap = snaps[1] && snaps[1].snapshot;

    // Review sentiment: prefer the latest weekly snapshot, fall back to the audit.
    const sentiment = (currSnap && currSnap.sentiment) || audit.sentiment || null;

    // Previous-week metrics + week-over-week change (explicit, for the dashboard).
    const round1 = n => (typeof n === 'number' ? Math.round(n * 10) / 10 : 0);
    const previous = prevSnap ? {
      overall: prevSnap.score || 0,
      rating:  prevSnap.rating || 0,
      reviews: prevSnap.reviewCount || 0,
    } : null;

    // Current scores: prefer the latest weekly snapshot, fall back to the audit.
    const score   = (currSnap && currSnap.score)   || base.score   || 0;
    const rating  = (currSnap && currSnap.rating)  || base.rating  || 0;
    const reviews = (currSnap && currSnap.reviewCount) || base.review_count || 0;
    const competitors = (currSnap && currSnap.competitors) || base.competitors || [];

    // Competitor watchlist with week-over-week deltas
    const deltas = (prevSnap && prevSnap.competitors)
      ? indexBy(diffCompetitors(prevSnap.competitors, competitors), 'placeId')
      : {};
    const watchlist = (competitors || []).slice(0, 3).map(c => {
      const k = c.placeId || c.place_id || String(c.name || '').toLowerCase().trim();
      const d = deltas[k] || {};
      return {
        name: c.name, rating: c.rating || 0, reviewCount: c.reviewCount || 0,
        photoCount: c.photoCount || 0, googleScore: c.googleScore || 0,
        reviewDelta: d.reviewDelta || 0, ratingDelta: d.ratingDelta || 0, photoDelta: d.photoDelta || 0,
      };
    });

    // Monthly content pack: stored one, else compute on the fly
    let contentPack = packR.data && packR.data[0]
      ? { month: packR.data[0].month, campaign: { name: packR.data[0].campaign_name, theme: packR.data[0].campaign_theme }, content: (packR.data[0].content || {}).contentPack || packR.data[0].content }
      : null;
    if (!contentPack) {
      const camp = getCurrentCampaign({ specialty: base.specialty, parentSpecialty: base.specialty, city: base.city, name: profileR.data && profileR.data.name, region: 'GLOBAL' });
      if (camp.hasCampaign) contentPack = { month: null, campaign: camp.campaign, content: camp.contentPack };
    }

    return res.json({
      ok: true,
      doctor: {
        name: (profileR.data && profileR.data.name) || base.doctor_name || null,
        plan: (profileR.data && profileR.data.plan) || null,
        specialty: base.specialty || null,
        city: base.city || null,
      },
      currentScore: {
        overall: score,
        google:  typeof ai.google === 'number' ? ai.google : (currSnap ? currSnap.googleScore : 0),
        chatgpt: typeof ai.chatgpt === 'number' ? ai.chatgpt : 0,
        gemini:  typeof ai.gemini === 'number' ? ai.gemini : 0,
        claude:  typeof ai.claude === 'number' ? ai.claude : 0,
        rating, reviews,
      },
      previousScore: previous,
      wow: previous ? {
        overall: (score || 0) - previous.overall,
        rating:  round1((rating || 0) - previous.rating),
        reviews: (reviews || 0) - previous.reviews,
      } : null,
      sentiment,
      trend: (historyR.data || []).map(h => ({
        week: h.week, overall: h.visibility_score, google: h.google_score,
        aiRank: h.ai_rank, reviews: h.review_count, rating: h.rating,
      })),
      competitors: watchlist,
      notifications: notifsR.data || [],
      tasks: tasksR.data || [],
      contentPack,
    });
  } catch (err) {
    console.error('[dashboard] error:', err.message);
    return res.status(500).json({ error: 'Could not load dashboard' });
  }
}

function indexBy(arr, key) { const o = {}; (arr || []).forEach(x => { if (x && x[key]) o[x[key]] = x; }); return o; }

// Most recent audit_id owned by this user (reports row, else paid_reports).
async function latestAuditId(supabase, userId, email) {
  const { data: rep } = await supabase.from('reports')
    .select('audit_id, created_at').eq('user_id', userId)
    .order('created_at', { ascending: false }).limit(1).single();
  if (rep && rep.audit_id) return rep.audit_id;
  const orFilter = email ? `user_id.eq.${userId},email.ilike.${email}` : `user_id.eq.${userId}`;
  const { data: paid } = await supabase.from('paid_reports')
    .select('audit_id, created_at').or(orFilter)
    .order('created_at', { ascending: false }).limit(1).single().then(r => r, () => ({ data: null }));
  return paid && paid.audit_id ? paid.audit_id : null;
}

module.exports = handler;
