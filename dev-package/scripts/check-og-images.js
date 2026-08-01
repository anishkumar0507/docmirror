#!/usr/bin/env node
'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — Open Graph image audit

   For every resource post, resolve its frontmatter `image` to a file on disk
   under public/, read the real pixel dimensions and byte size straight from
   the file header (no image library), and flag anything a social platform
   (LinkedIn, Facebook, X) would refuse or mis-crop:

     - MISSING FRONTMATTER IMAGE  → no `image:` field
     - FILE NOT FOUND             → `image:` points at a file that isn't there
     - too small                  → smaller than 1200x630
     - too large                  → over 5MB
     - SVG                        → social platforms don't render SVG

   Prints a summary table and exits non-zero if any post fails.

   Usage:  node scripts/check-og-images.js   (or: npm run check-og)
   ────────────────────────────────────────────────────────────────────────── */

const fs   = require('fs');
const path = require('path');
const { getAllResources } = require('../lib/resources');
const {
  imageSize, OG_MIN_WIDTH, OG_MIN_HEIGHT, OG_MAX_BYTES,
} = require('./publish-resource');

const ROOT       = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

function fmtBytes(n) {
  if (n == null) return '-';
  if (n >= 1048576) return `${(n / 1048576).toFixed(2)}MB`;
  if (n >= 1024)    return `${(n / 1024).toFixed(0)}KB`;
  return `${n}B`;
}

function pad(s, w) {
  s = String(s);
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

function audit() {
  const posts = getAllResources();
  const rows = [];

  for (const post of posts) {
    const row = { slug: post.slug, status: '', dims: '-', size: '-', flags: [], ok: true };

    if (!post.image) {
      row.status = 'MISSING FRONTMATTER IMAGE';
      row.ok = false;
      rows.push(row);
      continue;
    }

    const diskPath = path.join(PUBLIC_DIR, post.image.replace(/^\//, ''));
    if (!fs.existsSync(diskPath)) {
      row.status = 'FILE NOT FOUND';
      row.flags.push(post.image);
      row.ok = false;
      rows.push(row);
      continue;
    }

    const buf = fs.readFileSync(diskPath);
    const { type, width, height } = imageSize(buf);
    const bytes = buf.length;
    row.status = 'OK';
    row.dims = (width && height) ? `${width}x${height}` : `${type || '?'}/no-dims`;
    row.size = fmtBytes(bytes);

    const ext = path.extname(diskPath).slice(1).toLowerCase();
    if (type === 'svg' || ext === 'svg') {
      row.flags.push('SVG not supported by social platforms');
      row.ok = false;
    }
    if (width == null || height == null) {
      row.flags.push('could not read dimensions');
      row.ok = false;
    } else if (width < OG_MIN_WIDTH || height < OG_MIN_HEIGHT) {
      row.flags.push(`below ${OG_MIN_WIDTH}x${OG_MIN_HEIGHT}`);
      row.ok = false;
    }
    if (bytes > OG_MAX_BYTES) {
      row.flags.push(`over ${(OG_MAX_BYTES / 1048576).toFixed(0)}MB`);
      row.ok = false;
    }

    rows.push(row);
  }

  return rows;
}

function main() {
  const rows = audit();

  const wSlug   = Math.max(4, ...rows.map(r => r.slug.length));
  const wStatus = Math.max(6, ...rows.map(r => r.status.length));
  const wDims   = Math.max(4, ...rows.map(r => r.dims.length));
  const wSize   = Math.max(4, ...rows.map(r => r.size.length));

  const header = `${pad('SLUG', wSlug)}  ${pad('STATUS', wStatus)}  ${pad('DIMS', wDims)}  ${pad('SIZE', wSize)}  FLAGS`;
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const r of rows) {
    const mark = r.ok ? '✓' : '✗';
    console.log(`${pad(r.slug, wSlug)}  ${pad(r.status, wStatus)}  ${pad(r.dims, wDims)}  ${pad(r.size, wSize)}  ${mark} ${r.flags.join('; ')}`);
  }

  const failed = rows.filter(r => !r.ok);
  console.log('-'.repeat(header.length));
  console.log(`${rows.length} posts, ${rows.length - failed.length} OK, ${failed.length} failing`);
  if (failed.length) {
    console.log('\nFailing posts:');
    for (const r of failed) console.log(`  - ${r.slug}: ${r.status}${r.flags.length ? ' — ' + r.flags.join('; ') : ''}`);
  }

  process.exit(failed.length ? 1 : 0);
}

module.exports = { audit };

if (require.main === module) main();
