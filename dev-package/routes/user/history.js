'use strict';

require('../../lib/env');
const { getSupabaseClient } = require('../../lib/supabase-client');
const { requireAuth }       = require('../../lib/auth-middleware');

// GET /api/history — week-over-week metric series for trend charts.
async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  await new Promise((resolve, reject) =>
    requireAuth(req, res, err => err ? reject(err) : resolve())
  ).catch(() => {});
  if (res.headersSent) return;

  const supabase = getSupabaseClient();
  if (!supabase) return res.json({ ok: true, weeks: [] });

  try {
    const { data, error } = await supabase
      .from('dashboard_metrics')
      .select('week, visibility_score, google_score, ai_rank, review_count, rating')
      .eq('user_id', req.user.id)
      .order('week', { ascending: true })
      .limit(104);
    if (error) throw error;

    const weeks = (data || []).map((h, i) => ({
      weekNumber: i + 1,
      date:       h.week,
      overall:    h.visibility_score,
      google:     h.google_score,
      aiRank:     h.ai_rank,
      reviews:    h.review_count,
      rating:     h.rating,
    }));
    return res.json({ ok: true, weeks });
  } catch (err) {
    console.error('[history] error:', err.message);
    return res.status(500).json({ error: 'Could not load history' });
  }
}

module.exports = handler;
