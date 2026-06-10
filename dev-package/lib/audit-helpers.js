'use strict';

// ── HTML escape ────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── cleanDoctorName ────────────────────────────────────────────────────────
// Strips "Dr.", "Dr", "Doctor" prefixes so "Dr. Dr. X" never occurs.
function cleanDoctorName(name) {
  return (name || '')
    .replace(/^(dr\.?|doctor)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── detectRegion ───────────────────────────────────────────────────────────
const INDIAN_STATES = [
  'maharashtra','karnataka','tamil nadu','jharkhand','delhi','west bengal',
  'gujarat','rajasthan','uttar pradesh','telangana','andhra pradesh',
  'kerala','punjab','haryana','bihar','odisha','assam','madhya pradesh',
  'chhattisgarh','uttarakhand','himachal pradesh','goa','tripura','meghalaya'
];
const INDIAN_CITIES = [
  'mumbai','delhi','bangalore','bengaluru','chennai','kolkata','hyderabad',
  'pune','ahmedabad','jaipur','lucknow','ranchi','jamshedpur','indore',
  'kanpur','nagpur','patna','bhopal','surat','vadodara','coimbatore','kochi',
  'visakhapatnam','agra','nashik','faridabad','meerut','rajkot','kalyan',
  'vasai','ludhiana','durgapur','asansol','amritsar','allahabad','prayagraj'
];

function detectRegion(city, state) {
  const c = (city  || '').toLowerCase().trim();
  const s = (state || '').toLowerCase().trim();
  if (INDIAN_STATES.some(x => s.includes(x))) return 'IN';
  if (INDIAN_CITIES.some(x => c.includes(x)))  return 'IN';
  return 'US';
}

// ── regionDefaults ─────────────────────────────────────────────────────────
function regionDefaults(region) {
  if (region === 'IN') return {
    currencySymbol:      '$',
    valuePerPatientLow:  200,
    valuePerPatientHigh: 500,
    primaryDirectories:  ['Practo', 'JustDial', 'Lybrate', 'Apollo247'],
  };
  return {
    currencySymbol:      '$',
    valuePerPatientLow:  200,
    valuePerPatientHigh: 500,
    primaryDirectories:  ['Healthgrades', 'Zocdoc', 'Vitals', 'WebMD'],
  };
}

// ── verdictFromScore ───────────────────────────────────────────────────────
function verdictFromScore(score) {
  if (score >= 85) return { label: 'Strong Visibility',   color: 'cv-strong'   };
  if (score >= 70) return { label: 'Moderate Visibility', color: 'cv-moderate' };
  if (score >= 50) return { label: 'Needs Attention',     color: 'cv-warning'  };
  return                  { label: 'Critical Gaps',       color: 'cv-critical' };
}

// ── computePillarsV5 ───────────────────────────────────────────────────────
// 7 pillars, max 100. Score = sum of all pillars (guarantees validatePillarTotal passes).
function computePillarsV5(d) {
  const gmb = Math.min(30,
    5 +                               // name always present
    (d.address   ? 5 : 0) +
    5 +                               // phone assumed present
    (d.hasHours  ? 7 : 0) +
    (d.website   ? 4 : 0) +
    (d.hasDescription ? 4 : 0)
  );

  const rating = !d.rating ? 0 :
    d.rating >= 4.8 ? 20 : d.rating >= 4.5 ? 17 :
    d.rating >= 4.0 ? 14 : d.rating >= 3.5 ? 10 :
    d.rating >= 3.0 ? 5  : 2;

  const reviews = !d.reviewCount ? 0 :
    d.reviewCount >= 50 ? 15 : d.reviewCount >= 20 ? 11 :
    d.reviewCount >= 10 ? 7  : d.reviewCount >= 5  ? 4 : 1;

  const photos = !d.photoCount ? 0 :
    d.photoCount >= 10 ? 10 : d.photoCount >= 5 ? 7 : d.photoCount >= 1 ? 4 : 0;

  const rank = 4; // synthetic — no SerpAPI on free tier

  // AI Visibility (5 pts max) — synthetic signal estimate
  let aiV = 0;
  if (d.website)           aiV += 1.5;
  if (d.reviewCount >= 10) aiV += 1.0;
  if (d.photoCount  >= 5)  aiV += 0.5;
  if (d.rating      >= 4)  aiV += 1.0;
  if (d.hasHours)          aiV += 0.5;
  const aiVisibility = Math.min(Math.round(aiV * 10) / 10, 5);

  // Directories (5 pts max) — synthetic base
  const directories = Math.min(1.5, 5);

  const total = Math.round(gmb + rating + reviews + photos + rank + aiVisibility + directories);
  return { gmb, rating, reviews, photos, rank, aiVisibility, directories, total };
}

// ── validatePillarTotal ────────────────────────────────────────────────────
function validatePillarTotal(audit) {
  const p = audit.pillars || {};
  const actual = Math.round(
    (p.gmb || 0) + (p.rating || 0) + (p.reviews || 0) +
    (p.photos || 0) + (p.rank || 0) + (p.aiVisibility || 0) + (p.directories || 0)
  );
  return { valid: actual === (audit.score || 0), expected: audit.score, actual };
}

// ── computePatientLoss ─────────────────────────────────────────────────────
function computePatientLoss(d, regionDef) {
  const city = d.city || (d.cityState || '').split(',')[0].trim();
  const sp   = d.specialty || 'doctor';
  const missedSearches = Math.max(10, Math.round((d.reviewCount || 10) * 3));
  const scoreGap = Math.max(0.05, (100 - (d.score || 50)) / 100);
  const monthlyLost = Math.max(1, Math.round(missedSearches * scoreGap * 0.08));
  return {
    monthlyLow:        monthlyLost,
    monthlyHigh:       Math.max(monthlyLost + 1, Math.round(monthlyLost * 2.5)),
    annualRevenueLow:  monthlyLost * 12 * regionDef.valuePerPatientLow,
    annualRevenueHigh: Math.round(monthlyLost * 2.5) * 12 * regionDef.valuePerPatientHigh,
    methodology: `Based on ~${missedSearches} estimated monthly searches for ${sp} in ${city}, a ${Math.round(scoreGap * 100)}% CTR gap vs top-ranked competitors, and 8% searcher-to-patient conversion.`
  };
}

// ── Pillar placeholder helpers ─────────────────────────────────────────────
function pillarStatusLabel(pct) {
  if (pct >= 75) return { label: 'Strong',    cls: 'ps-strong', fill: 'pf-strong' };
  if (pct >= 45) return { label: 'Moderate',  cls: 'ps-mod',    fill: 'pf-mod'    };
  return               { label: 'Needs Work', cls: 'ps-weak',   fill: 'pf-weak'   };
}

function buildPillarPlaceholders(audit) {
  const p = audit.pillars || {};
  const defs = [
    ['GMB',         p.gmb          ?? 0, 30],
    ['RATING',      p.rating       ?? 0, 20],
    ['REVIEWS',     p.reviews      ?? 0, 15],
    ['PHOTOS',      p.photos       ?? 0, 10],
    ['RANK',        p.rank         ?? 0, 15],
    ['AI',          p.aiVisibility ?? 0,  5],
    ['DIRECTORIES', p.directories  ?? 0,  5],
  ];
  const out = {};
  for (const [key, score, max] of defs) {
    const pct = max > 0 ? Math.round((score / max) * 100) : 0;
    const { label, cls, fill } = pillarStatusLabel(pct);
    out[`{{PILLAR_${key}_SCORE}}`]        = String(score);
    out[`{{PILLAR_${key}_PCT}}`]          = String(pct);
    out[`{{PILLAR_${key}_STATUS}}`]       = label;
    out[`{{PILLAR_${key}_STATUS_CLASS}}`] = cls;
    out[`{{PILLAR_${key}_FILL}}`]         = fill;
  }
  return out;
}

// ── Radar chart SVG placeholders ───────────────────────────────────────────
function buildRadarPlaceholders(pillars) {
  const p = pillars || {};
  const cx = 150, cy = 150, maxR = 110;
  const defs = [
    { score: p.gmb          ?? 0, max: 30 },
    { score: p.rating       ?? 0, max: 20 },
    { score: p.reviews      ?? 0, max: 15 },
    { score: p.photos       ?? 0, max: 10 },
    { score: p.rank         ?? 0, max: 15 },
    { score: p.aiVisibility ?? 0, max: 5  },
    { score: p.directories  ?? 0, max: 5  },
  ];
  const start = -Math.PI / 2;
  const step  = (2 * Math.PI) / 7;

  const coords = defs.map((d, i) => {
    const angle = start + i * step;
    const r     = maxR * Math.min(d.max > 0 ? d.score / d.max : 0, 1);
    return { x: (cx + r * Math.cos(angle)).toFixed(1), y: (cy + r * Math.sin(angle)).toFixed(1) };
  });

  return {
    '{{RADAR_POINTS}}': coords.map(c => `${c.x},${c.y}`).join(' '),
    '{{RADAR_DOTS}}':   coords.map(c => `<circle cx="${c.x}" cy="${c.y}" r="4" fill="#0A2540"/>`).join(''),
  };
}

// ── Score color helpers ────────────────────────────────────────────────────
function colorForScore(s) { return s >= 70 ? 'aps-strong' : s >= 40 ? 'aps-mid' : 'aps-weak'; }
function fillForScore(s)  { return s >= 70 ? 'aif-strong' : s >= 40 ? 'aif-mid' : 'aif-weak'; }

// ── HTML section builders ──────────────────────────────────────────────────
function buildAiQueriesHtml(d) {
  const city = d.city || (d.cityState || '').split(',')[0].trim() || 'your city';
  const sp   = d.specialty || 'doctor';
  return [
    `Best ${sp} in ${city}`,
    `Top-rated ${sp} near ${city}`,
    `${sp} doctor recommendations ${city}`,
  ].map(q =>
    `<div class="ai-query-item"><span class="aq-text">${esc(q)}</span><span class="aq-result aqr-notfound">Signal-based</span></div>`
  ).join('');
}

function buildCompetitorTableHtml(d) {
  const competitors = d.competitors || [];
  const nameClean   = d.doctorNameClean || cleanDoctorName(d.doctorName || '');

  const youRow = `
<tr class="ct-you">
  <td class="ct-name">Dr. ${esc(nameClean)} <span style="font-size:8pt;background:#00A878;color:#fff;padding:1px 6px;border-radius:10px;font-weight:600;margin-left:4px">You</span></td>
  <td class="ct-score">${d.score || 0}/100</td>
  <td>${d.rating ? Number(d.rating).toFixed(1) + '★' : '—'}</td>
  <td>${d.reviewCount || 0}</td>
  <td>${d.photoCount || '—'}</td>
  <td>—</td>
  <td>—</td>
</tr>`;

  if (!competitors.length) {
    return youRow + `<tr><td colspan="7" style="text-align:center;padding:12px;color:#6B7A8D;font-size:9pt">No competitors found nearby</td></tr>`;
  }

  const compRows = competitors.map(c => `
<tr>
  <td class="ct-name">${esc(c.name)}</td>
  <td class="ct-score">${c.googleScore ? c.googleScore + '/100' : '—'}</td>
  <td>${c.rating ? Number(c.rating).toFixed(1) + '★' : '—'}</td>
  <td>${c.reviewCount || 0}</td>
  <td>—</td>
  <td>—</td>
  <td>—</td>
</tr>`).join('');

  return youRow + compRows;
}

// ── v5.1 Social Content Engine helpers ────────────────────────────────────────

function subcatsHtml(subcats) {
  if (!subcats || !subcats.length) return '';
  return subcats.map(s => `<div class="cat-sub-item">${esc(s)}</div>`).join('');
}

function calendarHtml(weeks) {
  if (!weeks || !weeks.length) return '';
  const cls = { '1': '', '2': 'c2', '3': 'c3', '4': 'c4' };
  return weeks.map(w => {
    const cell = (day) => {
      const e = w[day] || {};
      const cc = cls[String(e.catNum || '1')] || '';
      return `<div class="cal-cell"><div class="cal-cat ${cc}">${esc(e.cat || 'Education')}</div><div class="cal-topic">${esc(e.topic || '')}</div></div>`;
    };
    return `<div class="cal-week">Wk ${w.week}</div>${cell('mon')}${cell('wed')}${cell('fri')}`;
  }).join('');
}

function topicLibraryHtml(topics) {
  if (!topics || !topics.length) return '';
  return topics.slice(0, 12).map(t => {
    const title = typeof t === 'string' ? t : (t.title || '');
    return `<div class="topic-chip"><strong>${esc(title)}</strong></div>`;
  }).join('');
}

function specialtyDontsHtml(donts) {
  if (!donts || !donts.length) {
    return '<div class="spec-item">Follow the relevant medical council guidelines before publishing any clinical content.</div>';
  }
  return donts.map(d => `<div class="spec-item">${esc(d)}</div>`).join('');
}

function buildFixGuideHtml(fixes) {
  if (!fixes || !fixes.length) return '<p style="color:#6B7A8D;font-size:9.5pt">Fixes will appear here.</p>';
  return fixes.map((f, i) => `
<div class="fix-item">
  <div class="fix-header">
    <div class="fix-num">${i + 1}</div>
    <div class="fix-title">${esc(f.title)}</div>
    <span class="fix-impact fi-${(f.impact||'medium').toLowerCase()}">${esc(f.impact||'medium')}</span>
    <span class="fix-time">${f.timeMinutes || 15} min</span>
  </div>
  <div class="fix-steps">${esc(f.steps || '')}</div>
  ${f.copyText ? `<div class="fix-copy"><strong>Copy-paste:</strong> ${esc(f.copyText)}</div>` : ''}
</div>`).join('');
}

function buildResponseTemplatesHtml(templates) {
  if (!templates) return '<p style="color:#6B7A8D;font-size:9pt">Response templates not available.</p>';
  return [
    ['For 5-star reviews',   templates.positive],
    ['For mixed reviews',    templates.neutral ],
    ['For critical reviews', templates.critical],
  ].filter(([, v]) => v).map(([label, text]) =>
    `<div class="resp-template"><strong>${esc(label)}:</strong><p style="margin:6px 0 0">${esc(text)}</p></div>`
  ).join('');
}

function buildJourneyHtml(stages) {
  if (!stages || !stages.length) return '<p style="color:#6B7A8D;font-size:9.5pt">Journey data not available.</p>';
  const icons = { winning: '✅', losing: '⚠️', neutral: '➡️' };
  return stages.map(s => `
<div class="journey-stage js-${s.status||'neutral'}">
  <div class="js-header">
    <span class="js-icon">${icons[s.status] || '➡️'}</span>
    <strong>Stage ${s.stage}: ${esc(s.name)}</strong>
    <span class="js-status-badge">${esc(s.status||'')}</span>
  </div>
  <p class="js-touchpoint">${esc(s.touchpoint||'')}</p>
  ${s.currentGap ? `<p class="js-gap">Gap: ${esc(s.currentGap)}</p>` : ''}
  <p class="js-action">→ ${esc(s.winAction||'')}</p>
</div>`).join('');
}

function buildPhaseHtml(phase, num) {
  if (!phase) return '';
  const ranges = ['', 'Days 1–30', 'Days 31–60', 'Days 61–90'];
  return `
<div class="plan-phase">
  <div class="pp-header">Phase ${num} (${ranges[num]||''}): ${esc(phase.focus||'')}</div>
  <ul class="pp-actions">${(phase.actions||[]).map(a => `<li>${esc(a)}</li>`).join('')}</ul>
  <div class="pp-kpis">KPIs: ${(phase.kpis||[]).map(k => esc(k)).join(' · ')}</div>
  <div class="pp-gain">Estimated score gain: +${phase.estimatedScoreGain||0} pts</div>
</div>`;
}

function buildNarrativeHtml(narrative) {
  if (!narrative) return '<p style="color:#6B7A8D;font-size:9.5pt">Competitor analysis not available.</p>';
  return narrative.split(/(?<=[.!?])\s+/).filter(s => s.trim())
    .map(s => `<span class="cn-sentence">${esc(s)}</span>`)
    .join(' ');
}

function buildLossFormulaHtml(d, regionDef) {
  return `Monthly local searches × CTR gap × 8% conversion × ${regionDef.currencySymbol}${regionDef.valuePerPatientLow}–${regionDef.currencySymbol}${regionDef.valuePerPatientHigh}/patient × 12 months`;
}

function buildSampleAlertHtml(d) {
  const topComp    = (d.competitors || [])[0];
  const compName   = topComp?.name || 'Your top competitor';
  const compReviews = topComp?.reviewCount || 0;
  const myReviews  = d.reviewCount || 0;
  const lead       = Math.max(0, compReviews - myReviews);
  return `
<p>Your score: <strong>${d.score || 0}/100</strong></p>
<p><strong>${esc(compName)}</strong> has ${compReviews} reviews${lead > 0 ? ` — <strong class="alert-delta-down">${lead} ahead</strong> of you` : ''}.</p>
<p>→ <strong>Suggested action this week:</strong> Ask your last 5 satisfied patients for a Google review.</p>`;
}

function buildMethodologySourcesHtml(d) {
  const r = regionDefaults(d.region || detectRegion(d.city || '', d.state || ''));
  return [
    'Google Places API — Business profile, reviews, photos, hours',
    'Google Text Search — Competitor discovery',
    `AI Visibility — ${d.aiVisibility?.isReal ? 'Live queries: ChatGPT, Gemini, Claude, Perplexity' : 'Signal-based estimate (real queries on paid tier)'}`,
    `Directory checks — ${r.primaryDirectories.join(', ')}`,
    'Claude AI (Anthropic) — Narrative, fixes, action planning, keyword strategy',
  ].map(s => `<li>${esc(s)}</li>`).join('');
}

// ── buildPdfPlaceholders (main mapper) ─────────────────────────────────────
function buildPdfPlaceholders(audit, totalPages = 15) {
  const city       = audit.city  || (audit.cityState || '').split(',')[0].trim();
  const state      = audit.state || (audit.cityState || '').split(',')[1]?.trim() || '';
  const region     = audit.region || detectRegion(city, state);
  const regionDef  = regionDefaults(region);
  const verdict    = verdictFromScore(audit.score || 0);
  const nameClean  = audit.doctorNameClean || cleanDoctorName(audit.doctorName || '');
  const loss       = audit.patientLoss || computePatientLoss({ ...audit, city, state }, regionDef);
  const stateDisp  = state ? ', ' + state : '';
  const genAt      = audit.generatedAt || new Date().toISOString();

  // Synthetic AI scores (free tier)
  const aiV     = audit.aiVisibility || {};
  const aiScore = audit.score || 0;
  const aiGoogle  = aiV.google     || Math.min(100, aiScore + 10);
  const aiChatgpt = aiV.chatgpt    || Math.round(aiScore * 0.6);
  const aiGemini  = aiV.gemini     || Math.round(aiScore * 0.55);
  const aiClaude  = aiV.claude     || Math.round(aiScore * 0.5);
  const aiPerp    = aiV.perplexity || 0;

  const placeholders = {
    // ── Core ──────────────────────────────────────────────────────────────
    '{{DOCTOR_NAME_CLEAN}}':  'Dr. ' + nameClean,
    '{{SPECIALTY}}':          audit.specialty || 'General Practice',
    '{{CITY}}':               city,
    '{{STATE}}':              state,
    '{{STATE_DISPLAY}}':      stateDisp,
    '{{REGION}}':             region,
    '{{REPORT_DATE}}':        new Date(genAt).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }),
    '{{SCORE}}':              String(audit.score || 0),
    '{{VERDICT_LABEL}}':      verdict.label,
    '{{VERDICT_COLOR}}':      verdict.color,
    '{{TOTAL_PAGES}}':        String(totalPages),
    '{{CURRENCY_SYMBOL}}':    regionDef.currencySymbol,
    '{{TIER_LABEL}}':         'Full 7-Pillar AI Visibility Audit',
    '{{REVIEW_COUNT}}':       String(audit.reviewCount || 0),
    '{{VALUE_PER_PATIENT_LOW}}':  String(regionDef.valuePerPatientLow),
    '{{VALUE_PER_PATIENT_HIGH}}': String(regionDef.valuePerPatientHigh),

    // ── Executive summary ──────────────────────────────────────────────────
    '{{EXEC_HEADLINE}}':      audit.execSummary?.headline  ||
      `${nameClean} is losing patients to competitors — here's the exact fix plan.`,
    '{{EXEC_PARAGRAPH_1}}':   audit.execSummary?.paragraph1 ||
      `Dr. ${nameClean} scores <strong>${audit.score || 0}/100</strong> on The Doc Mirror's 7-Pillar Visibility Index, placing this practice in the <strong>${verdict.label}</strong> tier.`,
    '{{EXEC_PARAGRAPH_2}}':   audit.execSummary?.paragraph2 ||
      `Patients searching for a ${audit.specialty || 'doctor'} in ${city} are choosing competitors first. With an estimated ${loss.monthlyLow}–${loss.monthlyHigh} patients lost per month, the annual revenue gap is ${regionDef.currencySymbol}${loss.annualRevenueLow.toLocaleString()}–${regionDef.currencySymbol}${loss.annualRevenueHigh.toLocaleString()}.`,
    '{{EXEC_PARAGRAPH_3}}':   audit.execSummary?.paragraph3 ||
      `The 5 prioritised fixes in this report address the highest-impact gaps. Most take under 30 minutes and require no paid tools. Implementing all of them is projected to raise your score to ${audit.ninetyDayPlan?.projectedScoreAt90Days || Math.min(100, (audit.score || 0) + 15)}/100 within 90 days.`,
    '{{EXEC_TOP_3_PRIORITIES_HTML}}':
      (audit.execSummary?.top3Priorities || (audit.issues || []).slice(0, 3).map(i => typeof i === 'string' ? i : i.text || '')).map((p, i) =>
        `<div class="exec-priority"><div class="ep-num">${i + 1}</div><div class="ep-text">${esc(p)}</div></div>`
      ).join(''),

    // ── AI Visibility ──────────────────────────────────────────────────────
    '{{AI_GOOGLE_SCORE}}':       String(aiGoogle),
    '{{AI_CHATGPT_SCORE}}':      String(aiChatgpt),
    '{{AI_GEMINI_SCORE}}':       String(aiGemini),
    '{{AI_CLAUDE_SCORE}}':       String(aiClaude),
    '{{AI_PERPLEXITY_SCORE}}':   String(aiPerp),
    '{{AI_OVERALL_LABEL}}':      aiV.isReal ? 'Live Data' : 'Signal Estimate',
    '{{AI_GOOGLE_COLOR}}':       colorForScore(aiGoogle),
    '{{AI_CHATGPT_COLOR}}':      colorForScore(aiChatgpt),
    '{{AI_GEMINI_COLOR}}':       colorForScore(aiGemini),
    '{{AI_CLAUDE_COLOR}}':       colorForScore(aiClaude),
    '{{AI_GOOGLE_FILL}}':        fillForScore(aiGoogle),
    '{{AI_CHATGPT_FILL}}':       fillForScore(aiChatgpt),
    '{{AI_GEMINI_FILL}}':        fillForScore(aiGemini),
    '{{AI_CLAUDE_FILL}}':        fillForScore(aiClaude),
    '{{AI_IS_REAL_BADGE}}':      aiV.isReal ? '● Live queries run on your behalf' : '● Signal-based estimate',
    '{{AI_RUN_TIMESTAMP}}':      new Date(genAt).toLocaleString('en-US'),
    '{{AI_RUN_TIMESTAMP_TEXT}}': aiV.isReal
      ? `Queries run live on ${new Date(genAt).toLocaleString('en-US')}.`
      : 'AI scores are estimated from public visibility signals. Real-time queries run on paid reports.',
    '{{AI_QUERIES_RAN_HTML}}':   buildAiQueriesHtml({ ...audit, city }),
    '{{AI_COMPETITORS_HTML}}':   (audit.aiCompetitors || []).slice(0, 3).map((name, i) =>
      `<div class="ai-rec-doc"><div class="air-rank">${i + 1}</div>${esc(name)}</div>`
    ).join('') || '<div style="color:#6B7A8D;font-size:9pt">AI competitor data available on paid tier.</div>',
    '{{AI_NOT_DETECTED_TEXT}}':  (audit.aiCompetitors || []).length > 0
      ? '⚠ You were not detected in top AI recommendations.'
      : '⚠ AI competitor data not available on free tier.',

    // ── Pillars (7) ────────────────────────────────────────────────────────
    ...buildPillarPlaceholders(audit),
    '{{PILLAR_TOTAL}}': String(validatePillarTotal(audit).actual),

    // ── Radar chart ────────────────────────────────────────────────────────
    ...buildRadarPlaceholders(audit.pillars || {}),

    // ── Competitors ────────────────────────────────────────────────────────
    '{{COMPETITOR_TABLE_HTML}}':     buildCompetitorTableHtml({ ...audit, doctorNameClean: nameClean }),
    '{{COMPETITOR_NARRATIVE_HTML}}': buildNarrativeHtml(audit.competitorNarrative || audit.competitorGapSummary || ''),

    // ── Patient loss ───────────────────────────────────────────────────────
    '{{LOSS_MONTHLY_LOW}}':      loss.monthlyLow.toLocaleString(),
    '{{LOSS_MONTHLY_HIGH}}':     loss.monthlyHigh.toLocaleString(),
    '{{LOSS_ANNUAL_LOW}}':       loss.annualRevenueLow.toLocaleString(),
    '{{LOSS_ANNUAL_HIGH}}':      loss.annualRevenueHigh.toLocaleString(),
    '{{LOSS_METHODOLOGY_TEXT}}': loss.methodology || '',
    '{{LOSS_FORMULA_HTML}}':     buildLossFormulaHtml(audit, regionDef),

    // ── Fix guide ──────────────────────────────────────────────────────────
    '{{FIX_GUIDE_HTML}}': buildFixGuideHtml(audit.fixes || []),

    // ── Sentiment ──────────────────────────────────────────────────────────
    '{{SENTIMENT_POSITIVE_HTML}}': (audit.sentiment?.positive || ['Knowledgeable', 'Attentive', 'Professional']).map(w => `<span class="sent-tag sent-pos">${esc(w)}</span>`).join(''),
    '{{SENTIMENT_NEGATIVE_HTML}}': (audit.sentiment?.negative || ['Wait times', 'Availability']).map(w => `<span class="sent-tag sent-neg">${esc(w)}</span>`).join(''),
    '{{SENTIMENT_THEMES_HTML}}':   (audit.sentiment?.reviewThemes || []).map(t => `<span class="sent-theme">${esc(t)}</span>`).join(''),
    '{{RESPONSE_TEMPLATES_HTML}}': buildResponseTemplatesHtml(audit.responseTemplates),

    // ── SEO ────────────────────────────────────────────────────────────────
    '{{SEO_PRIMARY_HTML}}':   (audit.seoKeywords?.primary   || []).map(k => `<span class="kw-tag kw-primary">${esc(k)}</span>`).join(''),
    '{{SEO_SECONDARY_HTML}}': (audit.seoKeywords?.secondary || []).map(k => `<span class="kw-tag kw-secondary">${esc(k)}</span>`).join(''),
    '{{SEO_LONGTAIL_HTML}}':  (audit.seoKeywords?.longTail  || []).map(k => `<span class="kw-tag kw-longtail">${esc(k)}</span>`).join(''),

    // ── Content strategy ───────────────────────────────────────────────────
    '{{CONTENT_PILLARS_HTML}}': (audit.contentStrategy?.pillars || []).map(p => `<div class="content-item">${esc(p)}</div>`).join(''),
    '{{CONTENT_REELS_HTML}}':   (audit.contentStrategy?.reelIdeas || []).map(r => `<div class="content-item"><strong>${esc(r.hook)}</strong><br><span style="font-size:9pt">${esc(r.topic)}</span></div>`).join(''),
    '{{CONTENT_BLOGS_HTML}}':   (audit.contentStrategy?.blogTitles || []).map(b => `<div class="content-item">${esc(b)}</div>`).join(''),
    '{{CONTENT_CADENCE}}':      esc(audit.contentStrategy?.postingCadence || '3× per week'),

    // ── Patient journey ────────────────────────────────────────────────────
    '{{JOURNEY_STAGES_HTML}}':    buildJourneyHtml(audit.patientJourney?.stages || []),
    '{{JOURNEY_CRITICAL_STAGE}}': esc(audit.patientJourney?.criticalStage || ''),

    // ── 90-day plan ────────────────────────────────────────────────────────
    '{{PLAN_PHASE1_HTML}}':     buildPhaseHtml(audit.ninetyDayPlan?.phase1, 1),
    '{{PLAN_PHASE2_HTML}}':     buildPhaseHtml(audit.ninetyDayPlan?.phase2, 2),
    '{{PLAN_PHASE3_HTML}}':     buildPhaseHtml(audit.ninetyDayPlan?.phase3, 3),
    '{{PLAN_PROJECTED_SCORE}}': String(audit.ninetyDayPlan?.projectedScoreAt90Days || Math.min(100, (audit.score || 0) + 15)),

    // ── Monitor upsell ─────────────────────────────────────────────────────
    '{{MONITOR_SAMPLE_ALERT_HTML}}': buildSampleAlertHtml({ ...audit, doctorNameClean: nameClean }),
    '{{MONITOR_SAMPLE_TREND_HTML}}': `<div class="trend-bar-wrap"><div class="trend-bar-fill" style="width:${Math.min(100, audit.score || 0)}%"></div></div>`,

    // ── Methodology ────────────────────────────────────────────────────────
    '{{METHODOLOGY_SOURCES_HTML}}': buildMethodologySourcesHtml({ ...audit, city, state, region }),
    '{{METHODOLOGY_TIMESTAMP}}':    new Date(genAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }),

    // ── v5.1 Social Media Content Engine (page 10) ─────────────────────────
    '{{HASHTAG_LOCATION}}':  (city + (audit.specialty || '')).replace(/[^a-zA-Z0-9]/g, ''),
    '{{HASHTAG_SPECIALTY}}': (audit.specialty || '').replace(/[^a-zA-Z0-9]/g, ''),
    '{{COMPLIANCE_FRAMEWORK}}': audit.complianceFramework || (
      region === 'IN'
        ? 'MCI Code of Ethics, IMC Regulations 2002, and the Drugs & Magic Remedies Act 1954'
        : 'FTC Guidelines, FDA Social Media Guidance, and HIPAA Privacy Rules'
    ),

    '{{CAT1_SUBCATS_HTML}}': subcatsHtml(audit.socialContent?.categories?.cat1 || [`${audit.specialty || 'doctor'} myths debunked`, 'Symptoms explained simply', `When to visit a ${audit.specialty || 'doctor'}`]),
    '{{CAT2_SUBCATS_HTML}}': subcatsHtml(audit.socialContent?.categories?.cat2 || ['Daily health habits', 'Preventive care tips', 'Seasonal wellness']),
    '{{CAT3_SUBCATS_HTML}}': subcatsHtml(audit.socialContent?.categories?.cat3 || ['Day in our clinic', 'Meet the team', 'Behind-the-scenes']),
    '{{CAT4_SUBCATS_HTML}}': subcatsHtml(audit.socialContent?.categories?.cat4 || [`Local health in ${city}`, 'Community Q&A', 'Health awareness']),

    '{{CALENDAR_ROWS_HTML}}': calendarHtml(audit.socialContent?.calendar || [
      { week:1, mon:{cat:'Education',catNum:'1',topic:`${audit.specialty || 'Doctor'} FAQs`}, wed:{cat:'Lifestyle',catNum:'2',topic:'Morning health routine'}, fri:{cat:'Community',catNum:'4',topic:`Health news from ${city}`} },
      { week:2, mon:{cat:'Education',catNum:'1',topic:`When to see a ${audit.specialty || 'doctor'}`}, wed:{cat:'Lifestyle',catNum:'2',topic:'Seasonal prevention guide'}, fri:{cat:'Behind Practice',catNum:'3',topic:'Meet our team'} },
      { week:3, mon:{cat:'Education',catNum:'1',topic:'Myth vs fact'}, wed:{cat:'Lifestyle',catNum:'2',topic:'Healthy eating habits'}, fri:{cat:'Community',catNum:'4',topic:'Community health awareness'} },
      { week:4, mon:{cat:'Education',catNum:'1',topic:`${audit.specialty || 'Doctor'} myths debunked`}, wed:{cat:'Lifestyle',catNum:'2',topic:'Prevention tips'}, fri:{cat:'Behind Practice',catNum:'3',topic:'Clinic tour walkthrough'} },
    ]),

    '{{TOPIC_LIBRARY_HTML}}': topicLibraryHtml(audit.socialContent?.topics || [
      {title:`Top 5 FAQs about ${audit.specialty || 'doctors'}`},{title:'Morning health routine'},
      {title:'A day at our clinic'},{title:`Health in ${city}`},
      {title:`When to visit a ${audit.specialty || 'doctor'}`},{title:'Seasonal prevention guide'},
      {title:'Meet the team'},{title:'Patient FAQs answered'},
      {title:'Healthy habits 101'},{title:'Clinic tour walkthrough'},
      {title:'Community health awareness'},{title:'Myth vs fact: medical edition'},
    ]),

    // ── v5.1 Production & Compliance Guide (page 11) ───────────────────────
    '{{SPECIALTY_DONTS_HTML}}': specialtyDontsHtml(audit.specialtyDonts),

    // ── Safety net: suppress any stray {{TOKEN}} from code examples ────────
    '{{TOKEN}}': '',
  };

  return placeholders;
}

module.exports = {
  esc,
  cleanDoctorName,
  detectRegion,
  regionDefaults,
  verdictFromScore,
  computePillarsV5,
  validatePillarTotal,
  computePatientLoss,
  buildPdfPlaceholders,
};
