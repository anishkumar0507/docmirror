'use strict';

// Load .env.local in local dev — Vercel injects env vars directly so this is a no-op there
if (!process.env.GOOGLE_PLACES_API_KEY) {
  try {
    require('dotenv').config({
      path: require('path').join(__dirname, '../config/.env.local')
    });
  } catch (_) { /* dotenv not installed yet */ }
}

const PLACES = 'https://maps.googleapis.com/maps/api/place';

// ── Google Places helpers ──────────────────────────────────────────────────
async function textSearch(query, key) {
  const url = `${PLACES}/textsearch/json?query=${encodeURIComponent(query)}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Places textSearch HTTP ${res.status}`);
  return res.json();
}

async function placeDetails(placeId, key) {
  const fields = 'name,rating,user_ratings_total,formatted_address,opening_hours,website,photos';
  const url = `${PLACES}/details/json?place_id=${placeId}&fields=${fields}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Places details HTTP ${res.status}`);
  return res.json();
}

// ── Visibility score algorithm ─────────────────────────────────────────────
function calcScore({ rating, reviewCount, website, hasHours, photoCount }) {
  let s = 0;

  // Rating — 5 stars = 40 pts (proportional)
  if (rating > 0) s += Math.round((rating / 5) * 40);

  // Reviews — max 25
  if (reviewCount >= 100)     s += 25;
  else if (reviewCount >= 20) s += 15;
  else if (reviewCount > 0)   s += 5;

  // Website — 15
  if (website) s += 15;

  // Business hours — 10
  if (hasHours) s += 10;

  // Photos — max 15
  if (photoCount >= 20)     s += 15;
  else if (photoCount >= 5) s += 10;
  else if (photoCount > 0)  s += 5;

  return Math.min(100, s);
}

// ── Main handler (Express + Vercel compatible) ─────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not configured' });
  }

  const { fn, ln, sp, ct } = req.body || {};
  if (!fn || !ln) {
    return res.status(400).json({ error: 'fn (firstName) and ln (lastName) are required' });
  }

  try {
    // 1. Build search query
    const query = ['Dr', fn, ln, sp, ct].filter(Boolean).join(' ');

    // 2. Text search
    const searchData = await textSearch(query, key);

    if (searchData.status === 'REQUEST_DENIED') {
      console.error('[audit] Places API denied:', searchData.error_message);
      return res.status(500).json({ error: 'Google Places API key is invalid or billing is not enabled' });
    }

    if (!searchData.results || searchData.results.length === 0) {
      return res.status(200).json({ notFound: true });
    }

    const placeId = searchData.results[0].place_id;

    // 3. Place details
    const detailsData = await placeDetails(placeId, key);
    const place = detailsData.result || {};

    if (!place.name) {
      return res.status(200).json({ notFound: true });
    }

    // 4. Extract fields
    const rating      = typeof place.rating === 'number' ? place.rating : 0;
    const reviewCount = place.user_ratings_total || 0;
    const website     = place.website || null;
    const address     = place.formatted_address || '';
    const hasHours    = !!(place.opening_hours?.weekday_text?.length);
    const hoursText   = hasHours ? place.opening_hours.weekday_text[0] : null;
    const isOpenNow   = place.opening_hours?.open_now ?? null;
    const photoCount  = Array.isArray(place.photos) ? place.photos.length : 0;

    // 5. Calculate visibility score
    const score = calcScore({ rating, reviewCount, website, hasHours, photoCount });

    return res.status(200).json({
      notFound:     false,
      source:       'google_places',
      doctorName:   `Dr. ${fn} ${ln}`,
      specialty:    sp || '',
      cityState:    ct || '',
      businessName: place.name,
      rating,
      reviewCount,
      website,
      address,
      hasHours,
      hoursText,
      isOpenNow,
      photoCount,
      score,
      placeId,
      googleMapsUrl: `https://www.google.com/maps/place/?q=place_id:${placeId}`
    });

  } catch (err) {
    console.error('[audit] error:', err.message);
    return res.status(500).json({ error: 'Audit failed. Please try again.' });
  }
};
