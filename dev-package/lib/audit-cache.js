'use strict';

const memoryStore = require('./audit-store');
const {
  getSupabaseClient,
  formatFetchError,
  logSupabaseError,
  withSupabaseRetry,
  verifyAuditCacheTable,
} = require('./supabase-client');
const {
  PAYLOAD_COLUMN,
  discoverAuditCacheSchema,
  buildUpsertRow,
  extractPayload,
  getSelectColumns,
} = require('./audit-cache-schema');

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

async function upsertAuditCache(supabase, key, row) {
  const selectCols = getSelectColumns();

  console.log(
    `[audit-cache] WRITE start table=public.audit_cache cache_key=${key} ` +
    `columns=[${Object.keys(row).join(', ')}]`
  );
  console.log(
    `[audit-cache] WRITE payload ${PAYLOAD_COLUMN} keys=[${Object.keys(row[PAYLOAD_COLUMN] || {}).slice(0, 12).join(', ')}...]`
  );

  const { data, error } = await withSupabaseRetry(
    () =>
      supabase
        .from('audit_cache')
        .upsert(row, { onConflict: 'cache_key' })
        .select(selectCols),
    { label: 'audit-cache-write', attempts: 3 }
  );

  if (error) {
    logSupabaseError('audit-cache', `WRITE FAILED cache_key=${key}`, error);
    if (error.code === 'PGRST204') {
      console.error(
        `[audit-cache] PGRST204 failing query: UPSERT public.audit_cache ` +
        `ON CONFLICT (cache_key) SET ${JSON.stringify(Object.keys(row))} — ` +
        `PostgREST cannot see column "${PAYLOAD_COLUMN}". ` +
        'Run database/migrations/002_audit_cache_audit_data.sql and NOTIFY pgrst reload.'
      );
    }
    return { ok: false, error };
  }

  console.log(`[audit-cache] WRITE OK cache_key=${key} rows=${data?.length ?? 1}`);
  return { ok: true, data };
}

async function readAuditCacheRow(supabase, key) {
  const selectCols = getSelectColumns();
  console.log(`[audit-cache] READ start table=public.audit_cache cache_key=${key} select=${selectCols}`);

  return withSupabaseRetry(
    () =>
      supabase
        .from('audit_cache')
        .select(selectCols)
        .eq('cache_key', key)
        .maybeSingle(),
    { label: 'audit-cache-read', attempts: 3 }
  );
}

/**
 * Persist audit payload — memory + public.audit_cache (cache_key + audit_data only).
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

  const schema = await discoverAuditCacheSchema();
  if (!schema.ok) {
    throw new AuditCacheError(
      'SCHEMA_MISMATCH',
      schema.message,
      { cache_key: key, schema }
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

  const row = buildUpsertRow(key, payload);
  const write = await upsertAuditCache(supabase, key, row);
  if (!write.ok) {
    throw new AuditCacheError(
      'WRITE_FAILED',
      `audit_cache upsert failed for cache_key=${key}: ${formatFetchError(write.error)}`,
      { cache_key: key, error: write.error, rowKeys: Object.keys(row) }
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

  const verified = extractPayload(verifyRow);
  if (!verified) {
    console.error(`[audit-cache] WRITE verify-read MISS cache_key=${key} (${PAYLOAD_COLUMN} empty)`);
    throw new AuditCacheError(
      'WRITE_VERIFY_MISS',
      `audit_cache row missing ${PAYLOAD_COLUMN} immediately after upsert for cache_key=${key}`,
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

/**
 * Merge a partial object into an existing audit_cache row's audit_data and persist.
 * Used to store Claude-generated `insights` alongside the original audit payload so the
 * dashboard can read rich data WITHOUT requiring a separate reports.insights column.
 * Non-fatal: returns { ok:false } on any problem instead of throwing.
 */
async function mergeAuditData(auditId, partial) {
  const key = normalizeAuditId(auditId);
  if (!isValidAuditId(key) || !partial || typeof partial !== 'object') {
    return { ok: false, reason: 'invalid_args' };
  }

  // Update in-memory copy immediately
  const mem = memoryStore.get(key);
  if (mem) memoryStore.set(key, { ...mem, ...partial });

  const supabase = db();
  if (!supabase) return { ok: false, reason: 'no_supabase' };

  try {
    const { data: row, error: readErr } = await readAuditCacheRow(supabase, key);
    if (readErr || !row) {
      console.warn(`[audit-cache] mergeAuditData read miss cache_key=${key}: ${readErr?.message || 'no row'}`);
      return { ok: false, reason: 'not_found' };
    }
    const current = extractPayload(row) || {};
    const merged  = { ...current, ...partial, auditId: key };
    const newRow  = buildUpsertRow(key, merged);
    const write   = await upsertAuditCache(supabase, key, newRow);
    if (!write.ok) {
      console.warn(`[audit-cache] mergeAuditData write failed cache_key=${key}`);
      return { ok: false, reason: 'write_failed' };
    }
    memoryStore.set(key, merged);
    console.log(`[audit-cache] mergeAuditData OK cache_key=${key} keys=[${Object.keys(partial).join(',')}]`);
    return { ok: true };
  } catch (err) {
    console.warn(`[audit-cache] mergeAuditData exception cache_key=${key}:`, err.message);
    return { ok: false, reason: 'exception' };
  }
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
    if (error.code === 'PGRST204') {
      console.error(
        `[audit-cache] PGRST204 failing query: SELECT ${getSelectColumns()} ` +
        `FROM public.audit_cache WHERE cache_key='${key}'`
      );
    }
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

  const auditPayload = extractPayload(row);
  if (auditPayload) {
    if (row.cache_key !== key) {
      console.warn(
        `[audit-cache] cache_key mismatch row=${row.cache_key} searched=${key}`
      );
    }
    console.log(`[audit-cache] HIT supabase audit_cache cache_key=${key}`);
    memoryStore.set(key, auditPayload);
    return { data: auditPayload, hit: true, source: 'audit_cache', cache_key: key };
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
  mergeAuditData,
  formatDiagnostic,
  resolveAuditIdFromOrder,
  isValidAuditId,
  normalizeAuditId,
  AuditCacheError,
  AUDIT_ID_RE,
  verifyAuditCacheTable,
  discoverAuditCacheSchema,
  PAYLOAD_COLUMN,
};
