'use strict';

/**
 * Monitor Alert Engine — week-over-week change detection.
 *
 * Pure functions that compare last week's snapshot to this week's and emit
 * notification objects per the Monitor spec rules:
 *   - Competitor gains 10+ reviews
 *   - Competitor adds photos
 *   - Your rating drops (possible negative reviews)
 *   - Your AI ranking falls
 *   - Your Google / visibility score decreases
 *   - Monthly campaign changes
 *
 * No DB, no IO → fully unit-testable. The cron persists whatever this returns.
 */

const COMPETITOR_REVIEW_THRESHOLD = 10;

function key(c) { return c && (c.placeId || c.place_id || String(c.name || '').toLowerCase().trim()); }
function num(v) { return typeof v === 'number' && !isNaN(v) ? v : 0; }

// Match competitors across two snapshots by placeId (preferred) or name.
function diffCompetitors(prevList, currList) {
  const prevByKey = {};
  (prevList || []).forEach(c => { const k = key(c); if (k) prevByKey[k] = c; });
  const changes = [];
  (currList || []).forEach(c => {
    const k = key(c); if (!k) return;
    const p = prevByKey[k];
    if (!p) return; // new competitor — not a "change" for alerting
    const reviewDelta = num(c.reviewCount) - num(p.reviewCount);
    const ratingDelta = +(num(c.rating) - num(p.rating)).toFixed(2);
    const photoDelta  = num(c.photoCount) - num(p.photoCount);
    changes.push({ name: c.name, placeId: key(c), reviewDelta, ratingDelta, photoDelta });
  });
  return changes;
}

/**
 * @param {object} prev  last week's snapshot (or null on first week)
 * @param {object} curr  this week's snapshot
 *   snapshot shape: { score, googleScore, aiRank, rating, reviewCount, competitors:[{name,placeId,rating,reviewCount,photoCount}] , campaign:{name} }
 * @returns {Array} notifications [{ type, severity, title, message, meta }]
 */
function detectAlerts(prev, curr) {
  const out = [];
  curr = curr || {};
  const push = (type, severity, title, message, meta) =>
    out.push({ type, severity, title, message, meta: meta || {} });

  // Competitor changes
  if (prev && prev.competitors) {
    diffCompetitors(prev.competitors, curr.competitors).forEach(ch => {
      if (ch.reviewDelta >= COMPETITOR_REVIEW_THRESHOLD) {
        push('competitor_reviews', 'warning',
          `${ch.name} gained ${ch.reviewDelta} reviews`,
          `${ch.name} added ${ch.reviewDelta} new reviews this week — they're actively collecting feedback.`,
          { name: ch.name, reviewDelta: ch.reviewDelta });
      }
      if (ch.photoDelta >= 5) {
        push('competitor_photos', 'info',
          `${ch.name} added ${ch.photoDelta} photos`,
          `${ch.name} uploaded ${ch.photoDelta} new photos — fresh media boosts their Google ranking.`,
          { name: ch.name, photoDelta: ch.photoDelta });
      }
      if (ch.ratingDelta >= 0.2) {
        push('competitor_rating', 'info',
          `${ch.name}'s rating is rising`,
          `${ch.name}'s rating climbed by ${ch.ratingDelta.toFixed(1)} stars this week.`,
          { name: ch.name, ratingDelta: ch.ratingDelta });
      }
    });
  }

  if (!prev) return out; // first week — no self deltas to compute

  // Your rating drop → possible negative reviews
  const ratingDrop = +(num(prev.rating) - num(curr.rating)).toFixed(2);
  if (ratingDrop >= 0.1) {
    push('rating_drop', 'critical',
      'Your rating dropped',
      `Your rating fell from ${num(prev.rating).toFixed(1)} to ${num(curr.rating).toFixed(1)} — check for new negative reviews and respond promptly.`,
      { from: num(prev.rating), to: num(curr.rating) });
  }

  // Your AI ranking fell (higher rank number = worse)
  if (num(prev.aiRank) > 0 && num(curr.aiRank) > num(prev.aiRank)) {
    push('ai_rank_fall', 'warning',
      'Your AI ranking slipped',
      `You moved from #${num(prev.aiRank)} to #${num(curr.aiRank)} in AI assistant results this week.`,
      { from: num(prev.aiRank), to: num(curr.aiRank) });
  }

  // Google score decreased
  if (num(curr.googleScore) > 0 && num(curr.googleScore) < num(prev.googleScore)) {
    push('google_score_drop', 'warning',
      'Your Google score decreased',
      `Your Google visibility score dropped from ${num(prev.googleScore)} to ${num(curr.googleScore)}.`,
      { from: num(prev.googleScore), to: num(curr.googleScore) });
  }

  // Overall visibility score decreased
  if (num(curr.score) > 0 && num(curr.score) < num(prev.score)) {
    push('visibility_drop', 'warning',
      'Overall visibility dropped',
      `Your overall visibility score went from ${num(prev.score)} to ${num(curr.score)} — review this week's report for the cause.`,
      { from: num(prev.score), to: num(curr.score) });
  }

  // Monthly campaign changed
  const prevCampaign = prev.campaign && prev.campaign.name;
  const currCampaign = curr.campaign && curr.campaign.name;
  if (currCampaign && currCampaign !== prevCampaign) {
    push('campaign_change', 'info',
      'New monthly campaign available',
      `This month's campaign is "${currCampaign}". A fresh content pack is ready in your dashboard.`,
      { campaign: currCampaign });
  }

  return out;
}

module.exports = { detectAlerts, diffCompetitors, COMPETITOR_REVIEW_THRESHOLD };
