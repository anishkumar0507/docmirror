'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   Admin CMS — categories

     GET    /api/admin/categories       list, with how many posts use each
     POST   /api/admin/categories       create
     PATCH  /api/admin/categories/:id   rename / edit
     DELETE /api/admin/categories/:id   remove

   blog_posts.category is TEXT, not a foreign key — a deliberate choice from
   migration 017 so that deleting a category can never orphan a published post,
   and so the public read is a column, not a join.

   The consequence lands here: renaming a category does NOT automatically follow
   through to the articles using it. Rather than leave posts pointing at a name
   that no longer exists, a rename offers to carry the change across, reports
   how many articles it touched, and can be declined.
   ────────────────────────────────────────────────────────────────────────── */

require('../../lib/env');
const { getSupabaseClient, withSupabaseRetry, formatFetchError } = require('../../lib/supabase-client');
const { slugify } = require('../../lib/resources');

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const COLUMNS = 'id, name, slug, description, created_at, updated_at';

function db(res) {
  const supabase = getSupabaseClient();
  if (!supabase) { res.status(500).json({ error: 'Database is not configured' }); return null; }
  return supabase;
}
function fail(res, label, error) {
  console.error(`[admin/categories] ${label} FAILED: ${formatFetchError(error)}`);
  return res.status(503).json({ error: 'The database could not complete that — please try again.', retryable: true });
}

/** Validates and normalises a name/slug/description payload. */
function clean(body, { existing = null } = {}) {
  const errors = [];
  const name = String((body && body.name) || '').trim();
  if (!name) errors.push('A category name is required.');
  if (name.length > 80) errors.push('That name is too long — keep it under 80 characters.');

  // The slug follows the name unless one is given, matching how the editor's
  // article slugs behave.
  let slug = slugify(String((body && body.slug) || '').trim() || name);
  if (!slug || !SLUG_RE.test(slug)) errors.push('Could not build a usable slug from that name.');

  // Changing a slug is allowed — nothing links to a category URL yet — but it
  // is called out so it is a decision rather than a side effect of renaming.
  if (existing && slug !== existing.slug && !(body && body.slug)) slug = existing.slug;

  return {
    fields: { name, slug, description: String((body && body.description) || '').trim() || null },
    errors,
  };
}

async function list(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const cats = await withSupabaseRetry(
    () => supabase.from('blog_categories').select(COLUMNS).order('name', { ascending: true }),
    { label: 'admin-categories-list', attempts: 2 }
  );
  if (cats.error) return fail(res, 'list', cats.error);

  // How many posts sit in each — so the screen can warn before a delete, and
  // show which categories are actually being used.
  const used = await withSupabaseRetry(
    () => supabase.from('blog_posts').select('category, status').limit(2000),
    { label: 'admin-categories-usage', attempts: 2 }
  );
  const counts = new Map();
  if (!used.error) {
    for (const r of (used.data || [])) {
      const k = String(r.category || '');
      if (!counts.has(k)) counts.set(k, { total: 0, live: 0 });
      counts.get(k).total++;
      if (r.status === 'published' || r.status === 'scheduled') counts.get(k).live++;
    }
  }

  const categories = (cats.data || []).map((c) => ({
    ...c,
    posts: (counts.get(c.name) || { total: 0 }).total,
    live_posts: (counts.get(c.name) || { live: 0 }).live,
  }));

  // A post can carry a category name that has no row — the schema default
  // 'Guide', or a name typed before the list existed. Surfaced so it can be
  // added rather than silently sitting outside the list.
  const orphans = [...counts.entries()]
    .filter(([name]) => name && !categories.some((c) => c.name === name))
    .map(([name, n]) => ({ name, posts: n.total }));

  return res.json({ categories, orphans });
}

async function create(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const { fields, errors } = clean(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const { data, error } = await withSupabaseRetry(
    () => supabase.from('blog_categories').insert(fields).select(COLUMNS).single(),
    { label: 'admin-categories-create', attempts: 2 }
  );
  if (error) {
    // 23505 is the unique violation on slug or on lower(name).
    if (String(error.code) === '23505') {
      return res.status(409).json({ error: `"${fields.name}" already exists as a category.` });
    }
    return fail(res, 'create', error);
  }

  console.log(`[admin/categories] CREATED "${data.name}" by=${req.admin.email}`);
  return res.status(201).json({ category: data });
}

async function update(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const loaded = await withSupabaseRetry(
    () => supabase.from('blog_categories').select(COLUMNS).eq('id', req.params.id).maybeSingle(),
    { label: 'admin-categories-load', attempts: 2 }
  );
  if (loaded.error) return fail(res, 'update/load', loaded.error);
  if (!loaded.data) return res.status(404).json({ error: 'Category not found' });

  const existing = loaded.data;
  const { fields, errors } = clean(req.body, { existing });
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const { data, error } = await withSupabaseRetry(
    () => supabase.from('blog_categories').update(fields).eq('id', existing.id).select(COLUMNS).single(),
    { label: 'admin-categories-update', attempts: 2 }
  );
  if (error) {
    if (String(error.code) === '23505') {
      return res.status(409).json({ error: `"${fields.name}" already exists as a category.` });
    }
    return fail(res, 'update', error);
  }

  // Carry a rename across to the articles, unless asked not to. Without this
  // they would keep the old name and drop out of the category entirely.
  let moved = 0;
  const renamed = existing.name !== fields.name;
  const cascade = renamed && (req.body || {}).cascade !== false;
  if (cascade) {
    const upd = await withSupabaseRetry(
      () => supabase.from('blog_posts')
        .update({ category: fields.name }).eq('category', existing.name).select('id'),
      { label: 'admin-categories-cascade', attempts: 2 }
    );
    if (upd.error) {
      console.error('[admin/categories] cascade FAILED:', formatFetchError(upd.error));
      return res.status(207).json({
        category: data,
        moved: 0,
        warning: `The category was renamed, but the ${existing.name} articles could not be moved. ` +
                 'Re-open this category and rename it again to retry.',
      });
    }
    moved = (upd.data || []).length;
  }

  console.log(
    `[admin/categories] UPDATED "${existing.name}" -> "${data.name}" ` +
    `moved=${moved} by=${req.admin.email}`
  );
  return res.json({ category: data, renamed, moved });
}

async function remove(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const loaded = await withSupabaseRetry(
    () => supabase.from('blog_categories').select(COLUMNS).eq('id', req.params.id).maybeSingle(),
    { label: 'admin-categories-del-load', attempts: 2 }
  );
  if (loaded.error) return fail(res, 'delete/load', loaded.error);
  if (!loaded.data) return res.status(404).json({ error: 'Category not found' });

  const cat = loaded.data;

  // Posts keep their TEXT category, so deleting the row does not break them —
  // but it does drop the name out of the editor's dropdown, which is worth a
  // deliberate confirmation rather than a surprise.
  const inUse = await withSupabaseRetry(
    () => supabase.from('blog_posts').select('id', { count: 'exact', head: true }).eq('category', cat.name),
    { label: 'admin-categories-inuse', attempts: 2 }
  );
  const count = inUse.error ? null : (inUse.count || 0);

  if (count && String(req.query.confirm || '') !== 'in-use') {
    return res.status(409).json({
      error: `${count} article${count === 1 ? '' : 's'} still use "${cat.name}". They keep the name and stay ` +
             'published, but it will no longer appear in the editor\'s dropdown. Move them first, or delete anyway.',
      requires_confirm: 'in-use',
      posts: count,
    });
  }

  const { error } = await withSupabaseRetry(
    () => supabase.from('blog_categories').delete().eq('id', cat.id),
    { label: 'admin-categories-delete', attempts: 2 }
  );
  if (error) return fail(res, 'delete', error);

  console.log(`[admin/categories] DELETED "${cat.name}" (${count} post(s) kept the name) by=${req.admin.email}`);
  return res.json({ deleted: { id: cat.id, name: cat.name, slug: cat.slug }, posts_kept: count });
}

module.exports = { list, create, update, remove };
