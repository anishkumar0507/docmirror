'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Single Vercel serverless function for the entire API.
//
// Vercel creates one serverless function per file in /api. To stay within the
// Hobby plan's function limit, ALL endpoints are served by the one Express app
// in ../server.js (the shared router). Individual route handlers live in
// ../routes/** and are mounted by server.js. vercel.json rewrites every request
// to this single function.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = require('../server.js');
