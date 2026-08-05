#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────────────
   Writes public/sitemap.xml from lib/sitemap.js — the same builder that
   serves /sitemap.xml live, so the file and the URL always match.

   Usage:  npm run sitemap

   Run it after adding a page or an article, then commit the result. The site
   does not depend on this file (the live URL is generated on request); it
   exists so you can open, read, and diff your sitemap in the repo.
   ────────────────────────────────────────────────────────────────────────── */
'use strict';

const fs = require('fs');
const path = require('path');
const { buildSitemapXml, buildSitemapEntries } = require('../lib/sitemap');
const { refresh } = require('../lib/resources');

// The Resources collection is now a hybrid of the Markdown files and the CMS,
// and the CMS half arrives over the network. Await it before building, or this
// file would list only the .md articles while the live /sitemap.xml — which is
// generated per request and always wins — listed both.
async function main() {
try {
  await refresh();
  const xml = buildSitemapXml();
  const entries = buildSitemapEntries();

  fs.writeFileSync(OUT, xml, 'utf8');

  console.log('\n  sitemap.xml written\n');
  console.log('  ' + path.relative(process.cwd(), OUT));
  console.log('  ' + entries.length + ' URLs, ' + (Buffer.byteLength(xml) / 1024).toFixed(1) + ' KB\n');
  for (const e of entries) {
    console.log('   ' + e.priority + '  ' + (e.lastmod || '----------') + '  ' + e.loc);
  }
  console.log('\n  Live URL: https://www.thedocmirror.com/sitemap.xml');
  console.log('  Submit that URL in Google Search Console (not the file).\n');
} catch (err) {
  console.error('\n  Failed to write sitemap.xml:', err.message, '\n');
  process.exitCode = 1;
}
}

main();
