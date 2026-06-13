'use strict';

const { getSupabaseClient, formatFetchError } = require('./supabase-client');

function isMissingTableError(err) {
  // Be PRECISE: only a genuinely-absent table. The old version also matched the
  // word "relation", which made a CHECK-constraint violation ("...for relation
  // \"paid_reports\" violates check constraint...", code 23514) look like a
  // missing table and silently swallowed real errors.
  if (err?.code === '42P01' || err?.code === 'PGRST205') return true;
  const msg = formatFetchError(err).toLowerCase();
  if (msg.includes('violates') || err?.code === '23514') return false;
  return (
    msg.includes('paid_reports') &&
    (msg.includes('does not exist') || msg.includes('schema cache') ||
      msg.includes('could not find the table'))
  );
}

/** A status value rejected by the paid_reports_status_check constraint. */
function isCheckConstraintError(err) {
  return err?.code === '23514' || formatFetchError(err).toLowerCase().includes('violates check constraint');
}

/**
 * Insert pending order row at checkout. Non-fatal if table missing — audit_cache is source of truth.
 */
async function insertPending({ auditId, email, userId = null }) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.warn('[paid_reports] skip insert — Supabase not configured');
    return { ok: false, skipped: true };
  }

  const row = { audit_id: auditId, email, status: 'pending' };
  if (userId) row.user_id = userId;

  const { error } = await supabase.from('paid_reports').insert(row);

  if (error) {
    if (isMissingTableError(error)) {
      console.warn(
        '[paid_reports] table missing — run database/migrations/001_paid_reports.sql'
      );
      return { ok: false, skipped: true, reason: 'table_missing' };
    }
    console.warn(`[paid_reports] insert warn audit_id=${auditId}:`, error.message);
    return { ok: false, error };
  }

  console.log(`[paid_reports] insert OK audit_id=${auditId} status=pending`);
  return { ok: true };
}

/**
 * Update order status. Non-fatal — PDF pipeline does not depend on this table.
 */
async function updateStatus(auditId, fields) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, skipped: true };

  const { error } = await supabase
    .from('paid_reports')
    .update(fields)
    .eq('audit_id', auditId);

  if (error) {
    if (isMissingTableError(error)) {
      console.warn('[paid_reports] update skipped — table missing (run 001_paid_reports.sql)');
      return { ok: false, skipped: true, reason: 'table_missing' };
    }
    // A status value outside the CHECK constraint would reject the WHOLE update,
    // dropping pdf_url/delivered_at too. Retry without `status` so the other
    // columns still persist. (Apply migration 012 to widen the constraint.)
    if (isCheckConstraintError(error) && 'status' in fields) {
      const { status, ...rest } = fields;
      if (Object.keys(rest).length) {
        const retry = await supabase.from('paid_reports').update(rest).eq('audit_id', auditId);
        if (!retry.error) {
          console.warn(`[paid_reports] status='${status}' rejected by check constraint — saved ${Object.keys(rest).join(',')} without status (run migration 012)`);
          return { ok: true, partial: true, droppedStatus: status };
        }
      }
      console.warn(`[paid_reports] status='${fields.status}' rejected by check constraint (run migration 012)`);
      return { ok: false, reason: 'status_not_allowed', error };
    }
    console.warn(`[paid_reports] update warn audit_id=${auditId}:`, error.message);
    return { ok: false, error };
  }

  console.log(`[paid_reports] update OK audit_id=${auditId}`, Object.keys(fields).join(','));
  return { ok: true };
}

/** Read a single order row (null if absent). Used for idempotency checks. */
async function get(auditId) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('paid_reports')
    .select('audit_id, email, status, pdf_url, delivered_at, created_at')
    .eq('audit_id', auditId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(`[paid_reports] get warn audit_id=${auditId}:`, error.message);
    return null;
  }
  return data || null;
}

module.exports = { insertPending, updateStatus, get, isMissingTableError, isCheckConstraintError };
