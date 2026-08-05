#!/usr/bin/env node
'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — automatic resource/blog publisher

   Drop in one Markdown file + one image and this does everything:
     1. Derives a clean slug from the title (or filename).
     2. Copies the image into public/images/resources/ (collision-safe,
        never overwrites) and renames it after the slug.
     3. Writes/updates the Markdown frontmatter with a guaranteed-correct,
        website-relative image path (never a temp/absolute/blob path).
     4. Saves the post to content/resources/<slug>.md so it appears
        automatically on the listing, as the featured card (if newest), and
        on its own page.
     5. Verifies the image exists, is a real image, the path matches, and the
        listing + article actually render it. Fixes issues before finishing.

   Usage:
     node scripts/publish-resource.js <markdown> <image> [options]
     npm run publish-resource -- <markdown> <image> [options]

   Options:
     --title "..."       Override the title (also drives the slug)
     --slug   "..."      Override the slug
     --category "..."    Set category
     --author "..."      Set author
     --excerpt "..."     Set excerpt/description
     --date YYYY-MM-DD   Set date (defaults to today)
     --force             Overwrite an existing <slug>.<ext> image

   Also exports publishResource() for the /imports pipeline.
   ────────────────────────────────────────────────────────────────────────── */

const fs     = require('fs');
const path   = require('path');
const matter = require('gray-matter');
const { slugify } = require('../lib/resources');

const ROOT        = path.join(__dirname, '..');
const RESOURCES   = path.join(ROOT, 'content', 'resources');
const IMAGES_DIR  = path.join(ROOT, 'public', 'images', 'resources');
const IMAGES_WEB  = '/images/resources';   // website-relative image folder

// ── image helpers ─────────────────────────────────────────────────────────

// Sniff real image type from magic bytes (the strongest offline proxy for
// "a browser can render this"). Returns a canonical extension or null.
function sniffImage(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  const head = buf.toString('utf8', 0, Math.min(buf.length, 400)).trim();
  if (/^<\?xml/i.test(head) || /^<svg[\s>]/i.test(head)) return 'svg';
  return null;
}

// Read pixel dimensions straight from the file header — no image library.
// Returns { type, width, height }; width/height are null when unreadable
// (e.g. SVG, which has no intrinsic raster size).
function imageSize(buf) {
  const type = sniffImage(buf);
  if (type === 'png') {
    // 8-byte signature, then a length + "IHDR" chunk carrying width/height.
    if (buf.length >= 24 && buf.toString('ascii', 12, 16) === 'IHDR') {
      return { type, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
  } else if (type === 'jpg') {
    // Walk the marker segments until a Start-Of-Frame (SOFn) marker.
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const marker = buf[o + 1];
      // SOF0–SOF15 hold the frame size; C4 (DHT), C8 (JPG), CC (DAC) do not.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type, height: buf.readUInt16BE(o + 5), width: buf.readUInt16BE(o + 7) };
      }
      const len = buf.readUInt16BE(o + 2); // segment length follows the marker
      if (len < 2) break;
      o += 2 + len;
    }
  } else if (type === 'gif') {
    if (buf.length >= 10) return { type, width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  } else if (type === 'webp') {
    const tag = buf.toString('ascii', 12, 16);
    if (tag === 'VP8 ' && buf.length >= 30) {
      return { type, width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (tag === 'VP8L' && buf.length >= 25) {
      const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
      return {
        type,
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      };
    }
    if (tag === 'VP8X' && buf.length >= 30) {
      return {
        type,
        width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
        height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
      };
    }
  }
  return { type, width: null, height: null };
}

// Shared social-image policy so the audit and the publisher agree.
const OG_MIN_WIDTH  = 1200;
const OG_MIN_HEIGHT = 630;
const OG_MAX_BYTES  = 5 * 1024 * 1024;

// Pick a collision-safe target path: <slug>.<ext>, then <slug>-1.<ext>, …
function collisionSafeTarget(slug, ext, force) {
  const first = path.join(IMAGES_DIR, `${slug}.${ext}`);
  if (force || !fs.existsSync(first)) return first;
  for (let n = 1; n < 1000; n++) {
    const p = path.join(IMAGES_DIR, `${slug}-${n}.${ext}`);
    if (!fs.existsSync(p)) return p;
  }
  throw new Error('could not find a free image filename after 1000 tries');
}

// ── core (reusable) ─────────────────────────────────────────────────────────

// Publishes one resource. Throws on any error; returns a result object.
// Set opts.quiet to suppress step logging.
function publishResource(mdPathArg, imgPathArg, opts = {}) {
  const log = opts.quiet ? () => {} : (m) => console.log(m);

  const mdPath = path.resolve(mdPathArg);
  if (!fs.existsSync(mdPath)) throw new Error(`Markdown file not found: ${mdPath}`);

  fs.mkdirSync(RESOURCES, { recursive: true });
  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  // 1) Parse markdown + resolve title/slug
  const rawMd = fs.readFileSync(mdPath, 'utf8');
  const { data, content } = matter(rawMd);

  const title = opts.title || data.title || path.basename(mdPath, path.extname(mdPath)).replace(/[-_]+/g, ' ');
  const slug  = slugify(opts.slug || data.slug || title);
  if (!slug) throw new Error('could not derive a slug — pass --slug or add a title');

  // 2) Copy + rename the image (collision-safe)
  let webImage = null;
  const consumed = [];

  if (imgPathArg) {
    const imgPath = path.resolve(imgPathArg);
    if (!fs.existsSync(imgPath)) throw new Error(`image file not found: ${imgPath}`);
    const buf = fs.readFileSync(imgPath);
    const sniffed = sniffImage(buf);
    if (!sniffed) throw new Error(`"${imgPathArg}" is not a renderable image (png/jpg/webp/gif/svg expected)`);

    const srcExt = path.extname(imgPath).slice(1).toLowerCase();
    const ext = (srcExt === sniffed || (sniffed === 'jpg' && srcExt === 'jpeg')) ? srcExt : sniffed;

    const target = collisionSafeTarget(slug, ext, opts.force);
    fs.copyFileSync(imgPath, target);
    webImage = `${IMAGES_WEB}/${path.basename(target)}`;
    consumed.push(imgPath);
    log(`  copied image → ${path.relative(ROOT, target)}`);
  } else if (data.image || data.featuredImage) {
    webImage = String(data.image || data.featuredImage);
  } else {
    throw new Error('no image provided and none in frontmatter. An image is required (never left empty).');
  }

  // 3) Build frontmatter with a guaranteed website-relative image path
  const today = new Date().toISOString().slice(0, 10);
  const fm = { ...data };
  fm.title       = title;
  fm.slug        = slug;
  if (opts.excerpt) fm.description = opts.excerpt;
  fm.description = fm.description || fm.excerpt || '';
  fm.category    = opts.category || fm.category || 'Guide';
  fm.date        = opts.date || fm.date || today;
  fm.author      = opts.author || fm.author || 'The Doc Mirror';
  fm.image       = webImage;
  fm.imageAlt    = fm.imageAlt || title;
  delete fm.featuredImage;

  if (!/^\/images\/resources\//.test(fm.image)) {
    throw new Error(`refusing to write non-website-relative image path: ${fm.image}`);
  }

  // 4) Write the post
  const outPath = path.join(RESOURCES, `${slug}.md`);
  const body = content.replace(/^\n+/, '');
  fs.writeFileSync(outPath, matter.stringify('\n' + body, fm));
  log(`  wrote post   → ${path.relative(ROOT, outPath)}`);

  // 5) Verify (throws on failure)
  const checks = verify(slug, fm.image);
  if (!opts.quiet) checks.forEach(([label, ok]) => console.log(`  ${ok ? '✓' : '✗'} ${label}`));

  return {
    slug,
    outPath,
    webImage: fm.image,
    diskImage: path.join(ROOT, 'public', fm.image.replace(/^\//, '')),
    url: `https://www.thedocmirror.com/resources/${slug}`,
    consumed,           // source files that were used (for /imports cleanup)
    sourceMd: mdPath,
  };
}

// Re-require the engine fresh and assert the image is real, the path matches,
// and both the listing + article render it. Throws if anything fails.
function verify(slug, webImage) {
  delete require.cache[require.resolve('../lib/resources')];
  delete require.cache[require.resolve('../lib/resources-markdown')];
  delete require.cache[require.resolve('../routes/resources')];
  const engine = require('../lib/resources');
  const views  = require('../routes/resources');

  const diskPath = path.join(ROOT, 'public', webImage.replace(/^\//, ''));
  const exists = fs.existsSync(diskPath);
  const buf = exists ? fs.readFileSync(diskPath) : null;
  const renderable = !!buf && !!sniffImage(buf);
  const post = engine.getResourceBySlug(slug);
  const pathMatches = !!post && post.image === webImage;
  const listingOk = post ? views.renderListing().includes(`src="${webImage}"`) : false;
  const articleOk = post ? views.renderArticle(post).includes(`src="${webImage}"`) : false;

  // Social-preview policy: big enough for a summary_large_image card, under the
  // 5MB most platforms fetch, and not an SVG (LinkedIn/Facebook won't render it).
  const { type, width, height } = buf ? imageSize(buf) : { type: null, width: null, height: null };
  const bytes = buf ? buf.length : 0;
  const bigEnough = width != null && height != null && width >= OG_MIN_WIDTH && height >= OG_MIN_HEIGHT;
  const underMax = exists && bytes <= OG_MAX_BYTES;
  const notSvg = type !== 'svg';

  const checks = [
    ['Image file exists', exists],
    ['Browser can render image', renderable],
    ['Frontmatter path matches image', pathMatches],
    ['Resource card displays image', listingOk],
    ['Featured article displays image', articleOk],
    [`Social image >= ${OG_MIN_WIDTH}x${OG_MIN_HEIGHT} (is ${width || '?'}x${height || '?'})`, bigEnough],
    [`Social image <= ${(OG_MAX_BYTES / 1048576).toFixed(0)}MB (is ${(bytes / 1048576).toFixed(2)}MB)`, underMax],
    ['Social image is not SVG', notSvg],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([label]) => label);
  if (failed.length) throw new Error('verification failed: ' + failed.join('; '));
  return checks;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'force') { opts.force = true; continue; }
      opts[key] = argv[++i];
    } else {
      positional.push(a);
    }
  }
  return { positional, opts };
}

function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const [mdArg, imgArg] = positional;
  if (!mdArg) {
    console.error('✗ missing Markdown file.\n  Usage: node scripts/publish-resource.js <markdown> <image> [--options]');
    process.exit(1);
  }
  try {
    const r = publishResource(mdArg, imgArg, opts);
    console.log('\n✓ Published\n');
    console.log(`Image saved: ${path.relative(ROOT, r.diskImage)}`);
    console.log(`Blog saved:  ${path.relative(ROOT, r.outPath)}`);
    console.log(`Slug:        ${r.slug}`);
    console.log(`Image path:  ${r.webImage}`);
    console.log(`URL:         ${r.url}`);
  } catch (err) {
    console.error('✗ ' + err.message);
    process.exit(2);
  }
}

module.exports = {
  publishResource, verify, sniffImage, imageSize,
  OG_MIN_WIDTH, OG_MIN_HEIGHT, OG_MAX_BYTES,
  IMAGES_DIR, RESOURCES, IMAGES_WEB,
};

if (require.main === module) main();
