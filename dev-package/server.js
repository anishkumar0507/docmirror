'use strict';

const path = require('path');
require('./lib/env');

const express      = require('express');
const cors         = require('cors');

const auditModule             = require('./api/audit');
const auditHandler            = auditModule;
const debugCompetitorsHandler = auditModule.debugCompetitorsHandler;
const checkoutHandler         = require('./api/checkout');
const verifyPaymentHandler    = require('./api/verify-payment');
const reportHandler           = require('./api/report');
const downloadPdfHandler      = require('./api/download-pdf');
const emailCaptureHandler     = require('./api/email-capture');
const waitlistHandler         = require('./api/waitlist');
const weeklyCheckHandler      = require('./api/weekly-check');
const authLoginHandler        = require('./api/auth/login');
const stripeWebhookHandler    = require('./api/webhook');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Stripe webhook needs raw body — register before express.json()
app.post('/api/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

app.use(express.json({ limit: '2mb' }));

// ── Static site ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ─────────────────────────────────────────────────────────────
app.get('/api/debug-competitors', debugCompetitorsHandler);
app.post('/api/audit',            auditHandler);
app.post('/api/checkout',         checkoutHandler);
app.post('/api/verify-payment',   verifyPaymentHandler);
app.post('/api/download-pdf',     downloadPdfHandler);
app.post('/api/report',           reportHandler);
app.post('/api/email-capture',    emailCaptureHandler);
app.post('/api/waitlist',         waitlistHandler);
app.get('/api/weekly-check',      weeklyCheckHandler);
app.post('/api/weekly-check',     weeklyCheckHandler);
app.post('/api/auth/login',       authLoginHandler);

app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export for Vercel serverless
module.exports = app;

// Local dev server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  The Doc Mirror`);
    console.log(`  http://localhost:${PORT}\n`);
    console.log(`  Places key  : ${process.env.GOOGLE_PLACES_API_KEY    ? '✓' : '✗ MISSING'}`);
    console.log(`  Anthropic   : ${process.env.ANTHROPIC_API_KEY        ? '✓' : '✗ MISSING'}`);
    console.log(`  Razorpay    : ${process.env.RAZORPAY_KEY_ID          ? '✓' : '✗ MISSING'}`);
    console.log(`  Gmail       : ${process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD ? '✓' : '✗ MISSING'}`);
    console.log(`  Supabase    : ${process.env.NEXT_PUBLIC_SUPABASE_URL ? '✓' : '✗ MISSING'}\n`);
  });
}
