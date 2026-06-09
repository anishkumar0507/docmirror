'use strict';

// In-memory fallback store for audit data.
// Used when Supabase audit_cache insert/fetch fails.
// Lives for the lifetime of the server process — sufficient for the
// checkout → verify → report pipeline which completes within seconds.
const store = new Map();

module.exports = {
  set: (key, data) => store.set(key, data),
  get: (key) => store.get(key),
  del: (key) => store.delete(key)
};
