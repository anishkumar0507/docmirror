'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Google Places client — the single source of truth for all Places API calls.
//
// Used by:
//   • routes/audit.js          — initial doctor audit (doctor details + competitors)
//   • routes/weekly-check.js    — Monday Monitor refresh (re-fetch live metrics)
//
// placeDetails() requests the `reviews` field so callers can run review sentiment.
// findCompetitors() mirrors the original audit logic exactly (same-city only,
// no fabrication, top-3 by rating then review count).
// ─────────────────────────────────────────────────────────────────────────────

require('./env');
const { computePillarsV5 } = require('./audit-helpers');

const PLACES = 'https://maps.googleapis.com/maps/api/place';

async function textSearch(query, key) {
  const url = `${PLACES}/textsearch/json?query=${encodeURIComponent(query)}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`textSearch HTTP ${res.status}`);
  return res.json();
}

async function placeDetails(placeId, key) {
  // `reviews` powers weekly sentiment analysis; the audit flow simply ignores it.
  const fields = 'name,rating,user_ratings_total,formatted_address,address_components,types,opening_hours,website,photos,reviews';
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

// Normalise Google's place.reviews → [{ rating, text, time }] (max 5 returned by API)
function extractReviews(place) {
  const list = Array.isArray(place && place.reviews) ? place.reviews : [];
  return list.map(r => ({
    rating: typeof r.rating === 'number' ? r.rating : null,
    text:   String(r.text || '').trim(),
    time:   r.time || null,
  })).filter(r => r.text);
}

// ── Find real competitors via Google Places Text Search ────────────────────
async function findCompetitors(specialty, cityState, doctorPlaceId, key) {
  if (!cityState) {
    console.log('[comp] cityState missing — skipping');
    return [];
  }

  // Use only the city part — full "City, State" string degrades Google results
  const city = cityState.split(',')[0].trim();
  const sp   = resolveSpecialty(specialty);
  const query = `${sp} doctor in ${city}`;

  console.log('\n[comp] ══════════════════════════════════════');
  console.log(`[comp] specialty        : "${sp}"`);
  console.log(`[comp] city             : "${city}"`);
  console.log(`[comp] query            : "${query}"`);
  console.log(`[comp] exclude placeId  : ${doctorPlaceId || '(none)'}`);

  let googleResults = [];
  try {
    const data = await textSearch(query, key);
    console.log(`[comp] Google status: ${data.status}  total results: ${data.results?.length ?? 0}`);
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.error(`[comp] Google error: ${data.status} — ${data.error_message || '(no message)'}`);
      return [];
    }
    googleResults = data.results || [];
  } catch (err) {
    console.error(`[comp] textSearch failed: ${err.message}`);
    return [];
  }

  // Take top 10 from Google response
  const top10 = googleResults.slice(0, 10);
  console.log(`\n[comp] Top 10 from Google:`);
  top10.forEach((r, i) =>
    console.log(`  ${i + 1}. "${r.name}" | placeId: ${r.place_id} | ★${r.rating ?? '-'} | ${r.user_ratings_total ?? 0} reviews`)
  );

  // Remove the current doctor by exact placeId
  let withoutDoctor = top10.filter(r => r.place_id !== doctorPlaceId);
  console.log(`\n[comp] After removing current doctor: ${withoutDoctor.length} candidates`);

  // Enforce SAME city — keep only real listings whose address contains the city.
  const cityNorm = city.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (cityNorm) {
    const sameCity = withoutDoctor.filter(r => {
      const addr = (r.formatted_address || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      return addr.includes(cityNorm);
    });
    console.log(`[comp] Same-city filter ("${city}"): ${sameCity.length}/${withoutDoctor.length} kept`);
    // Only apply the filter when it leaves real candidates; otherwise the
    // address simply didn't echo the city — never fabricate to fill the gap.
    if (sameCity.length) withoutDoctor = sameCity;
    else { console.log('[comp] No same-city candidates — returning none (no fabrication)'); return []; }
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

// ── Weekly Monitor refresh ──────────────────────────────────────────────────
// Re-fetch a doctor's LIVE Google Places metrics + competitors + recent reviews.
// Returns null when no placeId / API key is available so the caller can fall
// back to the previously cached audit data. Never throws.
async function refreshDoctorData({ placeId, specialty, parentSpecialty, city }, key) {
  if (!placeId || !key) return null;
  try {
    const { result: place = {} } = await placeDetails(placeId, key);
    if (!place.name) return null;

    const rating      = typeof place.rating === 'number' ? place.rating : 0;
    const reviewCount = place.user_ratings_total || 0;
    const website     = place.website || null;
    const address     = place.formatted_address || '';
    const hasHours    = !!(place.opening_hours?.weekday_text?.length);
    const hoursText   = hasHours ? place.opening_hours.weekday_text[0] : null;
    const isOpenNow   = place.opening_hours?.open_now ?? null;
    const photoCount  = Array.isArray(place.photos) ? place.photos.length : 0;
    const reviews     = extractReviews(place);

    const competitors = await findCompetitors(parentSpecialty || specialty, city, placeId, key);

    return {
      businessName: place.name,
      rating, reviewCount, website, address,
      hasHours, hoursText, isOpenNow, photoCount,
      reviews, competitors,
    };
  } catch (err) {
    console.warn('[places] refreshDoctorData warn:', err.message);
    return null;
  }
}

module.exports = {
  PLACES,
  textSearch,
  placeDetails,
  calcScore,
  resolveSpecialty,
  extractReviews,
  findCompetitors,
  refreshDoctorData,
};
