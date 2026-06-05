'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'config/.env.local') });

const express      = require('express');
const cors         = require('cors');
const auditHandler = require('./api/audit');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── Static frontend ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'frontend')));

// ── API routes ─────────────────────────────────────────────────────────────
app.post('/api/audit', auditHandler);

// ── Catch-all: serve index.html for any unmatched route ───────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  The Doc Mirror`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  API_READY=${process.env.API_READY || 'not set'}`);
  console.log(`  Places key: ${process.env.GOOGLE_PLACES_API_KEY ? '✓ loaded' : '✗ MISSING'}\n`);
});
