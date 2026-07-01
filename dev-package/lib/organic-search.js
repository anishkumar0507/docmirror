'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Organic Google search fallback for doctors with NO Google Business Profile.
//
// Many real doctors have no GMB but appear in Google's organic results via a
// hospital page, clinic page, or a directory profile (Practo, Healthgrades, …).
// When Google Places can't confirm the exact doctor, we run a few organic
// searches (via SerpAPI, or Google Custom Search) and accept a result only when
// it clearly matches the doctor's name on a TRUSTED healthcare/profile domain —
// never an unrelated clinic.
//
// Fully optional: if no search key is configured it returns nothing and the
// caller falls back to its normal "no public profile" path.
// ─────────────────────────────────────────────────────────────────────────────

require('./env');
const { scoreDoctorNameMatch, cleanNameText } = require('./doctor-verification');

const PLACEHOLDER = /your_|_here|xxxx|example/i;
function realKey(v) { return v && !PLACEHOLDER.test(v) ? v : ''; }

const SERPAPI_KEY = realKey(process.env.SERPAPI_KEY);
const CSE_KEY = realKey(process.env.GOOGLE_CSE_KEY || process.env.GOOGLE_SEARCH_API_KEY);
const CSE_ID  = realKey(process.env.GOOGLE_CSE_ID  || process.env.GOOGLE_SEARCH_ENGINE_ID);

function isConfigured() { return !!SERPAPI_KEY || !!(CSE_KEY && CSE_ID); }

// ── Trusted healthcare / profile domains ────────────────────────────────────
// Known directories + generic hospital/clinic/doctor-site signals. A result must
// live on one of these to be accepted as the doctor's organic profile.
const TRUSTED_DIRECTORIES = [
  'healthgrades.com', 'zocdoc.com', 'webmd.com', 'vitals.com', 'ratemds.com',
  'topdoctors.', 'doctify.', 'practo.com', 'lybrate.com', 'linkedin.com',
  'sharecare.com', 'justdial.com', 'credihealth.com', 'bajajfinservhealth.in',
  'apollo247.com', 'medindia.net', 'drdata.in', 'curofy.com',
];
const HOSPITAL_HINTS = /(hospital|hospitals|clinic|clinics|healthcare|health|medical|medicare|meditech|care|nursing|wellness|diagnostic|multispeciality|multispecialty)/i;

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch (e) { return ''; }
}

function isTrustedDomain(url) {
  const d = domainOf(url);
  if (!d) return false;
  if (TRUSTED_DIRECTORIES.some(t => d.includes(t))) return true;
  // Hospital/clinic/doctor site heuristic (e.g. cloudninecare.com, fortishealthcare.com)
  if (HOSPITAL_HINTS.test(d)) return true;
  return false;
}

// A friendly source label from the domain: "cloudninecare.com" → "Cloudninecare".
function sourceLabel(url) {
  const d = domainOf(url);
  if (!d) return 'Web';
  const known = {
    'practo.com': 'Practo', 'healthgrades.com': 'Healthgrades', 'zocdoc.com': 'Zocdoc',
    'webmd.com': 'WebMD', 'vitals.com': 'Vitals', 'ratemds.com': 'RateMDs',
    'lybrate.com': 'Lybrate', 'linkedin.com': 'LinkedIn', 'apollo247.com': 'Apollo 247',
    'justdial.com': 'JustDial', 'credihealth.com': 'Credihealth',
  };
  for (const k in known) if (d.includes(k)) return known[k];
  const core = d.split('.')[0];
  return core.charAt(0).toUpperCase() + core.slice(1);
}

// ── Search providers ─────────────────────────────────────────────────────────
async function fetchJson(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 6000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

async function runQuery(query) {
  try {
    if (SERPAPI_KEY) {
      const url = `https://serpapi.com/search.json?engine=google&num=10&q=${encodeURIComponent(query)}&api_key=${SERPAPI_KEY}`;
      const data = await fetchJson(url);
      return (data.organic_results || []).map(r => ({ title: r.title || '', snippet: r.snippet || '', link: r.link || '' }));
    }
    if (CSE_KEY && CSE_ID) {
      const url = `https://www.googleapis.com/customsearch/v1?key=${CSE_KEY}&cx=${CSE_ID}&num=10&q=${encodeURIComponent(query)}`;
      const data = await fetchJson(url);
      return (data.items || []).map(r => ({ title: r.title || '', snippet: r.snippet || '', link: r.link || '' }));
    }
  } catch (e) {
    console.warn(`[organic] query failed "${query}": ${e.message}`);
  }
  return [];
}

// ── Doctor profile finder ────────────────────────────────────────────────────
/**
 * Runs the fallback organic searches and evaluates every result.
 * @returns {Promise<{matched: object|null, candidates: object[], checked: number}>}
 *   matched.candidate = { title, snippet, url, source }
 */
async function findDoctorProfile(firstName, lastName, specialty, city) {
  if (!isConfigured()) return { matched: null, candidates: [], checked: 0, configured: false };

  // Queries are ordered most-specific first. We run them ONE AT A TIME and stop
  // the instant a strong trusted match is found — so a typical hit costs just a
  // single SerpAPI credit. The cap (default 3) bounds the worst case; override
  // with ORGANIC_MAX_QUERIES to trade coverage for quota.
  const queries = [
    `Dr ${firstName} ${lastName} ${specialty} ${city}`,
    `${firstName} ${lastName} ${specialty} ${city}`,
    `Dr ${firstName} ${lastName} doctor profile`,
    `${firstName} ${lastName} ${specialty}`,
    `${firstName} ${lastName} clinic ${city}`,
  ];
  const maxQueries = Math.max(1, Math.min(queries.length,
    parseInt(process.env.ORGANIC_MAX_QUERIES || '3', 10) || 3));

  const ln = cleanNameText(lastName);
  const spTok = cleanNameText(specialty).split(' ')[0]; // "psychiatrist"
  const cityTok = cleanNameText(city).split(' ')[0];

  const evaluate = (r) => {
    const text = cleanNameText(`${r.title} ${r.snippet}`);
    const nameScore = scoreDoctorNameMatch(firstName, lastName, `${r.title} ${r.snippet}`);
    const lnIn   = ln && text.includes(ln);
    const spIn   = spTok && text.includes(spTok);
    const cityIn = cityTok && text.includes(cityTok);
    const trusted = isTrustedDomain(r.link);
    const strong = (nameScore >= 90 || (lnIn && spIn && cityIn)) && trusted;
    console.log(`[organic]   result "${(r.title || '').slice(0, 60)}" domain=${domainOf(r.link)} nameScore=${nameScore} trusted=${trusted} → ${strong ? 'ACCEPT' : nameScore > 0 ? 'weak (mentions name)' : 'reject'}`);
    return { r, nameScore, trusted, strong, mentionsName: nameScore > 0 };
  };

  const seen = new Set();
  const candidates = [];
  let checked = 0;
  let queriesRun = 0;

  for (let i = 0; i < maxQueries; i++) {
    const rows = await runQuery(queries[i]);
    queriesRun++;
    for (const r of rows) {
      if (!r.link || seen.has(r.link)) continue;
      seen.add(r.link);
      checked++;
      const e = evaluate(r);
      if (e.strong) {
        // EARLY EXIT — stop spending SerpAPI credits the moment we're confident.
        console.log(`[organic] strong match on query #${queriesRun} → stopping (saved ${maxQueries - queriesRun} queries)`);
        return {
          matched: { title: r.title, snippet: r.snippet, url: r.link, source: sourceLabel(r.link), nameScore: e.nameScore, strong: true },
          candidates, checked, queriesRun, configured: true,
        };
      }
      if (e.mentionsName && e.trusted) {
        candidates.push({ title: r.title, snippet: r.snippet, url: r.link, source: sourceLabel(r.link), nameScore: e.nameScore, strong: false });
      }
    }
  }

  candidates.sort((a, b) => b.nameScore - a.nameScore);
  return { matched: null, candidates, checked, queriesRun, configured: true };
}

module.exports = {
  isConfigured,
  findDoctorProfile,
  isTrustedDomain,
  sourceLabel,
  domainOf,
};
