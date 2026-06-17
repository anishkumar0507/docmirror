'use strict';

/**
 * Monthly Campaign Engine — Topical Content Intelligence.
 *
 * Given (month, specialty, region) it surfaces the most relevant medical
 * awareness observance from lib/awareness-calendar.json and generates a
 * ready-to-use content pack (reels, GBP posts, blogs, YouTube Shorts,
 * WhatsApp, email newsletter topics).
 *
 * Pure & deterministic — no external API, no DB — so it is fully unit-testable
 * and safe to call from the weekly cron and the dashboard endpoint.
 */

const CALENDAR = require('./awareness-calendar.json');
const OBSERVANCES = (CALENDAR && CALENDAR.observances) || [];

// ── Map an app specialty (canonical name, e.g. "Interventional Cardiologist")
//    to the broad calendar tags (e.g. "cardiologist"). Uses keyword matching so
//    every sub-specialty resolves to its parent field.
const TAG_KEYWORDS = [
  ['cardiologist',        ['cardio', 'heart', 'cardiac']],
  ['neurologist',         ['neuro', 'brain', 'nerve', 'stroke', 'epilep', 'spine', 'headache']],
  ['orthopedic',          ['orthop', 'orthopaedic', 'bone', 'joint', 'knee', 'hip', 'shoulder', 'sports']],
  ['dermatologist',       ['derma', 'skin', 'hair', 'tricholog', 'cosmetolog', 'venereolog']],
  ['gynecologist',        ['gynec', 'gynaec', 'obstet', 'obgyn', 'fertility', 'ivf', 'maternit', 'women']],
  ['obgyn',               ['obgyn', 'obstet']],
  ['pediatrician',        ['pediatric', 'paediatric', 'child', 'neonat', 'adolescent']],
  ['oncologist',          ['oncolog', 'cancer', 'hemato-onco', 'tumor', 'tumour']],
  ['endocrinologist',     ['endocrin', 'thyroid', 'diabet', 'hormone', 'pituitary', 'adrenal']],
  ['gastroenterologist',  ['gastro', 'digest', 'ibd', 'endoscop', 'proctolog', 'colorectal']],
  ['hepatologist',        ['hepat', 'liver']],
  ['nephrologist',        ['nephro', 'kidney', 'dialysis', 'renal']],
  ['urologist',           ['urolog', 'prostate', 'androlog', 'sexolog']],
  ['pulmonologist',       ['pulmon', 'chest', 'lung', 'respirator', 'asthma', 'copd', 'sleep']],
  ['ophthalmologist',     ['ophthalm', 'eye', 'retina', 'cornea', 'cataract', 'glaucoma', 'lasik', 'optometr']],
  ['psychiatrist',        ['psychiatr', 'mental', 'addiction', 'de-addiction']],
  ['psychologist',        ['psycholog', 'counsel', 'therap']],
  ['rheumatologist',      ['rheumat', 'arthritis', 'lupus', 'autoimmune']],
  ['hematologist',        ['hematolog', 'haematolog', 'blood', 'transfusion', 'marrow']],
  ['geriatrician',        ['geriatr', 'elderly', 'old age']],
  ['radiologist',         ['radiolog', 'imaging', 'sonolog', 'nuclear']],
  ['physiotherapist',     ['physio', 'physical medicine', 'rehab', 'occupational therap', 'speech therap']],
  ['dentist',             ['dent', 'orthodont', 'endodont', 'periodont', 'prosthodont', 'oral', 'maxillofacial', 'implantolog']],
  ['allergist',           ['allerg', 'immunolog']],
  ['infectious_disease',  ['infectious', 'hiv', 'tropical', 'tuberculosis']],
  ['nutritionist',        ['nutrition', 'diet']],
  ['geneticist',          ['genetic']],
  ['general_practitioner',['general', 'family', 'internal medicine', 'internist', 'primary care', 'physician', 'gp']],
];

function lc(s) { return String(s == null ? '' : s).toLowerCase(); }

function specialtyTags(specialty, parentSpecialty) {
  const hay = lc(specialty) + ' ' + lc(parentSpecialty);
  const tags = [];
  for (const [tag, kws] of TAG_KEYWORDS) {
    if (kws.some(k => hay.indexOf(k) !== -1) && tags.indexOf(tag) === -1) tags.push(tag);
  }
  return tags;
}

function normRegion(region) {
  const r = lc(region);
  if (r === 'in' || r === 'india') return 'IN';
  if (r === 'us' || r === 'usa' || r === 'united states') return 'US';
  return r ? r.toUpperCase() : 'GLOBAL';
}

/**
 * Rank & return all observances relevant to a specialty/region for a month.
 * @returns {Array} observances, most-relevant first, each with `specialtyMatch` flag.
 */
function getCampaignsForMonth(month, opts) {
  opts = opts || {};
  const tags = specialtyTags(opts.specialty, opts.parentSpecialty);
  const region = normRegion(opts.region);

  const inRegion = o =>
    !o.region_tags || o.region_tags.indexOf(region) !== -1 || o.region_tags.indexOf('GLOBAL') !== -1;

  const matches = OBSERVANCES.filter(o => o.month === month && inRegion(o)).map(o => {
    const specialtyMatch = (o.specialty_tags || []).some(t => tags.indexOf(t) !== -1);
    const universal = (o.specialty_tags || []).indexOf('all') !== -1;
    return { observance: o, specialtyMatch, universal };
  }).filter(m => m.specialtyMatch || m.universal);

  // Rank: specialty-specific first, then day-specific (fixed dates) over whole-month,
  // then universal "all" campaigns. Stable within group by day ascending.
  matches.sort((a, b) => {
    if (a.specialtyMatch !== b.specialtyMatch) return a.specialtyMatch ? -1 : 1;
    const ad = a.observance.day ? 0 : 1, bd = b.observance.day ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return (a.observance.day || 99) - (b.observance.day || 99);
  });

  return matches.map(m => Object.assign({ specialtyMatch: m.specialtyMatch }, m.observance));
}

// ── Deterministic content pack ──────────────────────────────────────────────
function titleCaseSpecialty(s) { return String(s || 'doctor'); }

function generateContentPack(campaign, doctor) {
  doctor = doctor || {};
  const theme = campaign.campaign_theme || campaign.name;
  const sp = titleCaseSpecialty(doctor.specialty || 'doctor');
  const city = doctor.city || 'your city';
  const name = doctor.name || 'your practice';
  const topic = campaign.name;
  const desc = campaign.description || '';

  return {
    reels: [
      `3 myths about ${topic.replace(/ (month|day|week).*/i, '')} — busted in 30 seconds`,
      `"What ${sp.toLowerCase()}s wish every patient knew about ${theme}" — talking-head Reel`,
      `Quick checklist: when to see a ${sp.toLowerCase()} during ${topic}`,
    ],
    gbpPosts: [
      `${theme}: ${desc || topic}. Book a check-up with ${name} this month.`,
      `It's ${topic}. Early action matters — call ${name} in ${city} to schedule a screening.`,
    ],
    blogTopics: [
      `${topic}: a ${sp} in ${city} explains the signs you shouldn't ignore`,
      `${theme} — your questions answered`,
      `Prevention first: how ${sp.toLowerCase()} care helps during ${topic}`,
    ],
    youtubeShorts: [
      `${theme} in 60 seconds`,
      `One thing to do this ${topic}`,
    ],
    whatsappIdeas: [
      `📣 ${topic} reminder for our patients — message us to book a slot with ${name}.`,
      `This month is ${theme}. Reply "BOOK" to schedule your screening.`,
    ],
    emailNewsletterTopics: [
      `${topic}: what it means for you`,
      `${theme} — a note from ${name}`,
    ],
  };
}

/**
 * The dashboard/cron entry point: the current campaign + content pack + upcoming.
 * @param {object} opts { specialty, parentSpecialty, city, name, region, month, year }
 */
function getCurrentCampaign(opts) {
  opts = opts || {};
  const month = opts.month || (new Date().getMonth() + 1);
  const ranked = getCampaignsForMonth(month, opts);

  if (!ranked.length) {
    return { month, campaign: null, contentPack: null, upcoming: [], hasCampaign: false };
  }
  const top = ranked[0];
  return {
    month,
    hasCampaign: true,
    campaign: {
      name: top.name,
      theme: top.campaign_theme,
      description: top.description,
      month: top.month,
      day: top.day,
      specialtyMatch: top.specialtyMatch,
      regions: top.region_tags,
    },
    contentPack: generateContentPack(top, opts),
    upcoming: ranked.slice(1, 4).map(o => ({ name: o.name, theme: o.campaign_theme, day: o.day, specialtyMatch: o.specialtyMatch })),
  };
}

module.exports = {
  getCurrentCampaign,
  getCampaignsForMonth,
  generateContentPack,
  specialtyTags,
  normRegion,
  OBSERVANCES,
};
