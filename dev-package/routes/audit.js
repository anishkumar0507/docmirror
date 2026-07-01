'use strict';

require('../lib/env');

const {
  cleanDoctorName,
  detectRegion,
  verdictFromScore,
  computePillarsV5,
  computePatientLoss,
  regionDefaults,
} = require('../lib/audit-helpers');

const { verifyDoctor, nameMatch, cityMatch, extractCity, specialtyMatch, scoreDoctorNameMatch } = require('../lib/doctor-verification');
const { relatedSearchTerms, detectGoogleSpecialty, specialtyNotice } = require('../lib/specialty-relationships');
const organic = require('../lib/organic-search');
let parsePlace = null;
try { parsePlace = require('../public/js/doctor-name-parser.js').parseDoctorPlaceResult; } catch (e) { parsePlace = null; }

const PLACES = 'https://maps.googleapis.com/maps/api/place';

// ── Startup key check — visible immediately when server boots ─────────────
const _startupKey = process.env.GOOGLE_PLACES_API_KEY;
if (_startupKey) {
  console.log(`[audit] GOOGLE_PLACES_API_KEY loaded ✓  (ends: ...${_startupKey.slice(-4)})`);
} else {
  console.error('[audit] GOOGLE_PLACES_API_KEY MISSING — set it in config/.env.local');
}

// ── Google Places helpers ──────────────────────────────────────────────────
async function textSearch(query, key) {
  const url = `${PLACES}/textsearch/json?query=${encodeURIComponent(query)}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`textSearch HTTP ${res.status}`);
  return res.json();
}

async function placeDetails(placeId, key) {
  const fields = 'name,rating,user_ratings_total,formatted_address,address_components,types,opening_hours,website,photos';
  const url = `${PLACES}/details/json?place_id=${placeId}&fields=${fields}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`placeDetails HTTP ${res.status}`);
  return res.json();
}

// ── Visibility score (V5 — 7 pillars, sum = score) ────────────────────────
function calcScore(d) {
  return computePillarsV5(d).total;
}

// ── Sanitise specialty — "Other" / blank → "doctor" ───────────────────────
function resolveSpecialty(specialty) {
  const s = (specialty || '').trim();
  if (!s || s.toLowerCase() === 'other') return 'doctor';
  return s;
}

// ── Find real competitors via Google Places Text Search ────────────────────
// `specialtyTerms` is a PRIORITY list: user specialty first, then Google category,
// then related-specialty mappings, then parent (built by relatedSearchTerms()).
// We query in order and only broaden to the next term when the user's exact
// specialty hasn't yielded enough same-city candidates — so the benchmark stays
// as close to the doctor's real specialty as possible, never limited to Google's.
async function findCompetitors(specialtyTerms, cityState, doctorPlaceId, key) {
  if (!cityState) {
    console.log('[comp] cityState missing — skipping');
    return [];
  }

  // Normalise the input to an ordered, de-duplicated list of resolved terms.
  const rawTerms = Array.isArray(specialtyTerms) ? specialtyTerms : [specialtyTerms];
  const terms = [];
  const seenTerm = new Set();
  rawTerms.forEach(t => {
    const r = resolveSpecialty(t);
    const k = r.toLowerCase();
    if (r && !seenTerm.has(k)) { seenTerm.add(k); terms.push(r); }
  });
  if (!terms.length) terms.push('doctor');

  // Use only the city part — full "City, State" string degrades Google results
  const city = cityState.split(',')[0].trim();
  const cityNorm = city.toLowerCase().replace(/[^a-z0-9]+/g, '');

  console.log('\n[comp] ══════════════════════════════════════');
  console.log(`[comp] city             : "${city}"`);
  console.log(`[comp] priority terms   : ${terms.map(t => `"${t}"`).join(' → ')}`);
  console.log(`[comp] exclude placeId  : ${doctorPlaceId || '(none)'}`);

  const TARGET = 5;        // stop once we have this many ranked candidates
  const MAX_QUERIES = 3;   // bound API cost/latency
  const byPlaceId = new Map();

  for (let i = 0; i < terms.length && i < MAX_QUERIES; i++) {
    const sp = terms[i];
    const query = `${sp} doctor in ${city}`;
    console.log(`[comp] query #${i + 1}      : "${query}"`);

    let results = [];
    try {
      const data = await textSearch(query, key);
      console.log(`[comp]   status: ${data.status}  results: ${data.results?.length ?? 0}`);
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        console.error(`[comp]   Google error: ${data.status} — ${data.error_message || '(no message)'}`);
      }
      results = data.results || [];
    } catch (err) {
      console.error(`[comp]   textSearch failed: ${err.message}`);
      results = [];
    }

    for (const r of results.slice(0, 10)) {
      if (!r.place_id || r.place_id === doctorPlaceId) continue;       // exclude the doctor
      if (byPlaceId.has(r.place_id)) continue;                          // dedupe across terms
      if (cityNorm) {                                                   // SAME city only — never fabricate
        const addr = (r.formatted_address || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        if (!addr.includes(cityNorm)) continue;
      }
      byPlaceId.set(r.place_id, r);
    }
    console.log(`[comp]   accumulated same-city candidates: ${byPlaceId.size}`);
    if (byPlaceId.size >= TARGET) break;   // user/related specialty already gave enough
  }

  let withoutDoctor = Array.from(byPlaceId.values());
  if (!withoutDoctor.length) {
    console.log('[comp] No same-city candidates across priority terms — returning none (no fabrication)');
    return [];
  }

  // Sort by rating desc, then review count desc
  withoutDoctor.sort((a, b) => {
    const ratingDiff = (b.rating || 0) - (a.rating || 0);
    return ratingDiff !== 0 ? ratingDiff : (b.user_ratings_total || 0) - (a.user_ratings_total || 0);
  });

  // Take top 3 and fetch full details
  const top3 = withoutDoctor.slice(0, 3);
  console.log(`\n[comp] Fetching details for top 3:`);
  top3.forEach((r, i) =>
    console.log(`  ${i + 1}. "${r.name}" | ★${r.rating ?? '-'} | ${r.user_ratings_total ?? 0} reviews`)
  );

  const detailed = await Promise.all(
    top3.map(c =>
      placeDetails(c.place_id, key)
        .then(d => ({ detail: d.result || null, raw: c }))
        .catch(() => ({ detail: null, raw: c }))
    )
  );

  const competitors = detailed.map(({ detail, raw }) => {
    const name        = detail?.name || raw.name;
    const rating      = typeof (detail?.rating ?? raw.rating) === 'number'
                          ? (detail?.rating ?? raw.rating) : 0;
    const reviewCount = detail?.user_ratings_total ?? raw.user_ratings_total ?? 0;
    const website     = detail?.website || null;
    const hasHours    = !!(detail?.opening_hours?.weekday_text?.length);
    const photoCount  = Array.isArray(detail?.photos) ? detail.photos.length : 0;
    return {
      name,
      placeId:     raw.place_id,
      rating,
      reviewCount,
      address:     detail?.formatted_address || raw.formatted_address || '',
      googleScore: calcScore({ rating, reviewCount, website, hasHours, photoCount }),
      source:      'google_places'
    };
  });

  console.log(`\n[comp] Final competitors (${competitors.length}):`);
  competitors.forEach((c, i) =>
    console.log(`  ${i + 1}. "${c.name}" | ★${c.rating} | ${c.reviewCount} reviews | score: ${c.googleScore} | placeId: ${c.placeId}`)
  );

  return competitors;
}

// ── Anthropic: issues + recs + competitor EXPLANATIONS only ───────────────
// Anthropic does NOT generate competitor names — Google Places does.
async function generateAllInsights(doctorData, competitors) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { issues: [], recommendations: [], competitorExplanations: [], gapSummary: '' };

  try {
    const { runClaudePrompt } = require('../lib/claude-client');

    const compLines = competitors.length
      ? competitors.map((c, i) =>
          `${i + 1}. ${c.name} — ${c.rating}/5 stars, ${c.reviewCount} reviews, score ${c.googleScore}/100`
        ).join('\n')
      : 'No competitors found nearby.';

    const explanationSlots = competitors.length
      ? competitors.map((_, i) => `"why competitor ${i + 1} is more visible (max 12 words)"`).join(', ')
      : '';

    const prompt = `You are analyzing real Google Places data for a doctor visibility audit.

Doctor: ${doctorData.doctorName}
Specialty: ${doctorData.specialty || 'General Practice'}
Business listing: ${doctorData.businessName}
Rating: ${doctorData.rating > 0 ? doctorData.rating + '/5' : 'No rating'}
Reviews: ${doctorData.reviewCount}
Website: ${doctorData.website ? 'Yes' : 'No'}
Hours listed: ${doctorData.hasHours ? 'Yes' : 'No'}
Photos: ${doctorData.photoCount}
Visibility score: ${doctorData.score}/100

Real competitors from Google Places (names are from Google — do not change them):
${compLines}

Return ONLY valid JSON — no markdown, no extra text:
{
  "issues": ["specific issue 1", "specific issue 2", "specific issue 3"],
  "recommendations": ["actionable rec 1", "actionable rec 2", "actionable rec 3"],
  "competitorExplanations": [${explanationSlots}],
  "gapSummary": "one sentence (max 20 words) on the main visibility gap vs competitors"
}`;

    return await runClaudePrompt(prompt, {
      label: 'audit-insights',
      maxTokens: 700,
      useCache: true,
    });

  } catch (err) {
    console.error('[audit] Anthropic error:', err.message);
    return { issues: [], recommendations: [], competitorExplanations: [], gapSummary: '' };
  }
}

// ── Limited report when the doctor has NO Google Business Profile ───────────
// Many real doctors simply have no GMB (or an un-findable listing). Instead of a
// hard "verification failed", we return a low-score report that HONESTLY shows
// every Google signal as missing (no fabricated ratings/reviews/competitors) and
// tells them the one thing that matters: create & verify a GMB. verified:true so
// the frontend routes it to the normal report view, not the error card.
function buildGmbMissingReport({ fn, ln, sp, ct, parentSp, message, competitors }) {
  const city   = (ct || '').split(',')[0].trim();
  const state  = (ct || '').split(',')[1]?.trim() || '';
  const region = detectRegion(city, state);
  const regionDef = regionDefaults(region);
  const doctorName = `Dr. ${fn} ${ln}`.replace(/\s+/g, ' ').trim();
  const score = 18; // low, fixed — reflects "not visible on Google", not a measurement

  console.log(`[audit] GMB MISSING → limited report  doctor="${doctorName}" city="${city}" score=${score}`);

  return {
    verified:    true,
    gmbMissing:  true,
    source:      'gmb_missing',
    notFound:    false,
    confidence:  0,
    generatedAt: new Date().toISOString(),
    message:     message || 'No Google Business Profile found',

    // Identity (from user input — nothing fabricated)
    doctorName,
    doctorNameClean: cleanDoctorName(doctorName),
    specialty:       sp || '',
    userSpecialty:   sp || '',
    googleSpecialty: '',
    specialtyNotice: '',
    cityState:       ct || '',
    city, state, region,
    businessName:    '',

    // Google data — ALL MISSING (honest, never faked)
    rating: 0, reviewCount: 0, website: null, address: '',
    hasHours: false, hoursText: null, isOpenNow: null, photoCount: 0,
    placeId: null, googleMapsUrl: null,

    // Scoring
    score,
    pillarTotal:  score,
    verdictLabel: 'Not visible on Google',
    verdictColor: '#DC2626',
    tierLabel:    'Limited Visibility Audit — No Google Business Profile',
    pillars: { gmb: 0, rating: 0, reviews: 0, photos: 0, rank: 0, aiVisibility: 0, directories: 0 },

    aiVisibility: { google: 0, chatgpt: 0, gemini: 0, claude: 0, isReal: false },

    patientLoss: computePatientLoss({ doctorName, rating: 0, reviewCount: 0, website: null,
      hasHours: false, photoCount: 0, city, state, region, score }, regionDef),

    currencySymbol:      regionDef.currencySymbol,
    valuePerPatientLow:  regionDef.valuePerPatientLow,
    valuePerPatientHigh: regionDef.valuePerPatientHigh,

    // Limited-report content — clearly "missing", plus the one key fix
    gmbChecklist: {
      googleBusinessProfile: 'Missing',
      reviews:  'Not found',
      photos:   'Not found',
      hours:    'Not found',
      website:  'Unknown',
    },
    mainRecommendation: 'Create and verify your Google Business Profile',
    // Real Google Places competitors for the same specialty + city (verified
    // listings). The doctor has no GMB, but these are who patients DO find.
    competitors: competitors || [],
    competitorBenchmark: (sp && city) ? `Top ${sp}s in ${city}`.replace(/\s+/g, ' ').trim() : '',
    competitorGapSummary: '',
    issues: [
      'No Google Business Profile found — patients searching Google Search or Maps cannot find your practice.',
      'Reviews: not found · Photos: not found · Business hours: not found · Website: unknown.',
    ],
    recommendations: [
      'Create and verify your Google Business Profile — the single most important step to become visible to patients.',
      'Add your practice name, specialty, address, phone number, hours and website.',
      'Once your profile is live, ask recent patients to leave Google reviews.',
    ],
  };
}

// ── Report when the doctor has NO GMB but DOES appear in organic Google search ─
// (e.g. a hospital/clinic/directory profile page). verified:true → normal report
// view. No fabricated ratings/reviews — those come only from a real GMB.
function buildOrganicProfileReport({ fn, ln, sp, ct, parentSp, profile, competitors }) {
  const city   = (ct || '').split(',')[0].trim();
  const state  = (ct || '').split(',')[1]?.trim() || '';
  const region = detectRegion(city, state);
  const regionDef = regionDefaults(region);
  const doctorName = `Dr. ${fn} ${ln}`.replace(/\s+/g, ' ').trim();
  const score = 42; // organic-fallback score (found online, but no GMB) — 35–50 band

  console.log(`[audit] ORGANIC PROFILE → report  doctor="${doctorName}" source="${profile.source}" url=${profile.url} score=${score}`);

  return {
    verified:            true,
    source:              'organic_profile',
    gmbFound:            false,
    gmbMissing:          true,
    organicProfileFound: true,
    notFound:            false,
    confidence:          0,
    generatedAt:         new Date().toISOString(),
    message:             'No Google Business Profile found — doctor appears in organic Google results',

    // Identity
    doctorName,
    doctorNameClean: cleanDoctorName(doctorName),
    specialty:       sp || '',
    userSpecialty:   sp || '',
    googleSpecialty: '',
    specialtyNotice: '',
    cityState:       ct || '',
    city, state, region,
    businessName:    profile.source || '',

    // Organic profile details
    profileTitle:  profile.title || '',
    profileUrl:    profile.url || '',
    profileSource: profile.source || '',
    website:       profile.url || null,

    // Google GMB data — NOT available (never fabricated)
    rating: null, reviewCount: 0, address: '',
    hasHours: false, hoursText: null, isOpenNow: null, photoCount: 0,
    placeId: null, googleMapsUrl: null,

    // Scoring
    score,
    visibilityScore: score,
    pillarTotal:  score,
    verdictLabel: 'Found in organic search · No Google Business Profile',
    verdictColor: '#D97706',
    tierLabel:    'Limited Visibility Audit — Organic Profile Only',
    pillars: { gmb: 0, rating: 0, reviews: 0, photos: 0, rank: 6, aiVisibility: 0, directories: 4 },
    aiVisibility: { google: 0, chatgpt: 0, gemini: 0, claude: 0, isReal: false },

    patientLoss: computePatientLoss({ doctorName, rating: 0, reviewCount: 0, website: profile.url,
      hasHours: false, photoCount: 0, city, state, region, score }, regionDef),
    currencySymbol:      regionDef.currencySymbol,
    valuePerPatientLow:  regionDef.valuePerPatientLow,
    valuePerPatientHigh: regionDef.valuePerPatientHigh,

    gmbChecklist: {
      googleBusinessProfile: 'Not Found',
      organicProfile:        'Found',
      source:                profile.source || '',
      profile:               profile.title || '',
      reviews:  'Not available',
      photos:   'Not available',
      hours:    'Not available',
    },
    mainRecommendation: 'Create or claim a Google Business Profile',
    // Real Google Places competitors for the same specialty + city.
    competitors: competitors || [],
    competitorBenchmark: (sp && city) ? `Top ${sp}s in ${city}`.replace(/\s+/g, ' ').trim() : '',
    competitorGapSummary: '',
    issues: [
      'No verified Google Business Profile found for this doctor',
      'Doctor appears in organic Google results through a hospital/profile page',
      'Google Maps visibility may be weak or missing',
      'Reviews, photos, and hours are not available from a direct GMB profile',
    ],
    recommendations: [
      'Create or claim a Google Business Profile',
      'Link the hospital profile to the doctor’s official website',
      'Add schema markup to doctor profile pages',
      'Collect verified patient reviews',
      'Improve entity consistency across Google and AI search',
    ],
  };
}

// Real Google Places competitors for a specialty + city — works even when the
// doctor themselves has NO GMB (the search is by specialty+city, not their listing).
// Verified listings only; never fabricated. Used for the GMB-missing / organic reports.
async function fetchAreaCompetitors({ sp, parentSp, ct }) {
  try {
    const key = process.env.GOOGLE_PLACES_API_KEY;
    const cityName = (ct || '').split(',')[0].trim();
    if (!key || !cityName || !sp) return [];
    const terms = relatedSearchTerms(sp, parentSp || sp, '');
    const comps = await findCompetitors(terms, cityName, null, key);
    return comps.map(c => ({
      name: c.name, placeId: c.placeId, rating: c.rating, reviewCount: c.reviewCount,
      address: c.address, googleScore: c.googleScore, source: 'google_places', explanation: '',
    }));
  } catch (e) {
    console.warn('[audit] area competitors fetch failed:', e.message);
    return [];
  }
}

// ── Main handler ───────────────────────────────────────────────────────────
async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const placesKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!placesKey) {
    return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not configured' });
  }

  const { fn, ln, sp, spp, ct, placeId: selectedPlaceId, gmbMissing: forceGmbMissing } = req.body || {};
  if (!fn || !ln) {
    return res.status(400).json({ error: 'fn and ln (firstName, lastName) are required' });
  }
  // parentSpecialty (spp) from the combobox; fall back to the selected specialty.
  const parentSp = (spp && String(spp).trim()) || sp || '';

  try {
    // User clicked "None of these" on the selection screen → no GMB for this exact
    // doctor. Return the honest limited report (never another clinic's data).
    if (forceGmbMissing === true) {
      const competitors = await fetchAreaCompetitors({ sp, parentSp, ct });
      return res.status(200).json(buildGmbMissingReport({ fn, ln, sp, ct, parentSp, competitors, message: 'No public Google profile found' }));
    }

    // 1. Resolve the doctor's place_id. If the user picked an autocomplete
    //    suggestion we trust that exact Place ID; otherwise text-search.
    let placeId = (selectedPlaceId && String(selectedPlaceId).trim()) || '';
    let searchAccepted = false; // true once our strict name+city scorer picks a match
    if (placeId) {
      console.log(`[audit] Using selected placeId from autocomplete: ${placeId}`);
    } else {
      const query      = ['Dr', fn, ln, sp, ct].filter(Boolean).join(' ');
      console.log(`[audit] Doctor search query: "${query}"`);
      const searchData = await textSearch(query, placesKey);
      console.log(`[audit] Doctor search status: ${searchData.status}  results: ${searchData.results?.length ?? 0}`);

      if (searchData.status !== 'OK' && searchData.status !== 'ZERO_RESULTS') {
        console.error(`[audit] Google Places error: ${searchData.status} — ${searchData.error_message || '(no message)'}`);
      }
      if (searchData.status === 'REQUEST_DENIED') {
        return res.status(500).json({ error: 'Google Places API key invalid or billing not enabled' });
      }

      const results = searchData.results || [];

      // No results at all → this doctor has no findable Google Business Profile.
      // NOT a hard failure — return a limited "create your GMB" report.
      if (!results.length) {
        const competitors = await fetchAreaCompetitors({ sp, parentSp, ct });
        return res.status(200).json(buildGmbMissingReport({ fn, ln, sp, ct, parentSp, competitors }));
      }

      // ── Score each candidate STRICTLY on the DOCTOR'S NAME ─────────────────
      // A clinic that only shares the specialty/city (but not the name) scores 0
      // and is NEVER auto-selected as this doctor. City + specialty are recorded
      // for the log / selection list only.
      // Robust city check for SEARCH results: the entered city just has to appear
      // anywhere in the formatted address ("Bandra, Mumbai, MH" ✓ for "Mumbai").
      // (extractCity's positional parse mis-reads the sublocality on raw results.)
      const cnorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
      const cityTok = ct ? cnorm(ct.split(',')[0]) : '';
      const scoreOne = (r, extraText) => {
        const text = [r.name, r.formatted_address, extraText, r.website].filter(Boolean).join(' ');
        const nameScore = scoreDoctorNameMatch(fn, ln, text);
        const cityM = ct ? (!!cityTok && cnorm(r.formatted_address || '').includes(cityTok)) : true;
        const specM = specialtyMatch(sp, r.name || '', r.types || [], parentSp).status === 'match';
        return { r, nameScore, cityMatch: cityM, specialtyMatch: specM };
      };

      let scored = results.slice(0, 8).map(r => scoreOne(r));

      // If nothing matches the name on the listing text alone, try the richer
      // Place Details (website + editorial summary) for the top few city candidates —
      // some doctors' names live there, not in the clinic's listing title.
      const hasStrong = () => scored.some(c => c.nameScore >= 70 && c.cityMatch);
      if (!hasStrong()) {
        const probe = scored.filter(c => c.cityMatch).slice(0, 5);
        for (const c of probe) {
          try {
            const det = (await placeDetails(c.r.place_id, placesKey)).result || {};
            const extra = [det.website, det.editorial_summary?.overview, det.name].filter(Boolean).join(' ');
            const rescored = scoreOne({ ...c.r, website: det.website, name: det.name || c.r.name }, extra);
            c.nameScore = Math.max(c.nameScore, rescored.nameScore);
            c.detail = det; // reuse for the selection card (rating/reviews/website)
          } catch (e) { /* non-fatal — keep the listing-based score */ }
        }
      }

      // Log every candidate + the accept/reject reason (req. 9).
      scored.forEach((c, i) => {
        const strong = c.nameScore >= 70 && c.cityMatch;
        const reason = strong ? 'ACCEPT (strong name+city)'
          : c.nameScore >= 70 ? 'reject: name ok but city mismatch'
          : c.nameScore > 0   ? 'reject: weak name (partial)'
          : 'reject: name not found (different clinic/doctor)';
        console.log(`[audit]   cand ${i + 1}: "${c.r.name}" nameScore=${c.nameScore} cityMatch=${c.cityMatch} specialtyMatch=${c.specialtyMatch} → ${reason}`);
      });

      const strongMatches = scored.filter(c => c.nameScore >= 70 && c.cityMatch);

      // Build the "please select yours" list (city-relevant candidates).
      const buildMatches = (list) => list.slice(0, 5).map(c => {
        const d = c.detail || {};
        return {
          placeId:     c.r.place_id,
          name:        c.r.name || d.name || '',
          address:     c.r.formatted_address || d.formatted_address || '',
          rating:      typeof (c.r.rating ?? d.rating) === 'number' ? (c.r.rating ?? d.rating) : null,
          reviewCount: c.r.user_ratings_total ?? d.user_ratings_total ?? 0,
          website:     d.website || c.r.website || null,
        };
      });

      if (strongMatches.length === 1) {
        placeId = strongMatches[0].r.place_id;             // confident, unambiguous → auto-accept
        searchAccepted = true;                             // our scorer already confirmed name+city
        console.log(`[audit] AUTO-ACCEPT strong match: "${strongMatches[0].r.name}" (score ${strongMatches[0].nameScore})`);
      } else if (strongMatches.length > 1) {
        // The same doctor appears in more than one listing → let them pick.
        console.log(`[audit] ${strongMatches.length} strong matches → needsSelection`);
        return res.status(200).json({
          needsSelection: true,
          reason:  'multiple_matches',
          message: 'We found more than one listing for this doctor. Please select yours.',
          matches: buildMatches(strongMatches),
        });
      } else {
        // ── NO strong Google Places match ────────────────────────────────────
        // Before showing any selection or failure, try the ORGANIC search fallback:
        // the doctor may appear via a hospital/clinic/directory page (req. 3).
        const cityName = (ct || '').split(',')[0].trim();
        let org = { matched: null, candidates: [], checked: 0, configured: false };
        if (organic.isConfigured()) {
          console.log('[audit] no strong Places match → running organic search fallback…');
          org = await organic.findDoctorProfile(fn, ln, sp, cityName);
          console.log(`[audit] organic: serpapi_queries=${org.queriesRun || 0} results_checked=${org.checked} matched=${org.matched ? org.matched.url : 'none'}`);
        } else {
          console.log('[audit] no strong Places match; organic fallback not configured (no SERPAPI_KEY / CSE)');
        }

        // 1. A clear organic profile match → prioritise it over unrelated Places (req. 8).
        if (org.matched) {
          console.log(`[audit] FINAL SOURCE=organic_profile url=${org.matched.url}`);
          const competitors = await fetchAreaCompetitors({ sp, parentSp, ct });
          return res.status(200).json(buildOrganicProfileReport({ fn, ln, sp, ct, parentSp, profile: org.matched, competitors }));
        }

        // 2. Offer "Select your profile" ONLY for Places candidates that actually
        //    MENTION the doctor's name (req. 9). Unrelated clinics (score 0) never.
        const placesMention = scored.filter(c => c.nameScore > 0);
        if (placesMention.length) {
          console.log(`[audit] FINAL SOURCE=not_found → needsSelection (${placesMention.length} Places name-mentions)`);
          return res.status(200).json({
            needsSelection: true,
            reason:  'doctor_name_not_confirmed',
            message: 'We found possible profiles. Please select yours.',
            matches: buildMatches(placesMention),
          });
        }

        // 3. Nothing in Places or Organic → "No public Google profile found" (req. 10).
        console.log('[audit] FINAL SOURCE=not_found → no public Google profile');
        const competitors = await fetchAreaCompetitors({ sp, parentSp, ct });
        return res.status(200).json(buildGmbMissingReport({ fn, ln, sp, ct, parentSp, competitors, message: 'No public Google profile found' }));
      }
    }

    // 3. Get doctor full details (needed before we can verify identity)
    const { result: place = {} } = await placeDetails(placeId, placesKey);
    if (!place.name) {
      return res.status(200).json({
        verified: false, notFound: true, reason: 'not_found',
        message: "We couldn't verify this doctor. Please check the doctor's name and location."
      });
    }

    // 4. STRICT VERIFICATION — runs BEFORE any preview/competitor generation.
    //    Data accuracy is prioritised over showing results.
    let vConfidence, vChecks, verifiedCity;
    // Clean, parsed display name — never the raw Google Places title (req. 10).
    let displayFn = fn, displayLn = ln;
    const formFlow = !!(ct && String(ct).trim());

    if (selectedPlaceId || searchAccepted) {
      // Trusted: either the user picked this exact listing from autocomplete, OR
      // our strict name+city scorer already confirmed it above. Re-derive a clean
      // display name from the listing; don't re-run the strict name gate (which
      // only checks the listing title and would miss names found in the website).
      if (parsePlace) {
        const pn = parsePlace({ doctorName: place.name, types: place.types, address: place.formatted_address });
        if (pn && pn.firstName) { displayFn = pn.firstName; displayLn = pn.lastName || ''; }
      }
      // The user explicitly picked this exact doctor from the verified
      // autocomplete → identity & city are confirmed by Place ID (the strongest
      // signal). We still require a valid, non-conflicting speciality.
      // Speciality is informational only — NEVER blocks. The user explicitly
      // picked this exact listing, so identity is confirmed by Place ID; whatever
      // Google's category is, the doctor's selected specialty stays primary.
      const spec = specialtyMatch(sp, place.name, place.types, parentSp);
      verifiedCity = extractCity(place) || (ct || '').split(',')[0].trim();
      console.log(`[audit] verification(placeId): listing="${place.name}" actualCity="${verifiedCity}" specialty="${sp || ''}" specStatus=${spec.status}`);
      vConfidence = 100;
      vChecks = {
        mode: 'place_id', placeId,
        name:      { matched: true, listingName: place.name },
        city:      { matched: true, actual: verifiedCity },
        specialty: { status: spec.status, entered: sp || '', parent: parentSp || '' },
        confidence: 100,
      };
    } else if (formFlow) {
      // Full gate: name 70 + city 20 + speciality 10, must be >= 90, with hard
      // stops on city mismatch / invalid (“Other”) / conflicting speciality.
      const verifyResult = verifyDoctor(
        { firstName: fn, lastName: ln, specialty: sp, parentSpecialty: parentSp, userCity: ct },
        place
      );
      console.log(`[audit] verification(form): verified=${verifyResult.verified} confidence=${verifyResult.confidence} reason=${verifyResult.reason || 'ok'}`);
      console.log(`[audit]   listing="${place.name}" enteredCity="${(ct||'').split(',')[0].trim()}" actualCity="${verifyResult.checks?.city?.actual || ''}" specialty="${sp || ''}"`);

      if (!verifyResult.verified) {
        // Stop the flow — NO preview, NO competitors, NO fabricated data.
        return res.status(200).json({
          verified:   false,
          notFound:   verifyResult.reason === 'not_found',
          reason:     verifyResult.reason,
          message:    verifyResult.message,
          confidence: verifyResult.confidence,
          checks:     verifyResult.checks,
        });
      }
      vConfidence  = verifyResult.confidence;
      vChecks      = verifyResult.checks;
      verifiedCity = verifyResult.actualCity || (ct || '').split(',')[0].trim();
    } else {
      // Name / Google-Maps-URL entry: no city or speciality was entered, so
      // there is nothing to "mismatch". Verify identity by NAME and adopt the
      // doctor's REAL city from Google Places (source of truth). Still no
      // fabricated data — competitors come from that real city only.
      const nm = nameMatch(fn, ln, place.name);
      console.log(`[audit] verification(name-only): matched=${nm.matched} score=${nm.score} listing="${place.name}"`);
      if (!nm.matched) {
        return res.status(200).json({
          verified: false, notFound: true, reason: 'not_found',
          message: "We couldn't verify this doctor. Please check the doctor's name and location."
        });
      }
      verifiedCity = extractCity(place) || '';
      vConfidence  = nm.score;
      vChecks      = { name: { matched: true, score: nm.score, listingName: place.name },
                       city: { actual: verifiedCity }, mode: 'name_only' };
    }

    const rating      = typeof place.rating === 'number' ? place.rating : 0;
    const reviewCount = place.user_ratings_total || 0;
    const website     = place.website || null;
    const address     = place.formatted_address || '';
    const hasHours    = !!(place.opening_hours?.weekday_text?.length);
    const hoursText   = hasHours ? place.opening_hours.weekday_text[0] : null;
    const isOpenNow   = place.opening_hours?.open_now ?? null;
    const photoCount  = Array.isArray(place.photos) ? place.photos.length : 0;

    // V5: city/state as separate fields
    const city  = (ct || '').split(',')[0].trim();
    const state = (ct || '').split(',')[1]?.trim() || '';
    const region = detectRegion(city, state);

    // ── Specialty: user is PRIMARY, Google is informational ───────────────────
    // Store both separately; never overwrite the user's specialty with Google's
    // broad category. A difference becomes a non-blocking notice (no score impact).
    const userSpecialty   = sp || '';
    const googleSpecialty = detectGoogleSpecialty(place);
    const specialtyMsg    = specialtyNotice(userSpecialty, googleSpecialty);

    const doctorName = `Dr. ${displayFn} ${displayLn}`.replace(/\s+/g, ' ').trim();
    const rawData = { doctorName, rating, reviewCount, website, address, hasHours, photoCount, specialty: sp || '', city, state, region };
    const pillarsV5 = computePillarsV5(rawData);
    const score     = pillarsV5.total;
    const verdict   = verdictFromScore(score);
    const regionDef = regionDefaults(region);

    const auditData = {
      notFound: false, source: 'google_places',
      verified:        true,
      confidence:      vConfidence,
      verification:    vChecks,
      generatedAt:     new Date().toISOString(),

      // Identity
      doctorName,
      doctorNameClean: cleanDoctorName(doctorName),
      specialty:       sp || '',         // user-selected specialty (PRIMARY — never overwritten)
      userSpecialty,                     // explicit alias for clarity
      googleSpecialty,                   // Google's broad category (informational)
      specialtyNotice: specialtyMsg,     // non-blocking notice when the two differ
      cityState:       ct || '',
      city, state, region,
      businessName:    place.name,

      // Google data
      rating, reviewCount, website, address,
      hasHours, hoursText, isOpenNow, photoCount,
      placeId,
      googleMapsUrl: `https://www.google.com/maps/place/?q=place_id:${placeId}`,

      // V5 scoring
      score,
      pillarTotal:  score,
      verdictLabel: verdict.label,
      verdictColor: verdict.color,
      tierLabel:    'Full 7-Pillar AI Visibility Audit',
      pillars: {
        gmb:          pillarsV5.gmb,
        rating:       pillarsV5.rating,
        reviews:      pillarsV5.reviews,
        photos:       pillarsV5.photos,
        rank:         pillarsV5.rank,
        aiVisibility: pillarsV5.aiVisibility,
        directories:  pillarsV5.directories,
      },

      // AI visibility (synthetic — real on paid)
      aiVisibility: {
        google:  Math.min(100, score + 10),
        chatgpt: Math.round(score * 0.6),
        gemini:  Math.round(score * 0.55),
        claude:  Math.round(score * 0.5),
        isReal:  false,
      },

      // Patient loss estimate
      patientLoss: computePatientLoss({ ...rawData, score }, regionDef),

      // Currency
      currencySymbol:      regionDef.currencySymbol,
      valuePerPatientLow:  regionDef.valuePerPatientLow,
      valuePerPatientHigh: regionDef.valuePerPatientHigh,
    };

    // Find real competitors from Google Places — SAME city (verified, canonical).
    // Discovery uses a PRIORITY list of specialties: user specialty first, then
    // Google category, then related-specialty mapping (so "Spine Surgeon" also
    // matches Neurosurgeons / Orthopedic Spine Surgeons), then parent. Not limited
    // to Google's category. No Anthropic, no placeholders, max 3.
    const searchTerms = relatedSearchTerms(userSpecialty, parentSp || sp, googleSpecialty);
    const competitors = await findCompetitors(searchTerms, verifiedCity, placeId, placesKey);
    auditData.competitorBenchmark = userSpecialty
      ? `Top ${userSpecialty}s in ${city || verifiedCity}`.replace(/\s+/g, ' ').trim()
      : '';

    // 5. Anthropic: explains competitors + generates issues/recs
    //    Anthropic does NOT create competitor names — only explanations
    const insights = await generateAllInsights(auditData, competitors);

    auditData.issues               = insights.issues               || [];
    auditData.recommendations      = insights.recommendations      || [];
    auditData.competitorGapSummary = insights.gapSummary           || '';
    auditData.competitors          = competitors.map((c, i) => ({
      name:        c.name,
      placeId:     c.placeId,
      rating:      c.rating,
      reviewCount: c.reviewCount,
      address:     c.address,
      googleScore: c.googleScore,
      source:      'google_places',
      explanation: insights.competitorExplanations?.[i] || ''
    }));

    return res.status(200).json(auditData);

  } catch (err) {
    console.error('[audit] error:', err.message);
    return res.status(500).json({ error: 'Audit failed. Please try again.' });
  }
}

module.exports = handler;
