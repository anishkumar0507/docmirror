'use strict';

const path = require('path');
require('./lib/env');

const { verifyAuditCacheTable } = require('./lib/supabase-client');
const { discoverAuditCacheSchema } = require('./lib/audit-cache-schema');
const { verifyGmailConnection } = require('./lib/gmail');
const { verifyReportsBucket } = require('./routes/report');

const express = require('express');
const cors    = require('cors');

const auditModule             = require('./routes/audit');
const auditHandler            = auditModule;
const checkoutHandler         = require('./routes/checkout');
const verifyPaymentHandler    = require('./routes/verify-payment');
const reportHandler           = require('./routes/report');
const downloadPdfHandler      = require('./routes/download-pdf');
const emailCaptureHandler     = require('./routes/email-capture');
const waitlistHandler         = require('./routes/waitlist');
const weeklyCheckHandler      = require('./routes/weekly-check');
const authLoginHandler        = require('./routes/auth/login');
const stripeWebhookHandler    = require('./routes/webhook');

// ── Multi-tier SaaS additions ──────────────────────────────────────────────
const clientConfigHandler      = require('./routes/config');
const userMeHandler            = require('./routes/user/me');
const userReportsHandler       = require('./routes/user/reports');
const userAlertsHandler        = require('./routes/user/alerts');
const checkoutSubHandler          = require('./routes/checkout-subscription');
const verifySubPaymentHandler     = require('./routes/verify-subscription-payment');
const webhookRazorpayHandler      = require('./routes/webhook-razorpay');
const generateReportHandler       = require('./routes/generate-report');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Stripe webhook needs raw body — register before express.json()
app.post('/api/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

// Razorpay subscription webhook needs raw body too
app.post('/api/webhook-razorpay', express.raw({ type: 'application/json' }), webhookRazorpayHandler);

app.use(express.json({ limit: '2mb' }));

// ── Static site ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ─────────────────────────────────────────────────────────────
app.post('/api/audit',                    auditHandler);
app.post('/api/checkout',                 checkoutHandler);
app.post('/api/verify-payment',           verifyPaymentHandler);
app.post('/api/download-pdf',             downloadPdfHandler);
app.post('/api/report',                   reportHandler);
app.post('/api/email-capture',            emailCaptureHandler);
app.post('/api/waitlist',                 waitlistHandler);
app.get('/api/weekly-check',              weeklyCheckHandler);
app.post('/api/weekly-check',             weeklyCheckHandler);
app.post('/api/auth/login',               authLoginHandler);

// ── Multi-tier SaaS routes ─────────────────────────────────────────────────
app.get('/api/client-config',             clientConfigHandler);
app.get('/api/user/me',                   userMeHandler);
app.get('/api/user/reports',              userReportsHandler);
app.get('/api/user/alerts',               userAlertsHandler);
app.post('/api/checkout-subscription',        checkoutSubHandler);
app.post('/api/verify-subscription-payment', verifySubPaymentHandler);
app.post('/api/generate-report',              generateReportHandler);

app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Startup health checks (non-blocking — do not prevent server from serving) ──
// These run after the server is listening and log actionable errors if misconfigured.

async function runStartupChecks() {
  // 1. Supabase audit_cache schema (detects PGRST204 root cause)
  discoverAuditCacheSchema().catch(err => {
    console.error('[startup] audit_cache schema probe error:', err.message);
  });

  // 2. Supabase audit_cache table accessibility
  const tableCheck = await verifyAuditCacheTable().catch(err => {
    console.error('[startup] audit_cache check error:', err.message);
    return { ok: false, message: err.message };
  });
  if (!tableCheck.ok) {
    console.error(
      '[startup] ✗ audit_cache unreachable — checkout will fail. ' +
      'Run migration 002_audit_cache_audit_data.sql and ensure SUPABASE_SERVICE_ROLE_KEY is set.'
    );
  }

  // 3. Supabase Storage bucket "reports"
  const { getSupabaseClient } = require('./lib/supabase-client');
  const supabase = getSupabaseClient();
  if (supabase) {
    verifyReportsBucket(supabase).catch(err => {
      console.error('[startup] storage bucket check error:', err.message);
    });
  } else {
    console.warn('[startup] Supabase not configured — storage bucket check skipped');
  }

  // 4. Gmail SMTP credentials
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    verifyGmailConnection()
      .then(() => {
        console.log(`[startup] Gmail SMTP ✓  user=${process.env.GMAIL_USER}`);
      })
      .catch(err => {
        console.error(
          `[startup] Gmail SMTP ✗  user=${process.env.GMAIL_USER}  error=${err.message}`
        );
        console.error(
          '[startup] Fix: ensure GMAIL_APP_PASSWORD is a valid Google App Password ' +
          '(myaccount.google.com/apppasswords). Regenerate if in doubt.'
        );
      });
  } else {
    console.error(
      '[startup] Gmail SMTP ✗  GMAIL_USER or GMAIL_APP_PASSWORD missing — ' +
      'PDF delivery will fail for every paid order'
    );
  }
}

// Export for Vercel serverless
module.exports = app;

// Local dev server
if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`\n  The Doc Mirror`);
    console.log(`  http://localhost:${PORT}\n`);
    console.log(`  Places key  : ${process.env.GOOGLE_PLACES_API_KEY    ? '✓' : '✗ MISSING'}`);
    console.log(`  Anthropic   : ${process.env.ANTHROPIC_API_KEY        ? '✓' : '✗ MISSING'}`);
    console.log(`  Razorpay    : ${process.env.RAZORPAY_KEY_ID          ? '✓' : '✗ MISSING'}`);
    console.log(`  Gmail       : ${process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD ? '✓' : '✗ MISSING'}`);
    console.log(`  Supabase    : ${process.env.NEXT_PUBLIC_SUPABASE_URL ? '✓' : '✗ MISSING'}`);
    console.log('');

    await runStartupChecks();
  });
} else {
  // Vercel cold start — run checks in background (non-blocking)
  runStartupChecks().catch(err => {
    console.error('[startup] checks failed:', err.message);
  });
}
