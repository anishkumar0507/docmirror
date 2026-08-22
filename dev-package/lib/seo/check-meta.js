#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Regression guard for lib/seo/meta.config.json — the guard that stops the
// duplicate-meta bug from ever coming back. Fails (exit 1) if:
//   • any title  > 60 chars              (Google truncates ~60)
//   • any description outside 120–158    (too short = weak; too long = truncated)
//   • ANY two entries share a title OR a description (the duplicate-meta bug)
// Run:  node lib/seo/check-meta.js       (wire into CI / pre-deploy if desired)
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path');
const config = require(path.join(__dirname, 'meta.config.json'));

const TITLE_MAX = 60;
const DESC_MIN = 120;
const DESC_MAX = 158;

const errors = [];
const titles = new Map();       // title -> first key that used it
const descriptions = new Map(); // description -> first key that used it

// Count by code points (an em-dash is one visible character), matching how a SERP
// counts, not raw UTF-16 length.
function len(s) { return [...String(s)]. length; }

const pages = (config && config.pages) || {};
const keys = Object.keys(pages);
if (!keys.length) { console.error('✗ no pages in meta.config.json'); process.exit(1); }

for (const key of keys) {
  const p = pages[key] || {};
  const title = p.title || '';
  const desc = p.description || '';

  if (!title) errors.push(`[${key}] missing title`);
  if (!desc)  errors.push(`[${key}] missing description`);

  if (title && len(title) > TITLE_MAX) {
    errors.push(`[${key}] title is ${len(title)} chars (max ${TITLE_MAX}): "${title}"`);
  }
  if (desc && (len(desc) < DESC_MIN || len(desc) > DESC_MAX)) {
    errors.push(`[${key}] description is ${len(desc)} chars (must be ${DESC_MIN}–${DESC_MAX}): "${desc}"`);
  }

  if (title) {
    if (titles.has(title)) errors.push(`[${key}] DUPLICATE title shared with [${titles.get(title)}]: "${title}"`);
    else titles.set(title, key);
  }
  if (desc) {
    if (descriptions.has(desc)) errors.push(`[${key}] DUPLICATE description shared with [${descriptions.get(desc)}]`);
    else descriptions.set(desc, key);
  }
}

// ogTitle: no hard length gate (social/LLM allow more), but must not be empty and
// must differ from the short title (they are deliberately two different strings).
for (const key of keys) {
  const p = pages[key] || {};
  if (!p.ogTitle) errors.push(`[${key}] missing ogTitle`);
  else if (p.ogTitle === p.title) errors.push(`[${key}] ogTitle must differ from title (never swap/duplicate them)`);
}

if (errors.length) {
  console.error('✗ meta.config.json FAILED ' + errors.length + ' check(s):');
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}

console.log('✓ meta.config.json OK — ' + keys.length + ' entries, all titles ≤' + TITLE_MAX +
            ', descriptions ' + DESC_MIN + '–' + DESC_MAX + ', no shared title/description.');
for (const key of keys) {
  const p = pages[key];
  console.log('  ' + key.padEnd(15) + ' title=' + len(p.title) + '  desc=' + len(p.description));
}
