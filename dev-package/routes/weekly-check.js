'use strict';

require('../lib/env');
const { getSupabaseClient } = require('../lib/supabase-client');
const { generateReport }    = require('./report');
const reportsStore          = require('../lib/reports-store');
const { getCurrentCampaign } = require('../lib/monthly-campaigns');
const { detectAlerts }       = require('../lib/monitor-alerts');
const { refreshDoctorData }  = require('../lib/places-client');
const { analyzeSentiment }   = require('../lib/sentiment');
const { computePillarsV5, verdictFromScore } = require('../lib/audit-helpers');

// Re-fetch LIVE Google Places data for this doctor and write the fresh metrics,
// competitors and review sentiment back into audit_cache.audit_data BEFORE the
// weekly report is generated. This is what makes week-over-week change real —
// without it every weekly run would reuse the original audit and all deltas
// would be zero. Fully guarded: any failure leaves the cached data untouched
// and the rest of the pipeline continues on last week's numbers.
async function refreshAuditData(supabase, auditId) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) { console.log('[weekly-check] GOOGLE_PLACES_API_KEY missing — skipping live refresh'); return; }

  try {
    const { data: cache } = await supabase
      .from('audit_cache').select('audit_data').eq('cache_key', auditId).single();
    const ad = (cache && cache.audit_data) || {};
    if (!ad.placeId) { console.log(`[weekly-check] no placeId for audit=${auditId} — skipping live refresh`); return; }

    const fresh = await refreshDoctorData({
      placeId:         ad.placeId,
      specialty:       ad.specialty || '',
      parentSpecialty: ad.parentSpecialty || ad.specialty || '',
      city:            ad.city || (ad.cityState || '').split(',')[0] || '',
    }, key);
    if (!fresh) { console.log(`[weekly-check] live refresh returned nothing for audit=${auditId}`); return; }

    // Recompute the visibility score from the fresh Google signals.
    const rawData = {
      doctorName:  ad.doctorName || '',
      rating:      fresh.rating,
      reviewCount: fresh.reviewCount,
      website:     fresh.website,
      address:     fresh.address,
      hasHours:    fresh.hasHours,
      photoCount:  fresh.photoCount,
      specialty:   ad.specialty || '',
      city:        ad.city || '',
      state:       ad.state || '',
      region:      ad.region || 'GLOBAL',
    };
    const pillars = computePillarsV5(rawData);
    const score   = pillars.total;
    const verdict = verdictFromScore(score);

    // Review sentiment from the freshly fetched reviews.
    const sentiment = await analyzeSentiment(fresh.reviews, ad.doctorName || '');

    const updated = {
      ...ad,
      rating:       fresh.rating,
      reviewCount:  fresh.reviewCount,
      website:      fresh.website,
      address:      fresh.address,
      hasHours:     fresh.hasHours,
      hoursText:    fresh.hoursText,
      isOpenNow:    fresh.isOpenNow,
      photoCount:   fresh.photoCount,
      businessName: fresh.businessName || ad.businessName,
      competitors:  fresh.competitors.length ? fresh.competitors : (ad.competitors || []),
      score,
      pillarTotal:  score,
      verdictLabel: verdict.label,
      verdictColor: verdict.color,
      pillars: {
        gmb: pillars.gmb, rating: pillars.rating, reviews: pillars.reviews,
        photos: pillars.photos, rank: pillars.rank,
        aiVisibility: pillars.aiVisibility, directories: pillars.directories,
      },
      sentiment,
      refreshedAt: new Date().toISOString(),
    };

    await supabase.from('audit_cache')
      .update({ audit_data: updated })
      .eq('cache_key', auditId)
      .catch(e => console.warn('[weekly-check] audit_cache update warn:', e.message));

    console.log(`[weekly-check] live refresh audit=${auditId} score=${score} reviews=${fresh.reviewCount} rating=${fresh.rating} sentiment=${sentiment.label}`);
  } catch (err) {
    console.warn(`[weekly-check] live refresh warn audit=${auditId}:`, err.message);
  }
}

// Build this week's snapshot (self metrics + competitors + sentiment) from the
// audit cache — audit_cache.audit_data is the source of truth (refreshed above).
async function buildSnapshot(supabase, auditId, profileName, campaign) {
  const { data: cache } = await supabase
    .from('audit_cache').select('audit_data').eq('cache_key', auditId).single();
  const ad = (cache && cache.audit_data) || {};
  const base = reportsStore.reportFromAuditData(auditId, ad);
  const ai = ad.aiVisibility || {};
  return {
    score:       base.score || 0,
    googleScore: typeof ai.google === 'number' ? ai.google : 0,
    aiRank:      typeof ad.aiRank === 'number' ? ad.aiRank : 0,
    rating:      base.rating || 0,
    reviewCount: base.review_count || 0,
    photoCount:  base.photo_count || 0,
    competitors: Array.isArray(base.competitors) ? base.competitors : [],
    sentiment:   ad.sentiment || null,
    specialty:   base.specialty || '',
    city:        base.city || '',
    pdfUrl:      base.pdf_url || null,
    campaign:    campaign && campaign.name ? { name: campaign.name } : null,
  };
}

// Persist snapshot, generate alerts, save content pack, write weekly metrics.
// Fully guarded — any failure here must NOT affect report/email delivery.
async function enrichMonitorData(supabase, userId, auditId, profile, pdfUrl) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const monthKey = today.slice(0, 7);

    // last week's snapshot BEFORE we write this week's
    const { data: prevRow } = await supabase
      .from('competitor_snapshots').select('snapshot')
      .eq('user_id', userId).order('week', { ascending: false }).limit(1).single();
    const prev = (prevRow && prevRow.snapshot) || null;

    // current campaign for this specialty/month (need specialty first)
    const { data: cachePeek } = await supabase
      .from('audit_cache').select('audit_data').eq('cache_key', auditId).single();
    const adPeek = (cachePeek && cachePeek.audit_data) || {};
    const campaign = getCurrentCampaign({
      specialty:       adPeek.specialty || '',
      parentSpecialty: adPeek.specialty || '',
      city:            adPeek.city || (adPeek.cityState || '').split(',')[0] || '',
      name:            profile.name || '',
      region:          'GLOBAL',
    });

    const curr = await buildSnapshot(supabase, auditId, profile.name, campaign.campaign);

    // alerts (week-over-week) → notifications feed
    const alerts = detectAlerts(prev, curr);
    if (alerts.length) {
      await supabase.from('notifications').insert(alerts.map(a => ({
        user_id: userId, type: a.type, severity: a.severity,
        title: a.title, message: a.message, meta: a.meta || {},
      }))).catch(e => console.warn('[weekly-check] notifications insert warn:', e.message));
    }

    // save this week's snapshot (full self+competitor blob, week-keyed)
    await supabase.from('competitor_snapshots').upsert({
      user_id: userId, week: today, snapshot: curr,
    }, { onConflict: 'user_id,week' }).catch(e => console.warn('[weekly-check] snapshot warn:', e.message));

    // canonical historical snapshot (monitor_snapshots — spec'd shape, incl. sentiment + alerts)
    await supabase.from('monitor_snapshots').upsert({
      user_id:          userId,
      week:             today,
      doctor_name:      profile.name || curr.specialty || null,
      review_count:     curr.reviewCount || null,
      rating:           curr.rating || null,
      visibility_score: curr.score || null,
      competitor_data:  curr.competitors || [],
      sentiment_data:   curr.sentiment || {},
      alerts:           alerts || [],
    }, { onConflict: 'user_id,week' }).catch(e => console.warn('[weekly-check] monitor_snapshot warn:', e.message));

    // monthly content pack (idempotent per month)
    if (campaign.hasCampaign) {
      await supabase.from('content_packs').upsert({
        user_id: userId, month: monthKey,
        campaign_name: campaign.campaign.name, campaign_theme: campaign.campaign.theme,
        content: campaign, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,month' }).catch(e => console.warn('[weekly-check] content_pack warn:', e.message));
    }

    // richer weekly metrics row (replaces the old undefined-field upsert)
    await supabase.from('dashboard_metrics').upsert({
      user_id: userId, week: today,
      visibility_score: curr.score || null,
      google_score:     curr.googleScore || null,
      ai_rank:          curr.aiRank || null,
      review_count:     curr.reviewCount || null,
      rating:           curr.rating || null,
      pdf_url:          pdfUrl || curr.pdfUrl || null,
    }, { onConflict: 'user_id,week' }).catch(e => console.warn('[weekly-check] metrics warn:', e.message));

    return { alerts: alerts.length, campaign: campaign.campaign ? campaign.campaign.name : null };
  } catch (err) {
    console.warn(`[weekly-check] enrich warn user=${userId}:`, err.message);
    return { alerts: 0, campaign: null };
  }
}

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

      // STEP 1: re-fetch LIVE Google Places data + sentiment into audit_cache so
      // the report and snapshot below reflect THIS week's real numbers.
      await refreshAuditData(supabase, lastReport.audit_id);

      // STEP 2: re-generate report from the (now refreshed) audit data (full 9-prompt pipeline)
      console.log(`[weekly-check] generating weekly report for user=${sub.user_id} auditId=${lastReport.audit_id}`);
      const result = await generateReport({
        auditId: lastReport.audit_id,
        email:   profile.email,
        userId:  sub.user_id,
      });

      console.log(
        `[weekly-check] done user=${sub.user_id}  emailSent=${result.emailSent}  pdfUrl=${result.pdfUrl || '(none)'}`
      );

      // Snapshot + alerts + content pack + weekly metrics (guarded, non-fatal)
      const enriched = await enrichMonitorData(
        supabase, sub.user_id, lastReport.audit_id, profile, result.pdfUrl
      );
      console.log(`[weekly-check] enriched user=${sub.user_id}  alerts=${enriched.alerts}  campaign=${enriched.campaign || '(none)'}`);

    } catch (err) {
      console.error(`[weekly-check] error for user=${sub.user_id}:`, err.message);
    }
  }
}

module.exports = handler;
