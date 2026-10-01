'use strict';

const { getSupabaseClient, formatFetchError } = require('./supabase-client');
const { resolveOrgForUser } = require('./org-resolve');

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

/** A column that doesn't exist yet (migration not applied) — distinct from a
 *  missing TABLE. Used to fail the Cashfree flow loudly when 017 isn't applied,
 *  rather than proceeding without the tamper-check columns. */
function isMissingColumnError(err) {
  if (err?.code === 'PGRST204') return true;
  const msg = formatFetchError(err).toLowerCase();
  return msg.includes('column') && (msg.includes('schema cache') || msg.includes('does not exist') || msg.includes('could not find'));
}

/**
 * Insert pending order row at checkout. Non-fatal if table missing — audit_cache is source of truth.
 *
 * `tierId`/`currency`/`amountUnits`/`regionTier`/`country` (migration 028
 * columns) record what the buyer was actually quoted AT CHECKOUT TIME. This is
 * what routes/verify-payment.js compares Razorpay's own payment record against
 * — the source of truth for the three-factor check is what we sold them, not a
 * fresh region lookup at verify time (which could resolve differently: a VPN
 * dropped, a new geo header, a currency-lock that wasn't set yet). All optional
 * so older callers/rows keep working with these columns NULL, and if 028 has
 * not been applied yet the insert retries WITHOUT them rather than failing the
 * whole checkout over columns that are pure add-on tamper-check data.
 */
async function insertPending({
  auditId, email, userId = null,
  tierId = null, currency = null, amountUnits = null, regionTier = null, country = null,
}) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.warn('[paid_reports] skip insert — Supabase not configured');
    return { ok: false, skipped: true };
  }

  const row = { audit_id: auditId, email, status: 'pending' };
  if (tierId)       row.tier_id       = tierId;
  if (currency)      row.currency     = currency;
  if (amountUnits)   row.amount_units = amountUnits;
  if (regionTier)     row.region_tier = regionTier;
  if (country)        row.country     = country;
  if (userId) {
    row.user_id = userId;
    // Best-effort org stamp (same one place as reports-store). Isolated so a
    // failed org lookup never blocks the pending order — row inserts org_id NULL.
    try {
      const { orgId, doctorProfileId } = await resolveOrgForUser(userId, supabase);
      if (orgId) {
        row.org_id = orgId;
        if (doctorProfileId) row.doctor_profile_id = doctorProfileId;
      }
    } catch (e) {
      console.warn(`[paid_reports] org stamp skipped audit_id=${auditId}:`, e.message);
    }
  }

  let { error } = await supabase.from('paid_reports').insert(row);

  if (error && isMissingColumnError(error)) {
    // 028 not applied yet in this environment — retry with only the columns
    // every deployment has always had, so a pricing/tamper-check add-on never
    // blocks the checkout itself.
    console.warn(`[paid_reports] tier/currency columns missing (run 028_billing_currency.sql) — inserting without them audit_id=${auditId}`);
    const minimal = { audit_id: auditId, email, status: 'pending' };
    if (row.user_id) minimal.user_id = row.user_id;
    if (row.org_id) minimal.org_id = row.org_id;
    if (row.doctor_profile_id) minimal.doctor_profile_id = row.doctor_profile_id;
    ({ error } = await supabase.from('paid_reports').insert(minimal));
  }

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

/**
 * Insert the create-time order row for a Cashfree (USD) purchase. Stores the
 * amount + currency that the verify/webhook paths compare against (tamper
 * protection), so this MUST succeed — if the 017 columns are absent we return
 * reason 'schema_not_migrated' and the caller refuses the payment rather than
 * proceeding without a verifiable row.
 */
async function insertCashfreeOrder({ auditId, email, providerOrderId, currency, amount, paymentStatus = null, regionTier = null, country = null, userId = null }) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.warn('[paid_reports] skip cashfree insert — Supabase not configured');
    return { ok: false, skipped: true };
  }

  const row = {
    audit_id: auditId, email, status: 'pending',
    provider: 'cashfree', provider_order_id: providerOrderId,
    currency, amount, payment_status: paymentStatus,
    region_tier: regionTier, country,
  };
  if (userId) row.user_id = userId;

  const { error } = await supabase.from('paid_reports').insert(row);

  if (error) {
    // Check missing-COLUMN before missing-TABLE: a "column … does not exist /
    // in the schema cache" message also mentions the table, so the broader
    // table check would misclassify it. A true missing-table message has no
    // "column" token, so it still falls through correctly.
    if (isMissingColumnError(error)) {
      console.error('[paid_reports] cashfree columns missing — run database/migrations/017_cashfree_payments.sql');
      return { ok: false, reason: 'schema_not_migrated', error };
    }
    if (isMissingTableError(error)) {
      console.error('[paid_reports] table missing — run database/migrations/001_paid_reports.sql');
      return { ok: false, reason: 'table_missing', error };
    }
    console.warn(`[paid_reports] cashfree insert warn order=${providerOrderId}:`, error.message);
    return { ok: false, error };
  }

  console.log(`[paid_reports] cashfree order stored audit_id=${auditId} order=${providerOrderId} ${amount} ${currency}`);
  return { ok: true };
}

/** Read an order row by Cashfree provider_order_id (null if absent). */
async function getByProviderOrderId(providerOrderId) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('paid_reports')
    .select('audit_id, email, status, payment_status, provider, provider_order_id, amount, currency, pdf_url, delivered_at')
    .eq('provider_order_id', providerOrderId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(`[paid_reports] getByProviderOrderId warn order=${providerOrderId}:`, error.message);
    return null;
  }
  return data || null;
}

/** Update an order row by Cashfree provider_order_id. */
async function updateByProviderOrderId(providerOrderId, fields) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, skipped: true };
  const { error } = await supabase
    .from('paid_reports')
    .update(fields)
    .eq('provider_order_id', providerOrderId);
  if (error) {
    console.warn(`[paid_reports] update-by-order warn order=${providerOrderId}:`, error.message);
    return { ok: false, error };
  }
  return { ok: true };
}

/** Read a single order row (null if absent). Used for idempotency checks. */
async function get(auditId) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  let { data, error } = await supabase
    .from('paid_reports')
    .select('audit_id, email, status, pdf_url, delivered_at, created_at, tier_id, currency, amount_units, region_tier, user_id')
    .eq('audit_id', auditId)
    .limit(1)
    .maybeSingle();
  if (error && isMissingColumnError(error)) {
    // 028 not applied yet — fall back to the columns every deployment has had.
    // user_id has existed since before 028, so it's kept even in this fallback.
    ({ data, error } = await supabase
      .from('paid_reports')
      .select('audit_id, email, status, pdf_url, delivered_at, created_at, user_id')
      .eq('audit_id', auditId)
      .limit(1)
      .maybeSingle());
  }
  if (error) {
    console.warn(`[paid_reports] get warn audit_id=${auditId}:`, error.message);
    return null;
  }
  return data || null;
}

module.exports = {
  insertPending, updateStatus, get,
  insertCashfreeOrder, getByProviderOrderId, updateByProviderOrderId,
  isMissingTableError, isCheckConstraintError, isMissingColumnError,
};
