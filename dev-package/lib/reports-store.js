'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// reports-store — resilient access to the `reports` table.
//
// The live database is MISSING the unique constraint on reports.audit_id
// (migration 008's index never applied) and the reports.insights column
// (migration 010 never applied). That makes `.upsert(..., { onConflict:'audit_id' })`
// fail for EVERY write, which is why the reports table was empty in production.
//
// This module never uses onConflict and never references an `insights` column.
// Writes are done as manual "select → update | insert" by audit_id. Insights are
// stored inside audit_cache.audit_data (existing JSONB) instead of a reports column.
// ─────────────────────────────────────────────────────────────────────────────

const { withSupabaseRetry } = require('./supabase-client');

// Columns that are known to exist on `reports` in the live schema.
// `insights` was added by migration 010/011 and is now present in production
// (verified 2026-06-13), so it is written directly to the row as well as to
// audit_cache.audit_data.insights (the dashboard's source of truth).
const SAFE_FIELDS = [
  'audit_id', 'user_id', 'doctor_name', 'score', 'review_count', 'rating',
  'photo_count', 'specialty', 'city', 'competitors', 'pdf_url', 'insights',
];
const SELECT_FIELDS = ['id', ...SAFE_FIELDS, 'created_at'].join(', ');

/** Strip undefined and unknown keys so writes never reference a missing column. */
function sanitizeRow(row) {
  const out = {};
  for (const k of SAFE_FIELDS) {
    if (row[k] !== undefined) out[k] = row[k];
  }
  return out;
}

/**
 * Map an audit_cache audit_data payload into a reports-row shape.
 * Used both to write rows and to synthesize report objects when a row is missing.
 */
function reportFromAuditData(auditId, ad, extra = {}) {
  ad = ad || {};
  const city = ad.city || (ad.cityState || '').split(',')[0].trim() || null;
  return {
    audit_id:     auditId,
    doctor_name:  ad.doctorName || ad.doctorNameClean || null,
    score:        typeof ad.score === 'number' ? ad.score : (ad.score != null ? Number(ad.score) : null),
    review_count: typeof ad.reviewCount === 'number' ? ad.reviewCount : null,
    rating:       typeof ad.rating === 'number' ? ad.rating : (ad.rating != null ? Number(ad.rating) : null),
    photo_count:  typeof ad.photoCount === 'number' ? ad.photoCount : null,
    specialty:    ad.specialty || null,
    city,
    competitors:  Array.isArray(ad.competitors) && ad.competitors.length ? ad.competitors : null,
    pdf_url:      extra.pdf_url || null,
    ...extra,
  };
}

/**
 * Manual upsert by audit_id (no unique constraint needed).
 * Existing-row update only overwrites columns whose new value is non-null,
 * so a later PDF-url-only update never wipes the score/competitors written earlier.
 * Returns { ok, action: 'insert'|'update'|'skip', error? }.
 */
async function upsertReport(supabase, rawRow) {
  if (!supabase) return { ok: false, reason: 'no_supabase' };
  const row = sanitizeRow(rawRow);
  if (!row.audit_id) return { ok: false, reason: 'no_audit_id' };

  try {
    // All three round-trips go through withSupabaseRetry so a single stale-socket
    // stall (see supabase-client) is retried on a fresh connection instead of
    // burning the whole serverless budget on one 8s hang.
    const { data: existing, error: selErr } = await withSupabaseRetry(
      () => supabase.from('reports').select('id').eq('audit_id', row.audit_id).limit(1).maybeSingle(),
      { label: 'reports-select', attempts: 3 }
    );

    if (selErr) {
      console.warn(`[reports-store] select warn audit_id=${row.audit_id}:`, selErr.message);
    }

    if (existing && existing.id) {
      // Update — only set non-null fields to avoid clobbering existing data.
      const patch = {};
      for (const [k, v] of Object.entries(row)) {
        if (k === 'audit_id') continue;
        if (v !== null && v !== undefined) patch[k] = v;
      }
      if (Object.keys(patch).length === 0) return { ok: true, action: 'skip' };
      const { error: updErr } = await withSupabaseRetry(
        () => supabase.from('reports').update(patch).eq('audit_id', row.audit_id),
        { label: 'reports-update', attempts: 3 }
      );
      if (updErr) {
        console.warn(`[reports-store] update FAILED audit_id=${row.audit_id}:`, updErr.message);
        return { ok: false, action: 'update', error: updErr };
      }
      return { ok: true, action: 'update' };
    }

    const { error: insErr } = await withSupabaseRetry(
      () => supabase.from('reports').insert(row),
      { label: 'reports-insert', attempts: 3 }
    );
    if (insErr) {
      console.warn(`[reports-store] insert FAILED audit_id=${row.audit_id}:`, insErr.message);
      return { ok: false, action: 'insert', error: insErr };
    }
    return { ok: true, action: 'insert' };
  } catch (err) {
    console.warn(`[reports-store] upsert exception audit_id=${rawRow.audit_id}:`, err.message);
    return { ok: false, error: err };
  }
}

module.exports = {
  SELECT_FIELDS,
  SAFE_FIELDS,
  sanitizeRow,
  reportFromAuditData,
  upsertReport,
};
