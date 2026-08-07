#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────────────
   Writes a READABLE COPY of the sitemap from lib/sitemap.js — the same builder
   that serves /sitemap.xml live.

   Usage:  npm run sitemap

   The site does not use this file. /sitemap.xml is generated per request, so a
   published or newly-due scheduled post appears in it immediately. This exists
   only so the sitemap can be opened, read and diffed locally.

   ── It must NOT be written into public/ ────────────────────────────────────
   Vercel serves static files from public/ at the CDN, BEFORE the serverless
   function runs. A public/sitemap.xml therefore shadows the live route
   entirely: Google would keep fetching whatever was last committed, and no
   amount of publishing would change it. That is precisely the bug this file
   used to cause, so the destination is outside public/ and a guard below
   refuses to write there however the path is overridden.
   ────────────────────────────────────────────────────────────────────────── */
'use strict';

// Loaded FIRST, and not optional: without it the Supabase credentials are never
// read from config/.env, the CMS source stays switched off, and this script
// quietly produces a Markdown-only sitemap that looks perfectly valid. The
// server loads it via server.js — a standalone script has to do it itself.
require('../lib/env');

const fs = require('fs');
const path = require('path');
const { buildSitemapXml, buildSitemapEntries } = require('../lib/sitemap');
const { refresh, cmsStatus } = require('../lib/resources');

const OUT = path.resolve(__dirname, '..', 'sitemap.preview.xml');

// The Resources collection is a hybrid of the Markdown files and the CMS, and
// the CMS half arrives over the network. Await it before building, or this copy
// would list only the .md articles while the live URL listed both.
async function main() {
  try {
    const publicDir = path.resolve(__dirname, '..', 'public');
    if (OUT === path.join(publicDir, 'sitemap.xml') || OUT.startsWith(publicDir + path.sep)) {
      throw new Error(
        'Refusing to write into public/ — a file there is served by Vercel instead of the ' +
        'live route, which would freeze the sitemap at this moment forever.'
      );
    }

    await refresh();

    // Said out loud rather than assumed. A Markdown-only sitemap is a valid XML
    // document and looks completely fine — the only way to notice the CMS half
    // is missing is to be told.
    const cms = cmsStatus();
    if (!cms.enabled) {
      console.warn('\n  WARNING: the CMS source is switched off, so no scheduled or published\n' +
                   '           blog will appear below. Check RESOURCES_CMS_ENABLED and the\n' +
                   '           Supabase variables in config/.env.');
    } else if (cms.lastError) {
      console.warn('\n  WARNING: the CMS could not be read (' + cms.lastError + ').\n' +
                   '           The list below is the Markdown articles only.');
    }

    const xml = buildSitemapXml();
    const entries = buildSitemapEntries();

    fs.writeFileSync(OUT, xml, 'utf8');

    console.log('\n  sitemap preview written\n');
    console.log('  ' + path.relative(process.cwd(), OUT));
    console.log('  ' + entries.length + ' URLs (' + cms.posts + ' from the CMS), ' +
                (Buffer.byteLength(xml) / 1024).toFixed(1) + ' KB\n');
    for (const e of entries) {
      console.log('   ' + e.priority + '  ' + (e.lastmod || '----------') + '  ' + e.loc);
    }
    console.log('\n  This copy is for reading only — nothing serves it.');
    console.log('  Live URL: https://www.thedocmirror.com/sitemap.xml (built per request)');
    console.log('  Submit that URL in Google Search Console, not this file.\n');
  } catch (err) {
    console.error('\n  Failed to write the sitemap preview:', err.message, '\n');
    process.exitCode = 1;
  }
}

main();
