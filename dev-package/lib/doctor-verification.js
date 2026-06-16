'use strict';

/**
 * Doctor verification — strict, Google-Places-backed identity checks that run
 * BEFORE any preview / competitor data is generated.
 *
 * Confidence model (max 100):
 *   Doctor name match ... 70
 *   City match ......... 20
 *   Speciality match ... 10
 *
 * The flow only proceeds when confidence >= 90 AND no hard failure
 * (city mismatch, invalid/“Other” speciality, or a conflicting speciality).
 * Data accuracy is prioritised over showing results — when in doubt, we stop.
 */

const PASS_THRESHOLD = 90;

const WEIGHT = { name: 70, city: 20, specialty: 10 };

// ── Text normalisation ──────────────────────────────────────────────────────
// Strict: strip case, accents, punctuation AND spaces → for equality checks.
function normalize(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}
// Loose: keep word boundaries → for keyword/substring matching.
function loose(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ── Speciality keyword map (positive signals in listing name / Places types) ─
const SPECIALTY_KEYWORDS = {
  'family medicine':      ['family medicine', 'family physician', 'family practice', 'family doctor'],
  'general practitioner': ['general practitioner', 'general physician', 'general practice', 'family physician'],
  'internal medicine':    ['internal medicine', 'internist', 'physician'],
  'pediatrician':         ['pediatric', 'paediatric', 'child specialist', 'children'],
  'cardiologist':         ['cardiolog', 'cardiac', 'heart'],
  'dermatologist':        ['dermatolog', 'skin', 'cosmetolog'],
  'gastroenterologist':   ['gastroenterolog', 'gastro', 'digestive', 'liver', 'hepato'],
  'neurologist':          ['neurolog', 'neuro', 'nerve', 'brain'],
  'ob/gyn':               ['gynec', 'gynaec', 'obstetric', 'obgyn', 'maternity', 'women'],
  'oncologist':           ['oncolog', 'cancer', 'tumor', 'tumour'],
  'ophthalmologist':      ['ophthalm', 'eye', 'retina', 'vision'],
  'orthopedic surgeon':   ['orthop', 'ortho', 'bone', 'joint', 'spine'],
  'psychiatrist':         ['psychiatr', 'mental health', 'psycholog'],
  'pulmonologist':        ['pulmonolog', 'chest', 'respiratory', 'lung'],
  'urologist':            ['urolog', 'kidney', 'nephro'],
  'dentist':              ['dental', 'dentist', 'dentistry', 'orthodont'],
  'oral surgeon':         ['oral surgeon', 'maxillofacial', 'oral and maxillofacial', 'dental'],
};

// Which user specialities count as "dental" (so a Places `dentist` type is fine)
const DENTAL_SET = new Set(['dentist', 'oral surgeon']);

// Google Places primary `types` that strongly imply a DIFFERENT practice.
const CONFLICTING_PLACES_TYPES = ['veterinary_care', 'pharmacy', 'physiotherapist'];

// Shared master specialty database (single source of truth, also used by the
// browser combobox). Lets verification pull rich keywords for ANY of the 300+
// specialties without duplicating data here. Optional — falls back gracefully.
let SPECIALTY_DB = null;
try { SPECIALTY_DB = require('../public/js/medical-specialties.js'); } catch (e) { SPECIALTY_DB = null; }

const DENTAL_CATEGORIES = new Set(['dental', 'oral & maxillofacial surgery']);

// Collect positive keyword signals for a selected specialty + its parent,
// drawing from the master DB when available.
function specialtyKeywords(userSpecialty, parentSpecialty) {
  const out = new Set();
  const add = w => { const v = loose(w); if (v) out.add(v); };
  let isDental = false;

  [userSpecialty, parentSpecialty].forEach(label => {
    const name = String(label || '').trim();
    if (!name) return;
    add(name);
    const key = name.toLowerCase();
    if (DENTAL_SET.has(key)) isDental = true;
    if (SPECIALTY_KEYWORDS[key]) SPECIALTY_KEYWORDS[key].forEach(add);
    if (SPECIALTY_DB && SPECIALTY_DB.findByName) {
      const entry = SPECIALTY_DB.findByName(name);
      if (entry) {
        (entry.keywords || []).forEach(add);
        add(entry.parentSpecialty);
        if (DENTAL_CATEGORIES.has(String(entry.category).toLowerCase())) isDental = true;
      }
    }
  });
  return { keywords: Array.from(out), isDental };
}

// ── 1. City extraction from Google Places details ───────────────────────────
function extractCity(place) {
  const comps = (place && place.address_components) || [];
  const pick = (...types) => {
    for (const t of types) {
      const c = comps.find(cc => Array.isArray(cc.types) && cc.types.includes(t));
      if (c && c.long_name) return c.long_name;
    }
    return '';
  };
  let city = pick('locality', 'postal_town', 'administrative_area_level_3',
                  'sublocality_level_1', 'sublocality', 'administrative_area_level_2');
  if (!city && place && place.formatted_address) {
    // Fallback: ".., City, State PIN, Country" → city is usually 3rd from the end.
    const parts = place.formatted_address.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 3) city = parts[parts.length - 3];
    else if (parts.length) city = parts[0];
    // strip any trailing postal digits
    city = city.replace(/\d{4,}/g, '').trim();
  }
  return city || '';
}

// ── 2. Name match ───────────────────────────────────────────────────────────
function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
function diceCoefficient(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

// Returns { score: 0..70, matched: bool }
function nameMatch(firstName, lastName, listingName) {
  const hay = loose(listingName);
  const f = loose(firstName);
  const l = loose(lastName);
  const fIn = f.length > 1 && hay.split(' ').some(w => w.includes(f) || f.includes(w));
  const lIn = l.length > 1 && hay.split(' ').some(w => w.includes(l) || l.includes(w));

  if (fIn && lIn) return { score: 70, matched: true };
  if (lIn)        return { score: 70, matched: true }; // surname is distinctive
  if (fIn)        return { score: 60, matched: true };

  // Fuzzy fallback on the full name vs the listing name
  const full = normalize(`${firstName} ${lastName}`);
  const sim = diceCoefficient(full, normalize(listingName));
  if (sim >= 0.7) return { score: 70, matched: true };
  if (sim >= 0.55) return { score: 60, matched: true };
  return { score: 0, matched: false };
}

// ── 3. City match ───────────────────────────────────────────────────────────
// Returns { score: 0|20, matched: bool, actualCity }
function cityMatch(userCity, place) {
  const actualCity = extractCity(place);
  const u = normalize((userCity || '').split(',')[0]);
  const a = normalize(actualCity);
  if (!u || !a) return { score: 0, matched: false, actualCity };
  const matched = u === a || a.includes(u) || u.includes(a);
  return { score: matched ? WEIGHT.city : 0, matched, actualCity };
}

// ── 4. Speciality match ─────────────────────────────────────────────────────
// status: 'match' | 'unconfirmed' | 'invalid' | 'conflict'
// Uses BOTH the selected specialty and its parentSpecialty (e.g. "Interventional
// Cardiologist" + parent "Cardiologist") for keyword/conflict checks.
function specialtyMatch(userSpecialty, listingName, placeTypes, parentSpecialty) {
  const sp = String(userSpecialty || '').trim().toLowerCase();
  if (!sp || sp === 'other') {
    return { status: 'invalid', score: 0, matched: false };
  }

  const types = (placeTypes || []).map(t => String(t).toLowerCase());
  const hay = loose([listingName, ...types].join(' '));
  const { keywords, isDental } = specialtyKeywords(userSpecialty, parentSpecialty);

  // Positive signal in the listing name or Places types
  const positive = keywords.some(k => k && hay.includes(k));
  if (positive) return { status: 'match', score: WEIGHT.specialty, matched: true };

  // Hard conflicts from reliable Google Places `types`
  if (types.includes('dentist') && !isDental) {
    return { status: 'conflict', score: 0, matched: false };
  }
  if (isDental && (types.includes('doctor') && !types.includes('dentist') &&
       !hay.includes('dental') && !hay.includes('dentist'))) {
    return { status: 'conflict', score: 0, matched: false };
  }
  if (CONFLICTING_PLACES_TYPES.some(t => types.includes(t))) {
    return { status: 'conflict', score: 0, matched: false };
  }

  // Google rarely exposes granular specialities (most listings are clinic names).
  // No positive signal and no conflict → unconfirmed (partial credit).
  return { status: 'unconfirmed', score: 8, matched: false };
}

// ── Top-level verification ──────────────────────────────────────────────────
/**
 * @param {object} input  { firstName, lastName, specialty, userCity }
 * @param {object} place  Google Places Details result (name, address_components, types, ...)
 * @returns {object} verdict
 */
function verifyDoctor(input, place) {
  const listingName = (place && place.name) || '';
  const types = (place && place.types) || [];

  const name = nameMatch(input.firstName, input.lastName, listingName);
  const city = cityMatch(input.userCity, place);
  const spec = specialtyMatch(input.specialty, listingName, types, input.parentSpecialty);

  const confidence = name.score + city.score + spec.score;

  const checks = {
    name:      { matched: name.matched, score: name.score, weight: WEIGHT.name, listingName },
    city:      { matched: city.matched, score: city.score, weight: WEIGHT.city,
                 entered: (input.userCity || '').split(',')[0].trim(), actual: city.actualCity },
    specialty: { status: spec.status, score: spec.score, weight: WEIGHT.specialty,
                 entered: input.specialty || '', parent: input.parentSpecialty || '' },
    confidence,
    threshold: PASS_THRESHOLD,
  };

  // Hard failures (stop immediately — accuracy over results) ───────────────
  if (!name.matched) {
    return { verified: false, reason: 'not_found', confidence, checks,
      message: "We couldn't verify this doctor. Please check the doctor's name and location." };
  }
  if (!city.matched) {
    return { verified: false, reason: 'city_mismatch', confidence, checks,
      message: "We couldn't verify this doctor in the city you entered. Please check the city." };
  }
  if (spec.status === 'invalid') {
    return { verified: false, reason: 'specialty_invalid', confidence, checks,
      message: "Please select the doctor's actual speciality — “Other” can't be verified." };
  }
  if (spec.status === 'conflict') {
    return { verified: false, reason: 'specialty_mismatch', confidence, checks,
      message: "The speciality you entered doesn't match this doctor's listing. Please check the speciality." };
  }

  // Confidence gate ────────────────────────────────────────────────────────
  if (confidence < PASS_THRESHOLD) {
    return { verified: false, reason: 'low_confidence', confidence, checks,
      message: "We couldn't confidently verify this doctor. Please check the entered details." };
  }

  return {
    verified: true,
    confidence,
    checks,
    actualCity: city.actualCity,
  };
}

module.exports = {
  verifyDoctor,
  extractCity,
  nameMatch,
  cityMatch,
  specialtyMatch,
  normalize,
  loose,
  PASS_THRESHOLD,
  WEIGHT,
};
