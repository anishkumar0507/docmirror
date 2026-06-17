'use strict';

const { createClient } = require('@supabase/supabase-js');

let _client = null;
let _authClient = null;
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
    text.includes('pgrst003') ||
    text.includes('pgrst204')
  );
}

function backoffMs(attempt, baseMs = 500) {
  return baseMs * Math.pow(2, attempt - 1);
}

// ── Anti-stale-socket dispatcher ─────────────────────────────────────────────
// On Vercel the lambda is frozen after responding and thawed for the next request.
// The undici keepalive pool then tries to reuse TCP sockets that the platform has
// already killed → the next Supabase request hangs until the abort timeout (the
// observed "fetch failed after 30463ms"). A short keepalive (1s) means a thawed
// lambda always opens a fresh socket instead of stalling on a dead one.
let _dispatcher = null;
let _dispatcherTried = false;
function getDispatcher() {
  if (_dispatcherTried) return _dispatcher;
  _dispatcherTried = true;
  try {
    const { Agent } = require('undici');
    _dispatcher = new Agent({
      keepAliveTimeout: 1_000,
      keepAliveMaxTimeout: 1_000,
      connections: 64,
      connect: { timeout: 8_000 },
    });
  } catch (_) {
    _dispatcher = null; // undici not available — fall back to plain fetch
  }
  return _dispatcher;
}

// Short, readable label for a PostgREST/Storage/Auth URL → "reports?select=..." etc.
function shortUrl(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.replace(/^\/rest\/v1\//, '').replace(/^\/storage\/v1\//, 'storage/').replace(/^\/auth\/v1\//, 'auth/');
    const q = u.searchParams.toString();
    return seg + (q ? `?${q.slice(0, 80)}` : '');
  } catch { return String(url).slice(0, 80); }
}

const SLOW_MS = parseInt(process.env.SUPABASE_SLOW_LOG_MS || '1500', 10);

function createFetchWithTimeout(timeoutMs = 8_000) {
  return async (url, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    const dispatcher = getDispatcher();
    const label = shortUrl(url);
    const method = (options.method || 'GET').toUpperCase();

    try {
      const resp = await fetch(url, {
        ...options,
        keepalive: false,
        ...(dispatcher ? { dispatcher } : {}),
        signal: options.signal || controller.signal,
      });
      const elapsed = Date.now() - started;
      // Timing log for EVERY Supabase call; slow ones are flagged so the slowest
      // queries surface in the Vercel logs (Issue 4 instrumentation).
      if (elapsed >= SLOW_MS) {
        console.warn(`[supabase-timing] SLOW ${elapsed}ms ${method} ${label} (status ${resp.status})`);
      } else {
        console.log(`[supabase-timing] ${elapsed}ms ${method} ${label}`);
      }
      return resp;
    } catch (err) {
      const elapsed = Date.now() - started;
      const wrapped = new Error(
        `Supabase HTTP fetch failed after ${elapsed}ms (timeout ${timeoutMs}ms) → ${method} ${label}`
      );
      wrapped.cause = err;
      console.error(`[supabase-timing] FAIL ${elapsed}ms ${method} ${label}: ${err.name === 'AbortError' ? 'aborted (timeout)' : err.message}`);
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
      // Cap at 15s even if SUPABASE_FETCH_TIMEOUT_MS is set higher in the Vercel
      // env — a prod value of 30000 was making a single stalled socket eat the
      // entire request budget. withSupabaseRetry handles transient stalls instead.
      fetch: createFetchWithTimeout(
        Math.min(parseInt(process.env.SUPABASE_FETCH_TIMEOUT_MS || '8000', 10) || 8000, 15000)
      ),
    },
  });

  const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || 'unknown';
  console.log(`[supabase] singleton client ready project_ref=${projectRef} url=${url}`);
  return _client;
}

/**
 * Separate client keyed with the ANON key, used ONLY for auth/session operations
 * (signInWithPassword, setSession). Keeping it separate from the service-role data
 * client is important: calling signInWithPassword on the shared service client
 * swaps its Authorization header to the just-signed-in user, so any later data
 * write in the same request silently runs under that user's RLS context (and can
 * hang/timeout). It also lowers the timeout — a stuck auth call must fail fast so
 * the login route can return a clear error instead of a 30s hang.
 */
function getSupabaseAuthClient() {
  if (_authClient) return _authClient;
  const url = getSupabaseUrl();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    console.warn('[supabase] auth client unavailable — NEXT_PUBLIC_SUPABASE_ANON_KEY missing');
    return null;
  }
  _authClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createFetchWithTimeout(10_000) },
  });
  return _authClient;
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
    const { discoverAuditCacheSchema } = require('./audit-cache-schema');

    const schema = await discoverAuditCacheSchema();
    if (!schema.ok) {
      return {
        ok: false,
        code: schema.code || 'SCHEMA_MISMATCH',
        message: schema.message,
        schema,
      };
    }

    const supabase = getSupabaseClient();
    const { data, error } = await withSupabaseRetry(
      () => supabase.from('audit_cache').select('cache_key').limit(1),
      { label: 'audit-cache-table-check', attempts: 3 }
    );

    if (error) {
      const message = formatFetchError(error);
      console.error(`[supabase] audit_cache check FAILED: ${message}`);
      logSupabaseError('supabase', 'audit_cache table check', error);
      return { ok: false, code: 'TABLE_INACCESSIBLE', message, error, schema };
    }

    console.log(
      `[supabase] audit_cache check OK project_ref=${schema.projectRef} ` +
      `columns=[${schema.present.join(', ')}] rows=${Array.isArray(data) ? data.length : 0}`
    );
    return { ok: true, schema };
  })();

  return _tableCheckPromise;
}

module.exports = {
  getSupabaseClient,
  getSupabaseAuthClient,
  getSupabaseUrl,
  formatFetchError,
  logSupabaseError,
  isTransientFetchError,
  withSupabaseRetry,
  verifyAuditCacheTable,
  backoffMs,
};
