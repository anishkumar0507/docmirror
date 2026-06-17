'use strict';

require('../lib/env');

/**
 * GET /api/doctors/autocomplete?query=jayesh sar&city=rajkot
 *
 * Google-style doctor name suggestions — REAL Google Places results only.
 * Never returns fabricated/guessed names. If Places finds nothing medical,
 * returns an empty array and the UI shows the "no verified doctor" state.
 */

const PLACES = 'https://maps.googleapis.com/maps/api/place';

// Google Places `types` that indicate a genuine medical practice/clinic.
const MEDICAL_TYPES = [
  'doctor', 'hospital', 'dentist', 'physiotherapist', 'health',
  'medical_clinic', 'veterinary_care', 'pharmacy',
];

// Minimal type → specialty hints (Places rarely exposes granular specialty).
const TYPE_SPECIALTY = {
  dentist: 'Dentist',
  physiotherapist: 'Physiotherapist',
  veterinary_care: 'Veterinarian',
};

async function textSearch(query, key) {
  const url = `${PLACES}/textsearch/json?query=${encodeURIComponent(query)}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`textSearch HTTP ${res.status}`);
  return res.json();
}

// Parse a display city from a Google formatted_address (best-effort; the final
// audit re-derives the exact city from address_components via placeId).
function cityFromAddress(addr) {
  if (!addr) return '';
  const parts = String(addr).split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return '';
  // "Area, City, State PIN, Country" (India) and "St, City, ST ZIP, USA" both put
  // the city 3rd from the end. Matches doctor-verification's extractCity fallback.
  let city = parts.length >= 3 ? parts[parts.length - 3] : parts[0];
  return city.replace(/\b\d{4,6}\b/g, '').trim();
}

function specialtyFromTypes(types) {
  for (const t of (types || [])) if (TYPE_SPECIALTY[t]) return TYPE_SPECIALTY[t];
  return '';
}

// Is this a real medical result (clinic/hospital/doctor) vs random business?
function isMedical(r) {
  const types = r.types || [];
  if (types.some(t => MEDICAL_TYPES.includes(t))) return true;
  return /\bdr\.?\b|clinic|hospital|medical|dental|health|care\b/i.test(r.name || '');
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not configured' });

  const query = String((req.query && req.query.query) || '').trim();
  const city  = String((req.query && req.query.city)  || '').trim();

  // Require >= 3 chars (the UI also enforces this).
  if (query.length < 3) return res.status(200).json([]);

  // "doctor name + city" — bias toward medical results.
  const searchQuery = [query, city, 'doctor'].filter(Boolean).join(' ');

  try {
    const data = await textSearch(searchQuery, key);

    if (data.status === 'REQUEST_DENIED') {
      console.error('[autocomplete] Places REQUEST_DENIED:', data.error_message || '');
      return res.status(500).json({ error: 'Google Places API key invalid or billing not enabled' });
    }
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.error(`[autocomplete] Places ${data.status}: ${data.error_message || ''}`);
    }

    const results = (data.results || [])
      .filter(isMedical)
      .slice(0, 6)
      .map(r => ({
        placeId:     r.place_id,
        doctorName:  r.name,
        clinicName:  '',                       // Places exposes a single name field
        specialty:   specialtyFromTypes(r.types),
        city:        cityFromAddress(r.formatted_address),
        address:     r.formatted_address || '',
        rating:      typeof r.rating === 'number' ? r.rating : 0,
        reviewCount: r.user_ratings_total || 0,
        source:      'google_places',
      }));

    return res.status(200).json(results);
  } catch (err) {
    console.error('[autocomplete] error:', err.message);
    return res.status(500).json({ error: 'Autocomplete failed' });
  }
}

module.exports = handler;
