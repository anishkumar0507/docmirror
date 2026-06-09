'use strict';

const path = require('path');

// On Vercel, env vars are injected — only load .env.local for local dev.
if (!process.env.VERCEL) {
  require('dotenv').config({ path: path.join(__dirname, '../config/.env.local') });
}
