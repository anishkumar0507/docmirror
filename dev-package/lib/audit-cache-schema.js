'use strict';

const { getSupabaseClient, getSupabaseUrl, formatFetchError } = require('./supabase-client');

/** Canonical JSONB column for audit payload — must match production after migration 002. */
const PAYLOAD_COLUMN = 'audit_data';

const PROBE_COLUMNS = [
  'cache_key',
  'audit_data',
  'data',
  'created_at',
  'doctor_name',
  'specialty',
  'city',
  'state',
  'score',
  'id',
  'expires_at',
];

let _schemaPromise = null;
let _cachedSchema = null;

function getProjectRef(url = getSupabaseUrl()) {
  const match = String(url).match(/https:\/\/([^.]+)\.supabase\.co/);
  return match ? match[1] : 'unknown';
}

/**
 * Probe public.audit_cache columns via PostgREST (same path as upsert/select).
 * Equivalent to information_schema visibility from the app's perspective.
 */
async function probeColumns(supabase) {
  const present = [];
  const absent = [];

  for (const col of PROBE_COLUMNS) {
    const { error } = await supabase.from('audit_cache').select(col).limit(0);
    if (error) {
      const code = error.code || '';
      const msg = error.message || '';
      if (code === 'PGRST204' || msg.includes('column') || msg.includes('schema cache')) {
        absent.push(col);
      } else {
        absent.push(`${col}(${code || 'error'})`);
      }
    } else {
      present.push(col);
    }
  }

  return { present, absent };
}

/**
 * Startup diagnostic — logs project ref, URL, and column probe (information_schema equivalent).
 */
async function discoverAuditCacheSchema({ force = false } = {}) {
  if (_cachedSchema && !force) return _cachedSchema;
  if (_schemaPromise && !force) return _schemaPromise;

  _schemaPromise = (async () => {
    const url = getSupabaseUrl();
    const projectRef = getProjectRef(url);
    const keyEnds = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? `...${String(process.env.SUPABASE_SERVICE_ROLE_KEY).slice(-6)}`
      : '(missing)';

    console.log(
      `[audit-cache-schema] supabase project_ref=${projectRef} ` +
      `url=${url} service_role_key=${keyEnds}`
    );
    console.log('[audit-cache-schema] table=public.audit_cache schema=public');

    const supabase = getSupabaseClient();
    if (!supabase) {
      const result = {
        ok: false,
        code: 'SUPABASE_NOT_CONFIGURED',
        projectRef,
        url,
        payloadColumn: null,
        message: 'Supabase env vars missing',
      };
      _cachedSchema = result;
      return result;
    }

    const { present, absent } = await probeColumns(supabase);

    console.log(
      `[audit-cache-schema] columns present (PostgREST): [${present.join(', ')}]`
    );
    console.log(
      `[audit-cache-schema] columns absent (PostgREST): [${absent.join(', ')}]`
    );

    const hasAuditData = present.includes('audit_data');
    const hasLegacyData = present.includes('data');

    if (hasAuditData && hasLegacyData) {
      console.warn(
        '[audit-cache-schema] BOTH audit_data and data exist — run migration 002 to drop data'
      );
    }

    if (!hasAuditData && hasLegacyData) {
      console.error(
        '[audit-cache-schema] PGRST204 root cause: table has "data" but app requires "audit_data". ' +
        'Run database/migrations/002_audit_cache_audit_data.sql'
      );
    }

    const payloadOk = hasAuditData;
    const result = {
      ok: payloadOk && present.includes('cache_key'),
      code: payloadOk ? 'OK' : 'SCHEMA_MISMATCH',
      projectRef,
      url,
      table: 'public.audit_cache',
      present,
      absent,
      payloadColumn: hasAuditData ? 'audit_data' : hasLegacyData ? 'data' : null,
      expectedPayloadColumn: PAYLOAD_COLUMN,
      message: payloadOk
        ? 'audit_cache schema OK'
        : `Missing column ${PAYLOAD_COLUMN} — run migration 002_audit_cache_audit_data.sql`,
    };

    if (!result.ok) {
      console.error(`[audit-cache-schema] CHECK FAILED: ${result.message}`);
    } else {
      console.log(`[audit-cache-schema] CHECK OK payload_column=${PAYLOAD_COLUMN}`);
    }

    _cachedSchema = result;
    return result;
  })();

  return _schemaPromise;
}

function getPayloadColumn() {
  return PAYLOAD_COLUMN;
}

/** Build upsert row — only columns that exist in canonical minimal schema. */
function buildUpsertRow(cacheKey, payload) {
  return {
    cache_key: cacheKey,
    [PAYLOAD_COLUMN]: payload,
  };
}

/** Extract payload from a DB row (handles legacy `data` only when reading old rows). */
function extractPayload(row) {
  if (!row) return null;
  if (row[PAYLOAD_COLUMN] != null) return row[PAYLOAD_COLUMN];
  if (row.data != null) {
    console.warn('[audit-cache-schema] read legacy column "data" — run migration 002');
    return row.data;
  }
  return null;
}

function getSelectColumns() {
  return `cache_key, ${PAYLOAD_COLUMN}`;
}

module.exports = {
  PAYLOAD_COLUMN,
  getProjectRef,
  discoverAuditCacheSchema,
  getPayloadColumn,
  buildUpsertRow,
  extractPayload,
  getSelectColumns,
  probeColumns,
};
