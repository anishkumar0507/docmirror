'use strict';

require('../lib/env');
const { getSupabaseClient } = require('../lib/supabase-client');
const { generateReport }    = require('./report');

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return res.status(503).json({ ok: false, error: 'Supabase not configured' });
  }

  // Fetch all active Monitor subscribers
  const { data: subs, error } = await supabase
    .from('subscriptions')
    .select('user_id, razorpay_subscription_id')
    .eq('status', 'active');

  if (error) {
    console.error('[weekly-check] fetch subscriptions error:', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }

  if (!subs?.length) {
    console.log('[weekly-check] no active Monitor subscribers — nothing to do');
    return res.json({ ok: true, processed: 0 });
  }

  console.log(`[weekly-check] processing ${subs.length} active subscriber(s)`);

  // Respond immediately — generation is async
  res.json({ ok: true, processing: subs.length });

  // Run audits in the background (one per subscriber)
  for (const sub of subs) {
    try {
      // Fetch subscriber profile + last audit data
      const { data: profile } = await supabase
        .from('profiles')
        .select('email, name')
        .eq('id', sub.user_id)
        .single();

      if (!profile?.email) continue;

      const { data: lastReport } = await supabase
        .from('reports')
        .select('audit_id, doctor_name')
        .eq('user_id', sub.user_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!lastReport?.audit_id) {
        console.log(`[weekly-check] no previous report for user=${sub.user_id} — skipping`);
        continue;
      }

      // Re-generate report from cached audit data (full 9-prompt pipeline)
      console.log(`[weekly-check] generating weekly report for user=${sub.user_id} auditId=${lastReport.audit_id}`);
      const result = await generateReport({
        auditId: lastReport.audit_id,
        email:   profile.email,
        userId:  sub.user_id,
      });

      console.log(
        `[weekly-check] done user=${sub.user_id}  emailSent=${result.emailSent}  pdfUrl=${result.pdfUrl || '(none)'}`
      );

      // Record weekly metric snapshot
      const today = new Date().toISOString().slice(0, 10);
      await supabase.from('dashboard_metrics').upsert({
        user_id:          sub.user_id,
        week:             today,
        visibility_score: result.score        || null,
        review_count:     result.reviewCount  || null,
      }, { onConflict: 'user_id,week' }).catch(err =>
        console.warn('[weekly-check] metrics upsert warn:', err.message)
      );

    } catch (err) {
      console.error(`[weekly-check] error for user=${sub.user_id}:`, err.message);
    }
  }
}

module.exports = handler;
