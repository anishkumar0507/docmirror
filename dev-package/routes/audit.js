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

const { verifyDoctor, nameMatch, extractCity, specialtyMatch } = require('../lib/doctor-verification');
const { textSearch, placeDetails, findCompetitors } = require('../lib/places-client');
let parsePlace = null;
try { parsePlace = require('../public/js/doctor-name-parser.js').parseDoctorPlaceResult; } catch (e) { parsePlace = null; }

// ── Startup key check — visible immediately when server boots ─────────────
const _startupKey = process.env.GOOGLE_PLACES_API_KEY;
if (_startupKey) {
  console.log(`[audit] GOOGLE_PLACES_API_KEY loaded ✓  (ends: ...${_startupKey.slice(-4)})`);
} else {
  console.error('[audit] GOOGLE_PLACES_API_KEY MISSING — set it in config/.env.local');
}

// ── Google Places helpers ──────────────────────────────────────────────────
// textSearch / placeDetails / findCompetitors now live in ../lib/places-client
// so the weekly Monitor refresh can reuse the exact same fetch + ranking logic.

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

  const { fn, ln, sp, spp, ct, placeId: selectedPlaceId } = req.body || {};
  if (!fn || !ln) {
    return res.status(400).json({ error: 'fn and ln (firstName, lastName) are required' });
  }
  // parentSpecialty (spp) from the combobox; fall back to the selected specialty.
  const parentSp = (spp && String(spp).trim()) || sp || '';

  try {
    // 1. Resolve the doctor's place_id. If the user picked an autocomplete
    //    suggestion we trust that exact Place ID; otherwise text-search.
    let placeId = (selectedPlaceId && String(selectedPlaceId).trim()) || '';
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
      if (!searchData.results?.length) {
        return res.status(200).json({
          verified: false, notFound: true, reason: 'not_found',
          message: "We couldn't verify this doctor. Please check the doctor's name and location."
        });
      }
      placeId = searchData.results[0].place_id;
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

    if (selectedPlaceId) {
      // Re-derive a clean name from the verified listing as a safety net.
      if (parsePlace) {
        const pn = parsePlace({ doctorName: place.name, types: place.types, address: place.formatted_address });
        if (pn && pn.firstName) { displayFn = pn.firstName; displayLn = pn.lastName || ''; }
      }
      // The user explicitly picked this exact doctor from the verified
      // autocomplete → identity & city are confirmed by Place ID (the strongest
      // signal). We still require a valid, non-conflicting speciality.
      const spec = specialtyMatch(sp, place.name, place.types, parentSp);
      verifiedCity = extractCity(place) || (ct || '').split(',')[0].trim();
      console.log(`[audit] verification(placeId): listing="${place.name}" actualCity="${verifiedCity}" specialty="${sp || ''}" specStatus=${spec.status}`);
      if (spec.status === 'invalid') {
        return res.status(200).json({ verified: false, reason: 'specialty_invalid',
          message: "Please select the doctor's actual speciality — “Other” can't be verified." });
      }
      if (spec.status === 'conflict') {
        return res.status(200).json({ verified: false, reason: 'specialty_mismatch',
          message: "The speciality you entered doesn't match this doctor's listing. Please check the speciality." });
      }
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
      specialty:       sp || '',
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

    // Find real competitors from Google Places — SAME city (verified, canonical)
    // and SAME speciality only (uses parentSpecialty so e.g. "Interventional
    // Cardiologist" matches other cardiologists). No Anthropic, no placeholders, max 3.
    const competitors = await findCompetitors(parentSp || sp, verifiedCity, placeId, placesKey);

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
