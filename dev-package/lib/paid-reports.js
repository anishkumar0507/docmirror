'use strict';

const { getSupabaseClient, formatFetchError } = require('./supabase-client');

function isMissingTableError(err) {
  const msg = formatFetchError(err).toLowerCase();
  return (
    msg.includes('paid_reports') &&
    (msg.includes('does not exist') ||
      msg.includes('schema cache') ||
      msg.includes('relation') ||
      msg.includes('42p01'))
  );
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
      console.warn('[paid_reports] update skipped — table missing');
      return { ok: false, skipped: true, reason: 'table_missing' };
    }
    console.warn(`[paid_reports] update warn audit_id=${auditId}:`, error.message);
    return { ok: false, error };
  }

  console.log(`[paid_reports] update OK audit_id=${auditId}`, Object.keys(fields).join(','));
  return { ok: true };
}

module.exports = { insertPending, updateStatus, isMissingTableError };
