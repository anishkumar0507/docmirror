'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Review sentiment analysis (Monitor plan).
//
// Given the recent Google reviews returned by places-client, ask Claude to
// extract a sentiment score, an overall label, and the dominant positive /
// negative themes. The returned shape matches the PDF placeholders in
// audit-helpers.js ({{SENTIMENT_*}}) — positive[], negative[], reviewThemes[] —
// so the same object feeds the PDF, the dashboard and the weekly snapshot.
//
// Always resolves (never throws): on any failure it returns an empty result so
// the weekly pipeline keeps running.
// ─────────────────────────────────────────────────────────────────────────────

const { runClaudePrompt } = require('./claude-client');

function emptyResult() {
  return {
    score: null,            // 0–100 overall positivity, null when unknown
    label: 'unknown',       // positive | mixed | negative | unknown
    positive: [],           // dominant praise themes (short phrases)
    negative: [],           // dominant complaint themes (short phrases)
    reviewThemes: [],       // neutral recurring topics
    summary: '',            // one-sentence human summary
    reviewsAnalyzed: 0,
    updatedAt: new Date().toISOString(),
  };
}

function clampList(v, n) {
  return Array.isArray(v) ? v.map(x => String(x || '').trim()).filter(Boolean).slice(0, n) : [];
}

function normalizeLabel(label, score) {
  const l = String(label || '').toLowerCase();
  if (l === 'positive' || l === 'mixed' || l === 'negative') return l;
  if (typeof score === 'number') return score >= 70 ? 'positive' : score >= 45 ? 'mixed' : 'negative';
  return 'unknown';
}

/**
 * @param {Array<{rating:number|null, text:string}>} reviews
 * @param {string} doctorName
 * @returns {Promise<object>} sentiment result (see emptyResult shape)
 */
async function analyzeSentiment(reviews, doctorName = '') {
  const texts = (Array.isArray(reviews) ? reviews : [])
    .map(r => `(${r && r.rating != null ? r.rating : '?'}★) ${String((r && r.text) || '').replace(/\s+/g, ' ').trim().slice(0, 400)}`)
    .filter(s => s.length > 4)
    .slice(0, 15);

  if (!texts.length) return emptyResult();
  if (!process.env.ANTHROPIC_API_KEY) return { ...emptyResult(), reviewsAnalyzed: texts.length };

  const prompt = `You are analysing real Google reviews for ${doctorName || 'a doctor'} to summarise patient sentiment.

Reviews (each prefixed with its star rating):
${texts.join('\n')}

Return ONLY valid JSON — no markdown, no extra text:
{
  "sentimentScore": <integer 0-100, overall positivity across all reviews>,
  "label": "positive" | "mixed" | "negative",
  "positiveThemes": ["short praise theme", "..."],
  "negativeThemes": ["short complaint theme", "..."],
  "reviewThemes": ["neutral recurring topic", "..."],
  "summary": "one sentence (max 22 words) summarising patient sentiment"
}
Each theme must be 1-4 words. Use [] when a category has nothing notable.`;

  try {
    const r = await runClaudePrompt(prompt, { label: 'sentiment', maxTokens: 500, useCache: false });
    const score = typeof r.sentimentScore === 'number'
      ? Math.max(0, Math.min(100, Math.round(r.sentimentScore)))
      : null;
    return {
      score,
      label: normalizeLabel(r.label, score),
      positive: clampList(r.positiveThemes, 6),
      negative: clampList(r.negativeThemes, 6),
      reviewThemes: clampList(r.reviewThemes, 6),
      summary: String(r.summary || '').trim().slice(0, 240),
      reviewsAnalyzed: texts.length,
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn('[sentiment] analyze warn:', err.message);
    return { ...emptyResult(), reviewsAnalyzed: texts.length };
  }
}

module.exports = { analyzeSentiment, emptyResult };
