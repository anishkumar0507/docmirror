'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// report_credits — the ONLY place that reads/writes the report_credits table.
// Used by routes/verify-payment.js (the client-callback grant) AND
// routes/webhook-razorpay.js (the backstop grant), and by routes/report-credits.js
// (list/consume for the redeem flow).
//
// grantCredit() is idempotent on payment_id (UNIQUE) — whichever caller runs
// first wins; the second is a harmless duplicate-key no-op, never a second
// credit for the same payment.
// ─────────────────────────────────────────────────────────────────────────────

const { getSupabaseClient, formatFetchError } = require('./supabase-client');

function isMissingTableError(err) {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  return formatFetchError(err).toLowerCase().includes('report_credits');
}

/**
 * Grant one credit for a successful report_onetime payment. Safe to call more
 * than once for the same paymentId — returns the EXISTING row on a duplicate,
 * never inserts a second one.
 */
async function grantCredit({ userId, paymentId, orderAuditId, currency, amountUnits }) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, reason: 'no_db' };
  if (!userId || !paymentId) return { ok: false, reason: 'missing_fields' };

  const { data, error } = await supabase
    .from('report_credits')
    .insert({
      user_id: userId, payment_id: paymentId, order_audit_id: orderAuditId || null,
      currency, amount_units: amountUnits, status: 'available',
    })
    .select('id, status')
    .single();

  if (!error) {
    console.log(`[report-credits] granted userId=${userId} paymentId=${paymentId} creditId=${data.id}`);
    return { ok: true, credit: data, created: true };
  }

  if (/duplicate|unique|23505/i.test(`${error.code} ${error.message}`)) {
    // Already granted (by the other caller, or a replayed request) — fetch and
    // return the existing row rather than treating this as an error.
    const { data: existing } = await supabase
      .from('report_credits').select('id, status').eq('payment_id', paymentId).maybeSingle();
    console.log(`[report-credits] already granted paymentId=${paymentId} (idempotent no-op)`);
    return { ok: true, credit: existing || null, created: false };
  }

  if (isMissingTableError(error)) {
    console.error('[report-credits] table missing — run database/migrations/029_report_credits.sql');
    return { ok: false, reason: 'table_missing' };
  }

  console.error(`[report-credits] grant FAILED userId=${userId} paymentId=${paymentId}: ${error.message}`);
  return { ok: false, reason: 'db_error', error };
}

/** The oldest available (unredeemed) credit for a user, or null. */
async function findAvailableCredit(userId) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('report_credits')
    .select('id, currency, amount_units, created_at')
    .eq('user_id', userId).eq('status', 'available')
    .order('created_at', { ascending: true })
    .limit(1).maybeSingle();
  if (error) {
    console.warn(`[report-credits] findAvailableCredit warn userId=${userId}: ${error.message}`);
    return null;
  }
  return data || null;
}

/**
 * Atomically mark ONE credit used. The WHERE clause (id + user_id + still
 * 'available') is what makes this race-safe: two concurrent redeem requests
 * for the same credit both run this, and only one UPDATE actually matches a
 * row — Postgres/PostgREST returns zero rows to the loser, which is read here
 * as "already consumed" rather than silently succeeding twice.
 */
async function consumeCredit({ creditId, userId, doctorRef, redeemedAuditId }) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, reason: 'no_db' };

  const { data, error } = await supabase
    .from('report_credits')
    .update({ status: 'used', doctor_ref: doctorRef, redeemed_audit_id: redeemedAuditId, used_at: new Date().toISOString() })
    .eq('id', creditId).eq('user_id', userId).eq('status', 'available')
    .select('id')
    .maybeSingle();

  if (error) {
    console.error(`[report-credits] consume FAILED creditId=${creditId} userId=${userId}: ${error.message}`);
    return { ok: false, reason: 'db_error', error };
  }
  if (!data) {
    // Someone else consumed it first (double-click, retry) — not an error, but
    // the caller must NOT proceed to generate a second report for it.
    return { ok: false, reason: 'already_consumed' };
  }
  console.log(`[report-credits] consumed creditId=${creditId} userId=${userId} redeemedAuditId=${redeemedAuditId}`);
  return { ok: true };
}

/** Every credit (available + used) for a user, newest first — purchase history. */
async function listCredits(userId) {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('report_credits')
    .select('id, status, currency, amount_units, doctor_ref, redeemed_audit_id, created_at, used_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    console.warn(`[report-credits] listCredits warn userId=${userId}: ${error.message}`);
    return [];
  }
  return data || [];
}

/** Which user owns the credit that redeemed into this auditId, or null.
 *  Includes `currency` — what that credit was actually bought in — so the
 *  generated PDF's own upsell pricing can match it. */
async function findByRedeemedAuditId(auditId) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('report_credits').select('id, user_id, redeemed_audit_id, currency')
    .eq('redeemed_audit_id', auditId).maybeSingle();
  if (error) return null;
  return data || null;
}

module.exports = { grantCredit, findAvailableCredit, consumeCredit, listCredits, findByRedeemedAuditId, isMissingTableError };
