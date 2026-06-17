/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — Doctor Place-Result Parser

   Google Places titles are messy marketing strings, e.g.
     "Fortis - Dr. Jayesh Sardhara - Best Neurosurgeon in Mulund, Mumbai"
   This module extracts ONLY clean, structured doctor data from them:
     { firstName, lastName, fullName, specialty, city, clinicName, ... }

   Shared by the browser (autocomplete selection) AND the Node backend
   (so the preview/verification never uses the raw Places title).
   ────────────────────────────────────────────────────────────────────────── */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DoctorNameParser = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Layman / marketing phrasing → canonical specialty (must match the master DB).
  var SPECIALTY_SYNONYMS = {
    'neuro surgeon': 'Neurosurgeon', 'neurosurgeon': 'Neurosurgeon', 'brain surgeon': 'Neurosurgeon',
    'neuro physician': 'Neurologist', 'neurologist': 'Neurologist',
    'skin specialist': 'Dermatologist', 'skin doctor': 'Dermatologist', 'dermatologist': 'Dermatologist',
    'heart specialist': 'Cardiologist', 'heart doctor': 'Cardiologist', 'cardiologist': 'Cardiologist',
    'cardiac surgeon': 'Cardiac Surgeon', 'heart surgeon': 'Cardiac Surgeon',
    'bone doctor': 'Orthopedic Surgeon', 'bone specialist': 'Orthopedic Surgeon',
    'orthopaedic surgeon': 'Orthopedic Surgeon', 'orthopedic surgeon': 'Orthopedic Surgeon',
    'orthopaedic': 'Orthopedic Surgeon', 'orthopedic': 'Orthopedic Surgeon', 'ortho surgeon': 'Orthopedic Surgeon',
    'child specialist': 'Pediatrician', 'child doctor': 'Pediatrician',
    'paediatrician': 'Pediatrician', 'pediatrician': 'Pediatrician',
    'diabetes specialist': 'Diabetologist', 'diabetologist': 'Diabetologist',
    'women specialist': 'Gynecologist', 'lady doctor': 'Gynecologist',
    'gynaecologist': 'Gynecologist', 'gynecologist': 'Gynecologist',
    'eye specialist': 'Ophthalmologist', 'eye doctor': 'Ophthalmologist', 'ophthalmologist': 'Ophthalmologist',
    'ent specialist': 'ENT Specialist', 'ear nose throat': 'ENT Specialist',
    'kidney specialist': 'Nephrologist', 'nephrologist': 'Nephrologist',
    'dental': 'Dentist', 'dentist': 'Dentist',
    'cancer specialist': 'Oncologist', 'oncologist': 'Oncologist',
    'stomach specialist': 'Gastroenterologist', 'gastroenterologist': 'Gastroenterologist',
    'chest specialist': 'Pulmonologist', 'lung specialist': 'Pulmonologist', 'pulmonologist': 'Pulmonologist',
    'piles specialist': 'Proctologist',
  };

  // Name prefixes to strip.
  var PREFIXES = ['dr', 'doctor', 'prof', 'professor', 'mr', 'mrs', 'ms', 'miss', 'md', 'sri', 'smt'];

  // Tokens that END the doctor's name (specialty/role/clinic/marketing/location).
  var STOP_WORDS = [
    // clinic / facility
    'clinic', 'clinics', 'hospital', 'hospitals', 'centre', 'center', 'medical', 'medicare',
    'healthcare', 'health', 'care', 'polyclinic', 'multispeciality', 'multispecialty',
    'nursing', 'diagnostics', 'diagnostic', 'laboratory', 'labs', 'lab', 'institute',
    'foundation', 'trust', 'pharmacy', 'speciality', 'specialty',
    // role / specialty
    'surgeon', 'physician', 'specialist', 'consultant', 'doctor', 'dentist', 'dermatologist',
    'cardiologist', 'neurologist', 'neurosurgeon', 'orthopedic', 'orthopaedic', 'orthopedist',
    'pediatrician', 'paediatrician', 'gynecologist', 'gynaecologist', 'ophthalmologist',
    'urologist', 'nephrologist', 'oncologist', 'psychiatrist', 'pulmonologist', 'gastroenterologist',
    'neuro', 'cardiac', 'ortho', 'ent', 'pediatric', 'paediatric', 'endocrinologist',
    // marketing
    'best', 'top', 'leading', 'famous', 'renowned', 'expert', 'trusted', 'award',
    // organ / condition descriptors that precede "specialist/doctor/surgeon/care"
    'heart', 'skin', 'bone', 'child', 'eye', 'kidney', 'liver', 'chest', 'lung', 'lungs',
    'brain', 'nerve', 'cancer', 'dental', 'diabetes', 'women', 'hair', 'teeth', 'tooth',
    'joint', 'spine', 'stomach', 'piles', 'thyroid', 'fertility', 'mental',
    // location connectors
    'in', 'near', 'at',
  ];

  var PREFIX_SET = toSet(PREFIXES);
  var STOP_SET = toSet(STOP_WORDS);
  var CLINIC_WORDS = toSet(['clinic', 'clinics', 'hospital', 'hospitals', 'centre', 'center',
    'medical', 'healthcare', 'health', 'care', 'polyclinic', 'multispeciality', 'multispecialty',
    'nursing', 'diagnostics', 'institute', 'foundation', 'pharmacy']);

  function toSet(arr) { var s = {}; for (var i = 0; i < arr.length; i++) s[arr[i]] = true; return s; }
  function cleanTok(w) { return String(w).toLowerCase().replace(/[^a-z]/g, ''); }
  function titleCase(w) {
    w = w.replace(/[^A-Za-z'\-]/g, '');
    if (!w) return '';
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }
  function looseText(s) {
    return ' ' + String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  }

  function dbList() {
    var DB = (typeof module !== 'undefined' && module.exports)
      ? safeRequire('./medical-specialties.js')
      : (typeof window !== 'undefined' ? window.MEDICAL_SPECIALTIES : null);
    return DB;
  }
  function safeRequire(p) { try { return require(p); } catch (e) { return null; } }

  // Extract clean name tokens from a single segment (e.g. "Dr. Jayesh Sardhara").
  function nameTokens(seg) {
    var words = String(seg).trim().split(/\s+/);
    // strip leading prefixes (possibly several, e.g. "Prof Dr")
    while (words.length && PREFIX_SET[cleanTok(words[0])]) words.shift();
    var out = [];
    for (var i = 0; i < words.length; i++) {
      var c = cleanTok(words[i]);
      if (!c) continue;                 // pure punctuation/number
      if (STOP_SET[c]) break;           // hit specialty/clinic/marketing → name ends
      if (!/[a-z]/i.test(words[i])) break;
      var t = titleCase(words[i]);
      if (t) out.push(t);
      if (out.length >= 4) break;       // names are rarely longer; avoid trailing junk
    }
    return out;
  }

  // Detect canonical specialty from the raw Places title / types.
  function detectSpecialty(rawName, types) {
    var hay = looseText(rawName);

    // 1. Synonym phrases (longest first so "cardiac surgeon" beats "surgeon").
    var keys = Object.keys(SPECIALTY_SYNONYMS).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < keys.length; i++) {
      if (hay.indexOf(' ' + keys[i] + ' ') !== -1 || hay.indexOf(keys[i]) !== -1) {
        return SPECIALTY_SYNONYMS[keys[i]];
      }
    }

    // 2. Exact canonical specialty names from the master DB (longest first).
    var DB = dbList();
    if (DB && DB.SPECIALTIES) {
      var names = DB.SPECIALTIES.map(function (s) { return s.name; })
        .sort(function (a, b) { return b.length - a.length; });
      for (var j = 0; j < names.length; j++) {
        if (hay.indexOf(' ' + names[j].toLowerCase() + ' ') !== -1) return names[j];
      }
    }

    // 3. Google Places types.
    var t = (types || []).map(function (x) { return String(x).toLowerCase(); });
    if (t.indexOf('dentist') !== -1) return 'Dentist';
    if (t.indexOf('physiotherapist') !== -1) return 'Physiotherapist';

    return '';
  }

  function detectClinic(segments, nameSeg) {
    for (var i = 0; i < segments.length; i++) {
      if (segments[i] === nameSeg) continue;
      var words = segments[i].split(/\s+/).map(cleanTok);
      for (var j = 0; j < words.length; j++) {
        if (CLINIC_WORDS[words[j]]) return segments[i].trim();
      }
    }
    return '';
  }

  function cityFromAddress(addr) {
    if (!addr) return '';
    var parts = String(addr).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!parts.length) return '';
    var city = parts.length >= 3 ? parts[parts.length - 3] : parts[0];
    return city.replace(/\b\d{4,6}\b/g, '').trim();
  }

  /**
   * parseDoctorPlaceResult(place)
   * place: { doctorName|name|rawPlaceName, types, address|formattedAddress, city, placeId, specialty }
   */
  function parseDoctorPlaceResult(place) {
    place = place || {};
    var raw = String(place.doctorName || place.name || place.rawPlaceName || '').trim();
    var formattedAddress = place.address || place.formattedAddress || '';

    // Split into segments on common Places separators.
    var segments = raw.split(/\s*[-–—|•:]\s*|,\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!segments.length) segments = [raw];

    // Prefer the segment that names a person (contains Dr/Doctor/Prof).
    var nameSeg = null;
    for (var i = 0; i < segments.length; i++) {
      if (/\b(dr|doctor|prof|professor)\b\.?/i.test(segments[i])) { nameSeg = segments[i]; break; }
    }
    // Otherwise the first segment that yields real name tokens.
    if (!nameSeg) {
      for (var k = 0; k < segments.length; k++) {
        if (nameTokens(segments[k]).length) { nameSeg = segments[k]; break; }
      }
    }
    if (!nameSeg) nameSeg = segments[0] || raw;

    var tokens = nameTokens(nameSeg);
    var firstName = tokens[0] || '';
    var lastName = tokens.slice(1).join(' ');
    var fullName = firstName ? ('Dr. ' + [firstName, lastName].filter(Boolean).join(' ')) : '';

    var specialty = detectSpecialty(raw, place.types);
    var clinicName = detectClinic(segments, nameSeg);
    var city = place.city || cityFromAddress(formattedAddress) || '';

    return {
      firstName: firstName,
      lastName: lastName,
      fullName: fullName,
      specialty: specialty,
      city: city,
      clinicName: clinicName,
      placeId: place.placeId || '',
      rawPlaceName: raw,
      formattedAddress: formattedAddress,
    };
  }

  // True when a user-selected specialty contradicts the Google-detected one.
  function specialtyConflict(selected, detected) {
    var s = norm(selected), d = norm(detected);
    if (!s || !d || s === d) return false;
    var DB = dbList();
    if (DB && DB.findByName) {
      var se = DB.findByName(selected), de = DB.findByName(detected);
      if (se && de) {
        if (norm(se.category) === norm(de.category)) return false;       // same field
        if (norm(se.parentSpecialty) === norm(detected)) return false;   // detected is parent
        if (norm(de.parentSpecialty) === norm(selected)) return false;   // selected is parent
        return true;
      }
    }
    return true; // differing free-text specialties → treat as conflict
  }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  return {
    parseDoctorPlaceResult: parseDoctorPlaceResult,
    detectSpecialty: detectSpecialty,
    specialtyConflict: specialtyConflict,
    SPECIALTY_SYNONYMS: SPECIALTY_SYNONYMS,
  };
});
