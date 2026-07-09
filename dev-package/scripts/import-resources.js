#!/usr/bin/env node
'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — /imports drop-zone processor

   Workflow:
     1. Drop a blog Markdown file + its hero image into  dev-package/imports/
     2. Run:  npm run import-resources
     3. For each Markdown file this automatically:
          • moves the image into public/images/resources/ (renamed to the slug)
          • writes the post into content/resources/<slug>.md with a correct,
            website-relative image path
          • the resource index/listing updates automatically (dynamic engine)
          • deletes the consumed files from /imports on success

   Image pairing for a post `foo.md` (first match wins):
     a) an image named `foo.<ext>` in /imports
     b) the image referenced in the post's frontmatter (matched by filename)
     c) if there is exactly one Markdown file and one image, they pair
   Unmatched files are left in /imports (never deleted) with a clear warning.
   ────────────────────────────────────────────────────────────────────────── */

const fs   = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { publishResource } = require('./publish-resource');

const ROOT        = path.join(__dirname, '..');
const IMPORTS_DIR = path.join(ROOT, 'imports');

const IMG_RE  = /\.(png|jpe?g|webp|gif|svg)$/i;
const KEEP    = new Set(['readme.md', '.gitkeep', '.ds_store']);

const stripExt = (f) => f.replace(/\.[^.]+$/, '');

function findImageFor(mdFile, imgFiles, allData) {
  const base = stripExt(mdFile).toLowerCase();

  // a) same basename
  let hit = imgFiles.find(i => stripExt(i).toLowerCase() === base);
  if (hit) return hit;

  // b) frontmatter reference (match by filename only)
  const ref = allData[mdFile] && (allData[mdFile].image || allData[mdFile].featuredImage);
  if (ref) {
    const refBase = path.basename(String(ref)).toLowerCase();
    hit = imgFiles.find(i => i.toLowerCase() === refBase);
    if (hit) return hit;
  }
  return null;
}

function main() {
  fs.mkdirSync(IMPORTS_DIR, { recursive: true });

  const entries = fs.readdirSync(IMPORTS_DIR)
    .filter(f => !KEEP.has(f.toLowerCase()));

  const mdFiles  = entries.filter(f => /\.md$/i.test(f));
  const imgFiles = entries.filter(f => IMG_RE.test(f));

  if (!mdFiles.length) {
    console.log('Nothing to import. Drop a Markdown file + image into dev-package/imports/ and re-run.');
    if (imgFiles.length) console.log(`(Found ${imgFiles.length} image(s) with no Markdown file — left in place.)`);
    return;
  }

  // Pre-read frontmatter for reference-based pairing.
  const allData = {};
  for (const md of mdFiles) {
    try { allData[md] = matter(fs.readFileSync(path.join(IMPORTS_DIR, md), 'utf8')).data || {}; }
    catch { allData[md] = {}; }
  }

  const results = [];
  const failures = [];
  const consumedFiles = new Set();

  for (const md of mdFiles) {
    let img = findImageFor(md, imgFiles, allData);
    // c) sole md + sole image fallback
    if (!img && mdFiles.length === 1 && imgFiles.length === 1) img = imgFiles[0];

    const mdPath  = path.join(IMPORTS_DIR, md);
    const imgPath = img ? path.join(IMPORTS_DIR, img) : null;

    console.log(`\n▶ ${md}${img ? '  +  ' + img : '  (no image paired)'}`);
    try {
      const r = publishResource(mdPath, imgPath, {});
      results.push(r);
      consumedFiles.add(md);
      if (img) consumedFiles.add(img);
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
      failures.push({ md, error: err.message });
    }
  }

  // Clean /imports — only the files that were successfully consumed.
  for (const f of consumedFiles) {
    try { fs.unlinkSync(path.join(IMPORTS_DIR, f)); } catch { /* ignore */ }
  }

  // ── report ──
  console.log('\n──────────────────────────────────────');
  for (const r of results) {
    console.log(`\n✓ Published: ${r.slug}`);
    console.log(`  Image saved: ${path.relative(ROOT, r.diskImage)}`);
    console.log(`  Blog saved:  ${path.relative(ROOT, r.outPath)}`);
    console.log(`  Image path:  ${r.webImage}`);
    console.log(`  URL:         ${r.url}`);
  }
  if (consumedFiles.size) {
    console.log(`\n🧹 Cleaned ${consumedFiles.size} file(s) from /imports.`);
  }
  if (failures.length) {
    console.log(`\n⚠ ${failures.length} item(s) NOT published (left in /imports):`);
    failures.forEach(f => console.log(`   - ${f.md}: ${f.error}`));
    process.exitCode = 2;
  }
  if (!results.length && !failures.length) {
    console.log('\nNothing published.');
  }
}

main();
