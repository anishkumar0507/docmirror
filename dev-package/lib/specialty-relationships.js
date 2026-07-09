'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Specialty relationship map + helpers.
//
// Google Places categories are broad ("Neurosurgeon", "Dentist", "Cardiologist")
// and often differ from the precise specialty a doctor actually practises
// ("Spine Surgeon", "Implantologist", "Interventional Cardiologist"). The doctor's
// own specialty is ALWAYS primary; Google's is informational only.
//
// This module powers two things:
//   1. relatedSearchTerms()  — competitor discovery across related specialties
//      (priority: user specialty → google category → related map → parent).
//   2. detectGoogleSpecialty()/specialtyDiffers() — the informational notice.
//
// It is additive and never blocks: an unknown / custom specialty just falls back
// to itself (+ its parent), so any doctor can use their real specialty.
// ─────────────────────────────────────────────────────────────────────────────

let SPECIALTY_DB = null;
try { SPECIALTY_DB = require('../public/js/medical-specialties.js'); } catch (e) { SPECIALTY_DB = null; }

function norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ── Relationship groups ──────────────────────────────────────────────────────
// Each group lists specialties that compete for the same patients. Order inside
// a group is rough "closeness". Membership is matched loosely (normalized
// substring) so "Orthopedic Spine Surgeon" still maps to the Spine group.
const GROUPS = [
  { key: 'spine',         terms: ['Spine Surgeon', 'Orthopedic Spine Surgeon', 'Neurosurgeon', 'Spine Specialist', 'Orthopedic Surgeon'] },
  { key: 'dental',        terms: ['Dentist', 'Implantologist', 'Cosmetic Dentist', 'Pediatric Dentist', 'Prosthodontist', 'Orthodontist', 'Endodontist', 'Periodontist'] },
  { key: 'cardiology',    terms: ['Cardiologist', 'Interventional Cardiologist', 'Electrophysiologist', 'Heart Specialist'] },
  { key: 'orthopedics',   terms: ['Orthopedic Surgeon', 'Sports Medicine Specialist', 'Joint Replacement Surgeon', 'Spine Surgeon', 'Arthroscopy Surgeon'] },
  { key: 'endocrinology', terms: ['Endocrinologist', 'Diabetologist', 'Thyroid Specialist'] },
  { key: 'obgyn',         terms: ['Obstetrician-Gynecologist', 'Gynecologist', 'Obstetrician', 'Fertility Specialist', 'IVF Specialist'] },
  { key: 'pain',          terms: ['Pain Specialist', 'Pain Management Specialist', 'Anesthesiologist'] },
  { key: 'dermatology',   terms: ['Dermatologist', 'Cosmetic Dermatologist', 'Trichologist', 'Skin Specialist'] },
  { key: 'gastro',        terms: ['Gastroenterologist', 'Hepatologist', 'Endoscopist'] },
  { key: 'neurology',     terms: ['Neurologist', 'Neurophysician', 'Epileptologist'] },
  { key: 'nephrology',    terms: ['Nephrologist', 'Kidney Specialist'] },
  { key: 'urology',       terms: ['Urologist', 'Andrologist', 'Uro-oncologist'] },
  { key: 'ent',           terms: ['ENT Specialist', 'Otolaryngologist', 'Rhinologist', 'Audiologist'] },
  { key: 'ophthalmology', terms: ['Ophthalmologist', 'Eye Specialist', 'Retina Specialist', 'Cataract Surgeon'] },
  { key: 'oncology',      terms: ['Oncologist', 'Medical Oncologist', 'Surgical Oncologist', 'Radiation Oncologist', 'Cancer Specialist'] },
  { key: 'pediatrics',    terms: ['Pediatrician', 'Neonatologist', 'Pediatric Surgeon', 'Child Specialist'] },
  { key: 'psychiatry',    terms: ['Psychiatrist', 'Child Psychiatrist', 'Addiction Psychiatrist'] },
  { key: 'pulmonology',   terms: ['Pulmonologist', 'Chest Specialist', 'Respiratory Specialist'] },
];

// ── Google-category detection keywords (best-effort) ─────────────────────────
// Google Places `types` for clinics are generic, so we also scan the listing
// name. Maps a found keyword → a friendly Google-category label. First hit wins.
const GOOGLE_KEYWORDS = [
  ['neurosurg',        'Neurosurgeon'],
  ['orthopedic surgeon', 'Orthopedic Surgeon'],
  ['orthopaedic',      'Orthopedic Surgeon'],
  ['cardiolog',        'Cardiologist'],
  ['dental',           'Dentist'],
  ['dentist',          'Dentist'],
  ['dermatolog',       'Dermatologist'],
  ['gastroenterolog',  'Gastroenterologist'],
  ['neurolog',         'Neurologist'],
  ['gynec',            'Obstetrician-Gynecologist'],
  ['gynaec',           'Obstetrician-Gynecologist'],
  ['obstetric',        'Obstetrician-Gynecologist'],
  ['oncolog',          'Oncologist'],
  ['ophthalmolog',     'Ophthalmologist'],
  ['endocrinolog',     'Endocrinologist'],
  ['nephrolog',        'Nephrologist'],
  ['urolog',           'Urologist'],
  ['pulmonolog',       'Pulmonologist'],
  ['psychiatr',        'Psychiatrist'],
  ['pediatric',        'Pediatrician'],
  ['paediatric',       'Pediatrician'],
  ['anesthesiolog',    'Anesthesiologist'],
  ['anaesthesiolog',   'Anesthesiologist'],
  ['physiotherap',     'Physiotherapist'],
];

/** Find the relationship group(s) a specialty belongs to (loose match). */
function groupsFor(specialty) {
  const s = norm(specialty);
  if (!s) return [];
  return GROUPS.filter(g => g.terms.some(t => {
    const n = norm(t);
    return n === s || s.includes(n) || n.includes(s);
  }));
}

/**
 * Ordered, de-duplicated specialty search terms for competitor discovery.
 * Priority: user specialty → google category → related group → parent specialty.
 * Capped so competitor search stays cheap. Always includes the user specialty.
 */
function relatedSearchTerms(userSpecialty, parentSpecialty, googleSpecialty, max) {
  const cap = max || 4;
  const out = [];
  const seen = new Set();
  const push = (label) => {
    const v = String(label || '').trim();
    if (!v) return;
    const k = norm(v);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(v);
  };

  // #1 user specialty (always primary)
  push(userSpecialty);
  // #2 google category (broad but real)
  push(googleSpecialty);
  // #3 related-map siblings (explicit groups first, then master-DB same-category)
  groupsFor(userSpecialty).forEach(g => g.terms.forEach(push));
  if (SPECIALTY_DB && SPECIALTY_DB.findByName) {
    const entry = SPECIALTY_DB.findByName(userSpecialty);
    if (entry && Array.isArray(SPECIALTY_DB.SPECIALTIES)) {
      SPECIALTY_DB.SPECIALTIES
        .filter(e => norm(e.category) === norm(entry.category))
        .slice(0, 4)
        .forEach(e => push(e.name));
    }
  }
  // #4 parent specialty
  push(parentSpecialty);

  return out.slice(0, cap);
}

/** Best-effort Google category from Places types + listing name. '' if unknown. */
function detectGoogleSpecialty(place) {
  const name  = norm((place && place.name) || '');
  const types = ((place && place.types) || []).map(t => norm(t));
  const hay   = (name + ' ' + types.join(' ')).trim();
  if (!hay) return '';
  for (const [kw, label] of GOOGLE_KEYWORDS) {
    if (hay.includes(norm(kw))) return label;
  }
  // Generic Places types when no specialty keyword is present.
  if (types.includes('dentist')) return 'Dentist';
  return '';
}

/**
 * Do the user's specialty and Google's category meaningfully differ?
 * Same group (e.g. "Spine Surgeon" vs "Neurosurgeon") → still differs (the user
 * specialty is more precise), but identical / parent-equal → no notice.
 */
function specialtyDiffers(userSpecialty, googleSpecialty) {
  const u = norm(userSpecialty), g = norm(googleSpecialty);
  if (!u || !g) return false;
  if (u === g) return false;
  if (u.includes(g) || g.includes(u)) return false; // e.g. "interventional cardiologist" vs "cardiologist"
  return true;
}

/** Informational (never blocking) message describing the difference. */
function specialtyNotice(userSpecialty, googleSpecialty) {
  if (!specialtyDiffers(userSpecialty, googleSpecialty)) return '';
  return `Google currently categorizes this practice as ${googleSpecialty}. ` +
         `Your visibility analysis will use the specialty you selected: ${userSpecialty}.`;
}

module.exports = {
  GROUPS,
  groupsFor,
  relatedSearchTerms,
  detectGoogleSpecialty,
  specialtyDiffers,
  specialtyNotice,
  norm,
};
