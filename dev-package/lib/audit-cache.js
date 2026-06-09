'use strict';

const { createClient } = require('@supabase/supabase-js');
const memoryStore = require('./audit-store');

const AUDIT_ID_RE = /^tdm_\d+_[a-z0-9]{4}$/;

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function isValidAuditId(id) {
  return typeof id === 'string' && AUDIT_ID_RE.test(id);
}

function normalizeAuditId(id) {
  if (id == null) return '';
  return String(id).trim();
}

/**
 * Persist audit payload — memory (fast) + Supabase audit_cache (Vercel-safe).
 * Always embeds auditId inside audit_data for fallback lookups.
 */
async function set(auditId, auditData) {
  const key = normalizeAuditId(auditId);
  if (!key) throw new Error('audit-cache.set: auditId required');

  const payload = { ...auditData, auditId: key };

  console.log(`[audit-cache] SET key=${key} doctor=${payload.doctorName || '(unknown)'}`);

  memoryStore.set(key, payload);

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[audit-cache] Supabase not configured — memory only');
    return;
  }

  const cityRaw = (payload.cityState || '').split(',');
  const city    = payload.city || (cityRaw[0] || '').trim();
  const state   = payload.state || (cityRaw[1] || '').trim();

  const row = {
    cache_key:   key,
    doctor_name: payload.doctorName || '',
    specialty:   payload.specialty  || '',
    city,
    state,
    score:       payload.score || 0,
    audit_data:  payload,
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { error } = await db()
        .from('audit_cache')
        .upsert(row, { onConflict: 'cache_key' });

      if (error) {
        console.warn(`[audit-cache] upsert attempt ${attempt}/3:`, error.message);
      } else {
        console.log(`[audit-cache] upsert OK key=${key}`);
        return;
      }
    } catch (err) {
      console.warn(`[audit-cache] upsert attempt ${attempt}/3 exception:`, err.message);
    }
    await new Promise(r => setTimeout(r, attempt * 500));
  }
}

/**
 * Load audit payload — memory first, then Supabase by cache_key.
 */
async function get(auditId) {
  const key = normalizeAuditId(auditId);
  console.log(`[audit-cache] GET key=${key} valid=${isValidAuditId(key)}`);

  if (!key) return null;

  const mem = memoryStore.get(key);
  if (mem) {
    console.log(`[audit-cache] HIT memory key=${key}`);
    return mem;
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn(`[audit-cache] MISS memory key=${key} (no Supabase)`);
    return null;
  }

  try {
    const { data: row, error } = await db()
      .from('audit_cache')
      .select('audit_data, cache_key')
      .eq('cache_key', key)
      .maybeSingle();

    if (error) {
      console.warn(`[audit-cache] Supabase read error key=${key}:`, error.message);
      return null;
    }

    if (row?.audit_data) {
      console.log(`[audit-cache] HIT supabase cache_key=${row.cache_key}`);
      memoryStore.set(key, row.audit_data);
      return row.audit_data;
    }

    console.warn(`[audit-cache] MISS supabase key=${key}`);
    return null;
  } catch (err) {
    console.warn(`[audit-cache] Supabase exception key=${key}:`, err.message);
    return null;
  }
}

/**
 * Resolve canonical auditId from Razorpay order notes (source of truth).
 * Receipt field is NOT used — Razorpay may truncate receipt to ~16 chars.
 */
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
    console.warn(`[audit-cache] could not fetch Razorpay order ${orderId}:`, err.message);
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
  resolveAuditIdFromOrder,
  isValidAuditId,
  normalizeAuditId,
  AUDIT_ID_RE,
};
