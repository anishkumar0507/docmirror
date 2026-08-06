'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Owning legal entity — SINGLE SOURCE OF TRUTH.
//
// "The Doc Mirror" remains the PRODUCT BRAND everywhere. NEXTDOT is only the
// owning/operating company, surfaced for compliance (e.g. Razorpay activation).
//
// Do NOT hardcode the entity name anywhere else — import from here (server side)
// or read it from /api/client-config (browser side; see routes/config.js).
//
// REGISTERED_ADDRESS and SUPPORT_PHONE are intentionally empty. Any consumer
// MUST omit the corresponding line entirely when a value is empty — never render
// an empty address/phone row or a placeholder.
// ─────────────────────────────────────────────────────────────────────────────

const LEGAL_ENTITY         = 'NEXTDOT DIGITAL SOLUTIONS PRIVATE LIMITED'; // all-caps (registered form)
const LEGAL_ENTITY_DISPLAY = 'NextDot Digital Solutions Private Limited'; // title case
const SUPPORT_EMAIL        = 'thedocmirror@gmail.com';

const REGISTERED_ADDRESS   = ''; // TODO: fill in
const SUPPORT_PHONE        = ''; // TODO: fill in

module.exports = {
  LEGAL_ENTITY,
  LEGAL_ENTITY_DISPLAY,
  SUPPORT_EMAIL,
  REGISTERED_ADDRESS,
  SUPPORT_PHONE,
};
