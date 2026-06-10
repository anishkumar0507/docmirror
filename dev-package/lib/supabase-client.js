'use strict';

const { createClient } = require('@supabase/supabase-js');

let _client = null;
let _tableCheckPromise = null;

/** Normalize project URL — trailing slashes break some fetch stacks on Vercel. */
function getSupabaseUrl() {
  const raw =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    '';
  return String(raw).trim().replace(/\/+$/, '');
}

/**
 * Serialize fetch / PostgREST errors for logs (includes err.cause chain).
 */
function formatFetchError(err) {
  if (!err) return 'unknown error';

  const lines = [];
  let current = err;
  let depth = 0;

  while (current && depth < 6) {
    const msg = current.message || String(current);
    const code = current.code ? ` code=${current.code}` : '';
    const errno = current.errno ? ` errno=${current.errno}` : '';
    const syscall = current.syscall ? ` syscall=${current.syscall}` : '';
    const hostname = current.hostname ? ` host=${current.hostname}` : '';
    const details = current.details ? ` details=${current.details}` : '';
    const hint = current.hint ? ` hint=${current.hint}` : '';
    lines.push(`${msg}${code}${errno}${syscall}${hostname}${details}${hint}`);
    current = current.cause;
    depth++;
  }

  return lines.join(' ← ');
}

/** Log full Supabase / fetch error including cause chain and JSON snapshot. */
function logSupabaseError(label, context, err) {
  console.error(`[${label}] context=${context}`);
  console.error(`[${label}] message: ${err?.message || String(err)}`);
  if (err?.cause) {
    console.error(`[${label}] cause:`, err.cause);
    if (err.cause?.message) console.error(`[${label}] cause.message: ${err.cause.message}`);
  }
  if (err?.code) console.error(`[${label}] code: ${err.code}`);
  if (err?.details) console.error(`[${label}] details: ${err.details}`);
  if (err?.hint) console.error(`[${label}] hint: ${err.hint}`);
  try {
    const snapshot = {
      message: err?.message,
      code: err?.code,
      details: err?.details,
      hint: err?.hint,
      causeMessage: err?.cause?.message,
      causeCode: err?.cause?.code,
    };
    console.error(`[${label}] snapshot: ${JSON.stringify(snapshot)}`);
  } catch (_) {
    console.error(`[${label}] raw error:`, err);
  }
}

function isTransientFetchError(err) {
  const text = formatFetchError(err).toLowerCase();
  return (
    text.includes('fetch failed') ||
    text.includes('econnreset') ||
    text.includes('econnrefused') ||
    text.includes('enotfound') ||
    text.includes('etimedout') ||
    text.includes('timeout') ||
    text.includes('abort') ||
    text.includes('socket') ||
    text.includes('network') ||
    text.includes('schema cache') ||
    text.includes('pgrst002') ||
    text.includes('pgrst003')
  );
}

function backoffMs(attempt, baseMs = 500) {
  return baseMs * Math.pow(2, attempt - 1);
}

function createFetchWithTimeout(timeoutMs = 12_000) {
  return async (url, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    try {
      return await fetch(url, {
        ...options,
        signal: options.signal || controller.signal,
      });
    } catch (err) {
      const elapsed = Date.now() - started;
      const wrapped = new Error(
        `Supabase HTTP fetch failed after ${elapsed}ms → ${url}`
      );
      wrapped.cause = err;
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }
  };
}

function getSupabaseClient() {
  if (_client) return _client;

  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  if (!url.startsWith('https://') || !url.includes('.supabase.co')) {
    console.warn(
      `[supabase] URL may be invalid (expected https://<ref>.supabase.co): ${url}`
    );
  }

  _client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: createFetchWithTimeout(
        parseInt(process.env.SUPABASE_FETCH_TIMEOUT_MS || '12000', 10)
      ),
    },
  });

  console.log(`[supabase] singleton client ready url=${url}`);
  return _client;
}

/**
 * Run a Supabase query with retries (3 attempts, exponential backoff).
 * Retries transient network errors and PostgREST schema-cache staleness.
 */
async function withSupabaseRetry(runQuery, { label = 'supabase', attempts = 3 } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await runQuery();

      if (result?.error) {
        if (isTransientFetchError(result.error)) {
          lastError = result.error;
          logSupabaseError(label, `attempt ${attempt}/${attempts} retryable`, result.error);
        } else {
          return result;
        }
      } else {
        if (attempt > 1) {
          console.log(`[${label}] succeeded on attempt ${attempt}/${attempts}`);
        }
        return result;
      }
    } catch (err) {
      lastError = err;
      logSupabaseError(label, `attempt ${attempt}/${attempts} exception`, err);
    }

    if (attempt < attempts) {
      const wait = backoffMs(attempt);
      console.log(`[${label}] backoff ${wait}ms before retry ${attempt + 1}/${attempts}`);
      await new Promise(r => setTimeout(r, wait));
    }
  }

  return { data: null, error: lastError };
}

/**
 * Startup / health check — confirms public.audit_cache is reachable.
 * Cached per process so we only probe once per lambda cold start.
 */
async function verifyAuditCacheTable() {
  if (_tableCheckPromise) return _tableCheckPromise;

  _tableCheckPromise = (async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      const result = { ok: false, code: 'SUPABASE_NOT_CONFIGURED', message: 'Supabase env vars missing' };
      console.error(`[supabase] audit_cache check FAILED: ${result.message}`);
      return result;
    }

    console.log('[supabase] audit_cache accessibility check starting...');

    const { data, error } = await withSupabaseRetry(
      () => supabase.from('audit_cache').select('cache_key').limit(1),
      { label: 'audit-cache-table-check', attempts: 3 }
    );

    if (error) {
      const message = formatFetchError(error);
      console.error(`[supabase] audit_cache check FAILED: ${message}`);
      logSupabaseError('supabase', 'audit_cache table check', error);
      return { ok: false, code: 'TABLE_INACCESSIBLE', message, error };
    }

    console.log(
      `[supabase] audit_cache check OK (sample rows=${Array.isArray(data) ? data.length : 0})`
    );
    return { ok: true };
  })();

  return _tableCheckPromise;
}

module.exports = {
  getSupabaseClient,
  getSupabaseUrl,
  formatFetchError,
  logSupabaseError,
  isTransientFetchError,
  withSupabaseRetry,
  verifyAuditCacheTable,
  backoffMs,
};
