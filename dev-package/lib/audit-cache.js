'use strict';

const memoryStore = require('./audit-store');
const {
  getSupabaseClient,
  formatFetchError,
  logSupabaseError,
  withSupabaseRetry,
  verifyAuditCacheTable,
} = require('./supabase-client');

const AUDIT_ID_RE = /^tdm_\d+_[a-z0-9]{4}$/;

class AuditCacheError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AuditCacheError';
    this.code = code;
    this.details = details;
  }
}

function isValidAuditId(id) {
  return typeof id === 'string' && AUDIT_ID_RE.test(id);
}

function normalizeAuditId(id) {
  if (id == null) return '';
  return String(id).trim();
}

function assertValidAuditId(key, context) {
  if (!key) {
    throw new AuditCacheError('INVALID_AUDIT_ID', `${context}: auditId is empty`, { key });
  }
  if (!isValidAuditId(key)) {
    throw new AuditCacheError(
      'INVALID_AUDIT_ID',
      `${context}: auditId must match tdm_<timestamp>_<random4> but got "${key}"`,
      { key, expectedFormat: 'tdm_<timestamp>_<random>' }
    );
  }
}

function db() {
  return getSupabaseClient();
}

function buildRow(key, payload) {
  const cityRaw = (payload.cityState || '').split(',');
  const city    = payload.city || (cityRaw[0] || '').trim();
  const state   = payload.state || (cityRaw[1] || '').trim();

  return {
    cache_key:   key,
    doctor_name: payload.doctorName || '',
    specialty:   payload.specialty  || '',
    city,
    state,
    score:       payload.score || 0,
    audit_data:  payload,
  };
}

async function upsertAuditCache(supabase, key, row) {
  console.log(`[audit-cache] WRITE start cache_key=${key}`);
  const { data, error } = await withSupabaseRetry(
    () => supabase.from('audit_cache').upsert(row, { onConflict: 'cache_key' }).select('cache_key'),
    { label: 'audit-cache-write', attempts: 3 }
  );

  if (error) {
    logSupabaseError('audit-cache', `WRITE FAILED cache_key=${key}`, error);
    return { ok: false, error };
  }

  console.log(`[audit-cache] WRITE OK cache_key=${key} rows=${data?.length ?? 1}`);
  return { ok: true, data };
}

async function readAuditCacheRow(supabase, key) {
  console.log(`[audit-cache] READ start cache_key=${key}`);
  return withSupabaseRetry(
    () =>
      supabase
        .from('audit_cache')
        .select('audit_data, cache_key')
        .eq('cache_key', key)
        .maybeSingle(),
    { label: 'audit-cache-read', attempts: 3 }
  );
}

/**
 * Persist audit payload — memory + Supabase audit_cache (required).
 * Throws AuditCacheError if Supabase write fails — checkout must not proceed without cache.
 */
async function set(auditId, auditData) {
  const key = normalizeAuditId(auditId);
  assertValidAuditId(key, 'audit-cache.set');

  const payload = { ...auditData, auditId: key };

  console.log(
    `[audit-cache] SET cache_key=${key} valid=true doctor=${payload.doctorName || '(unknown)'}`
  );

  memoryStore.set(key, payload);

  const supabase = db();
  if (!supabase) {
    throw new AuditCacheError(
      'SUPABASE_NOT_CONFIGURED',
      'Cannot persist audit_cache — NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing',
      { cache_key: key }
    );
  }

  const tableCheck = await verifyAuditCacheTable();
  if (!tableCheck.ok) {
    throw new AuditCacheError(
      'TABLE_INACCESSIBLE',
      `audit_cache table not accessible: ${tableCheck.message}`,
      { cache_key: key, tableCheck }
    );
  }

  const row = buildRow(key, payload);
  const write = await upsertAuditCache(supabase, key, row);
  if (!write.ok) {
    throw new AuditCacheError(
      'WRITE_FAILED',
      `audit_cache upsert failed for cache_key=${key}: ${formatFetchError(write.error)}`,
      { cache_key: key, error: write.error }
    );
  }

  const { data: verifyRow, error: verifyErr } = await readAuditCacheRow(supabase, key);
  if (verifyErr) {
    logSupabaseError('audit-cache', `WRITE verify-read FAILED cache_key=${key}`, verifyErr);
    throw new AuditCacheError(
      'WRITE_VERIFY_FAILED',
      `audit_cache write could not be verified for cache_key=${key}: ${formatFetchError(verifyErr)}`,
      { cache_key: key, error: verifyErr }
    );
  }
  if (!verifyRow?.audit_data) {
    console.error(`[audit-cache] WRITE verify-read MISS cache_key=${key} (row empty after upsert)`);
    throw new AuditCacheError(
      'WRITE_VERIFY_MISS',
      `audit_cache row missing immediately after upsert for cache_key=${key}`,
      { cache_key: key }
    );
  }
  console.log(`[audit-cache] WRITE verified cache_key=${verifyRow.cache_key}`);

  return { cache_key: key, doctorName: payload.doctorName };
}

async function get(auditId) {
  const result = await getDetailed(auditId);
  return result.data;
}

async function getDetailed(auditId) {
  const key = normalizeAuditId(auditId);
  const valid = isValidAuditId(key);

  console.log(`[audit-cache] GET cache_key=${key} format_valid=${valid}`);

  if (!key) {
    return {
      data: null,
      hit: false,
      source: null,
      code: 'INVALID_AUDIT_ID',
      message: 'auditId is empty',
      cache_key: key,
    };
  }

  if (!valid) {
    console.warn(
      `[audit-cache] GET invalid format cache_key=${key} expected=tdm_<timestamp>_<random4>`
    );
    return {
      data: null,
      hit: false,
      source: null,
      code: 'INVALID_AUDIT_ID',
      message: `auditId format invalid: "${key}" (expected tdm_<timestamp>_<random>)`,
      cache_key: key,
    };
  }

  const mem = memoryStore.get(key);
  if (mem) {
    console.log(`[audit-cache] HIT memory cache_key=${key}`);
    return { data: mem, hit: true, source: 'memory', cache_key: key };
  }

  console.log(`[audit-cache] MISS memory cache_key=${key} (cross-instance or cold start)`);

  const supabase = db();
  if (!supabase) {
    console.error(`[audit-cache] MISS all — Supabase not configured cache_key=${key}`);
    return {
      data: null,
      hit: false,
      source: null,
      code: 'SUPABASE_NOT_CONFIGURED',
      message: 'Supabase client not configured — cannot read audit_cache on this instance',
      cache_key: key,
    };
  }

  const { data: row, error } = await readAuditCacheRow(supabase, key);

  if (error) {
    logSupabaseError('audit-cache', `READ FAILED cache_key=${key}`, error);
    return {
      data: null,
      hit: false,
      source: 'audit_cache',
      code: 'READ_FAILED',
      message: `Supabase read failed for cache_key=${key}: ${formatFetchError(error)}`,
      cache_key: key,
      error,
    };
  }

  if (row?.audit_data) {
    if (row.cache_key !== key) {
      console.warn(
        `[audit-cache] cache_key mismatch row=${row.cache_key} searched=${key}`
      );
    }
    console.log(`[audit-cache] HIT supabase audit_cache cache_key=${key}`);
    memoryStore.set(key, row.audit_data);
    return { data: row.audit_data, hit: true, source: 'audit_cache', cache_key: key };
  }

  console.error(
    `[audit-cache] MISS supabase audit_cache cache_key=${key} — ` +
    'no row (check checkout logs for WRITE OK / WRITE verified)'
  );

  return {
    data: null,
    hit: false,
    source: null,
    code: 'CACHE_MISS',
    message:
      `No audit data for cache_key=${key}. Payment was verified but audit payload was never ` +
      'persisted at checkout (check checkout logs for WRITE OK / WRITE verified).',
    cache_key: key,
  };
}

async function getRequired(auditId) {
  const result = await getDetailed(auditId);
  if (result.data) return result;

  throw new AuditCacheError(
    result.code || 'CACHE_MISS',
    result.message || `audit_cache not found for ${result.cache_key}`,
    result
  );
}

function formatDiagnostic(result) {
  return {
    code: result.code,
    message: result.message,
    cache_key: result.cache_key,
    source: result.source,
    hit: result.hit,
  };
}

async function resolveAuditIdFromOrder(orderId, clientAuditId) {
  const client = normalizeAuditId(clientAuditId);
  let fromNotes = '';

  try {
    const Razorpay = require('razorpay');
    const rzp = new Razorpay({
      key_id:     process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    const order = await rzp.orders.fetch(orderId);
    fromNotes = normalizeAuditId(order.notes?.auditId);

    console.log(
      `[audit-cache] resolve orderId=${orderId} client=${client} ` +
      `notes=${fromNotes} receipt=${order.receipt || '(none)'}`
    );

    if (client && fromNotes && client !== fromNotes) {
      console.warn(
        `[audit-cache] auditId MISMATCH — client sent "${client}" but ` +
        `Razorpay notes have "${fromNotes}". Using notes value.`
      );
    }
  } catch (err) {
    logSupabaseError('audit-cache', `resolve orderId=${orderId}`, err);
  }

  const canonical = fromNotes || client;
  if (!isValidAuditId(canonical)) {
    console.warn(`[audit-cache] invalid auditId format: "${canonical}"`);
  }
  return canonical;
}

module.exports = {
  set,
  get,
  getDetailed,
  getRequired,
  formatDiagnostic,
  resolveAuditIdFromOrder,
  isValidAuditId,
  normalizeAuditId,
  AuditCacheError,
  AUDIT_ID_RE,
  verifyAuditCacheTable,
};
