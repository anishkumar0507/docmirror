'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   Admin CMS — media library

     GET    /api/admin/media          list what has been uploaded
     POST   /api/admin/media/upload   upload one image
     DELETE /api/admin/media/:id      remove the object and its row

   Bytes go to the Supabase Storage bucket "blog-media" (migration 020);
   metadata goes to blog_media (migration 019). Nothing is ever written to the
   filesystem — Vercel's is read-only at runtime, so public/images/resources/
   cannot receive an upload.

   The upload runs entirely server-side under the service key. The browser
   never holds a storage credential; it POSTs the raw bytes to this route and
   gets back a public URL.

   The accepted types and the 5 MB ceiling are the same policy
   scripts/publish-resource.js already applies to Markdown hero images, and the
   sniffing/measuring helpers are imported from that script rather than
   reimplemented, so the two paths cannot diverge.
   ────────────────────────────────────────────────────────────────────────── */

require('../../lib/env');
const crypto = require('crypto');
const { getSupabaseClient, withSupabaseRetry, formatFetchError } = require('../../lib/supabase-client');
const { slugify } = require('../../lib/resources');
const { sniffImage, imageSize, OG_MIN_WIDTH, OG_MIN_HEIGHT, OG_MAX_BYTES } =
  require('../../scripts/publish-resource');

const BUCKET = 'blog-media';

// Matches the bucket's allowed_mime_types in migration 020.
const EXT_TO_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif',
};
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function db(res) {
  const supabase = getSupabaseClient();
  if (!supabase) { res.status(500).json({ error: 'Storage is not configured' }); return null; }
  return supabase;
}

async function list(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 200);
  const q = String(req.query.q || '').trim();

  let query = supabase.from('blog_media')
    .select('id, bucket, storage_path, public_url, filename, mime_type, size_bytes, width, height, alt_text, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (q) query = query.ilike('filename', `%${q.replace(/[%,()]/g, ' ')}%`);

  const { data, error } = await withSupabaseRetry(() => query, { label: 'admin-media-list', attempts: 2 });
  if (error) {
    console.error('[admin/media] list FAILED:', formatFetchError(error));
    return res.status(503).json({ error: 'Could not load the media library.', retryable: true });
  }
  return res.json({ media: data || [] });
}

async function upload(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) {
    return res.status(400).json({
      error: 'No image data received. Send the raw file bytes with an image Content-Type.',
    });
  }

  if (buf.length > OG_MAX_BYTES) {
    return res.status(413).json({
      error: `That image is ${(buf.length / 1048576).toFixed(1)} MB. The limit is ` +
             `${(OG_MAX_BYTES / 1048576).toFixed(0)} MB — please compress it first.`,
    });
  }

  // Trust the bytes, not the header. A file renamed to .png is still whatever
  // it actually is, and the bucket would reject the mismatch anyway.
  const sniffed = sniffImage(buf);
  if (!sniffed) {
    return res.status(415).json({ error: 'That file is not a readable image (PNG, JPG, WebP or GIF).' });
  }
  if (sniffed === 'svg') {
    return res.status(415).json({
      error: 'SVG is not accepted: social platforms will not render it as a preview image, ' +
             'and it can carry script when served from a public bucket. Use PNG, JPG or WebP.',
    });
  }

  const mime = EXT_TO_MIME[sniffed];
  if (!mime || !ALLOWED_MIME.includes(mime)) {
    return res.status(415).json({ error: `Image type "${sniffed}" is not allowed.` });
  }

  const { width, height } = imageSize(buf);

  const originalName = String(req.query.filename || 'image').trim();
  const baseName = slugify(originalName.replace(/\.[^.]+$/, '')) || 'image';
  const ext = sniffed === 'jpg' ? 'jpg' : sniffed;

  // Foldered by month so the bucket stays browsable, and suffixed with random
  // bytes so two uploads of "hero.png" can never overwrite one another.
  const now = new Date();
  const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const storagePath = `${folder}/${baseName.slice(0, 60)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;

  const up = await supabase.storage.from(BUCKET).upload(storagePath, buf, {
    contentType: mime,
    upsert: false,
    cacheControl: '31536000',
  });
  if (up.error) {
    console.error('[admin/media] storage upload FAILED:', up.error.message);
    return res.status(503).json({ error: `Upload failed: ${up.error.message}`, retryable: true });
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  const publicUrl = (pub && pub.publicUrl) || null;

  const row = {
    bucket: BUCKET,
    storage_path: storagePath,
    public_url: publicUrl,
    filename: originalName.slice(0, 200),
    mime_type: mime,
    size_bytes: buf.length,
    width: width || null,
    height: height || null,
    alt_text: String(req.query.alt || '').trim() || null,
    uploaded_by: req.admin.id,
  };

  const { data, error } = await withSupabaseRetry(
    () => supabase.from('blog_media').insert(row).select('*').single(),
    { label: 'admin-media-insert', attempts: 2 }
  );

  if (error) {
    // The bytes are already in the bucket; without the metadata row the object
    // would be orphaned and invisible to the library, so remove it and report.
    console.error('[admin/media] metadata insert FAILED, rolling back object:', formatFetchError(error));
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    return res.status(503).json({ error: 'Upload could not be recorded — please try again.', retryable: true });
  }

  // Advisory, not a rejection: a small inline body image is perfectly valid,
  // it just should not be chosen as the social preview.
  const tooSmallForSocial =
    !width || !height || width < OG_MIN_WIDTH || height < OG_MIN_HEIGHT;

  console.log(
    `[admin/media] uploaded ${storagePath} ${(buf.length / 1024).toFixed(0)}KB ` +
    `${width || '?'}x${height || '?'} by=${req.admin.email}`
  );

  return res.status(201).json({
    media: data,
    warning: tooSmallForSocial
      ? `This image is ${width || '?'}×${height || '?'}. Social previews look best at ` +
        `${OG_MIN_WIDTH}×${OG_MIN_HEIGHT} or larger — fine for inside the article, ` +
        `but consider a bigger one for the featured image.`
      : null,
  });
}

/* Deleting is two separate stores — the bucket object and the metadata row —
   so it is done object-first. If the object goes but the row fails, the library
   shows a broken entry that can be deleted again; if the row went first and the
   object failed, the bytes would stay in the bucket with nothing pointing at
   them and no way to find them again. */
async function remove(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const loaded = await withSupabaseRetry(
    () => supabase.from('blog_media')
      .select('id, bucket, storage_path, public_url, filename')
      .eq('id', req.params.id).maybeSingle(),
    { label: 'admin-media-load', attempts: 2 }
  );
  if (loaded.error) {
    console.error('[admin/media] delete/load FAILED:', formatFetchError(loaded.error));
    return res.status(503).json({ error: 'Could not load that image.', retryable: true });
  }
  if (!loaded.data) return res.status(404).json({ error: 'That image is no longer in the library.' });

  const item = loaded.data;

  // An image still used by an article would turn into a broken <img> the moment
  // the object is gone, and nothing else would ever tell you. Both the featured
  // image and inline body references count.
  const usage = [];
  const url = item.public_url || '';
  if (url) {
    const byFeatured = await withSupabaseRetry(
      () => supabase.from('blog_posts').select('id, title, slug, status').eq('featured_image', url).limit(20),
      { label: 'admin-media-usage-featured', attempts: 2 }
    );
    if (!byFeatured.error) for (const p of (byFeatured.data || [])) usage.push({ ...p, where: 'featured image' });

    const byBody = await withSupabaseRetry(
      () => supabase.from('blog_posts').select('id, title, slug, status')
        .ilike('content_md', `%${item.storage_path}%`).limit(20),
      { label: 'admin-media-usage-body', attempts: 2 }
    );
    if (!byBody.error) {
      for (const p of (byBody.data || [])) {
        if (!usage.some((u) => u.id === p.id)) usage.push({ ...p, where: 'article body' });
      }
    }
  }

  if (usage.length && String(req.query.confirm || '') !== 'in-use') {
    return res.status(409).json({
      error: `"${item.filename}" is still used by ${usage.length} article${usage.length === 1 ? '' : 's'}. ` +
             'Deleting it will leave a broken image there.',
      requires_confirm: 'in-use',
      used_by: usage,
    });
  }

  const del = await supabase.storage.from(item.bucket || BUCKET).remove([item.storage_path]);
  if (del.error) {
    console.error('[admin/media] storage delete FAILED:', del.error.message);
    return res.status(503).json({ error: `Could not delete the file: ${del.error.message}`, retryable: true });
  }

  const { error } = await withSupabaseRetry(
    () => supabase.from('blog_media').delete().eq('id', item.id),
    { label: 'admin-media-delete', attempts: 2 }
  );
  if (error) {
    console.error('[admin/media] row delete FAILED (object already removed):', formatFetchError(error));
    return res.status(503).json({
      error: 'The file was removed but the library entry could not be cleared. Try deleting it again.',
      retryable: true,
    });
  }

  console.log(`[admin/media] DELETED ${item.storage_path} (used by ${usage.length}) by=${req.admin.email}`);
  return res.json({ deleted: { id: item.id, filename: item.filename }, was_used_by: usage.length });
}

module.exports = { list, upload, remove, BUCKET, ALLOWED_MIME };
