'use strict';

const path = require('path');
const fs   = require('fs');
require('./lib/env');

const { verifyAuditCacheTable } = require('./lib/supabase-client');
const { discoverAuditCacheSchema } = require('./lib/audit-cache-schema');
const { verifyGmailConnection } = require('./lib/gmail');
const { verifyReportsBucket } = require('./routes/report');

const express = require('express');
const cors    = require('cors');

const auditModule             = require('./routes/audit');
const auditHandler            = auditModule;
const doctorAutocompleteHandler = require('./routes/doctors-autocomplete');
const monthlyContentHandler   = require('./routes/monthly-content');
const checkoutHandler         = require('./routes/checkout');
const verifyPaymentHandler    = require('./routes/verify-payment');
const paymentStatusHandler    = require('./routes/payment-status');
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
const userDashboardHandler     = require('./routes/user/dashboard');
const userHistoryHandler       = require('./routes/user/history');
const userNotificationsHandler = require('./routes/user/notifications');
const checkoutSubHandler          = require('./routes/checkout-subscription');
const verifySubPaymentHandler     = require('./routes/verify-subscription-payment');
const webhookRazorpayHandler      = require('./routes/webhook-razorpay');
const generateReportHandler       = require('./routes/generate-report');
const renderPdfHandler            = require('./routes/render-pdf');
const sendReportEmailHandler      = require('./routes/send-report-email');
const reconcileHandler            = require('./routes/reconcile');

// ── Resources: Markdown-driven blog engine ──────────────────────────────────
const resourcesRoute              = require('./routes/resources');
const { resourceSitemapEntries }  = require('./lib/resources');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Stripe webhook needs raw body — register before express.json()
app.post('/api/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

// Razorpay subscription webhook needs raw body too
app.post('/api/webhook-razorpay', express.raw({ type: 'application/json' }), webhookRazorpayHandler);

app.use(express.json({ limit: '2mb' }));

// ── SEO: canonical clean URLs ────────────────────────────────────────────────
// Each indexable content page is served at ONE canonical clean URL. The legacy
// /pages/*.html path 301-redirects to that clean URL so only a single version is
// crawlable (avoids duplicate-content / non-canonical warnings). Registered
// before express.static so the .html → clean redirect runs before the static
// file would be served. Page content/layout is unchanged — this is routing only.
const CLEAN_PAGES = {
  '/ai-visibility-for-doctors':     'ai-visibility-for-doctors.html',
  '/doctor-visibility-score':       'doctor-visibility-score.html',
  '/how-doctors-rank-in-chatgpt':   'how-doctors-rank-in-chatgpt.html',
  '/google-visibility-for-doctors': 'google-visibility-for-doctors.html',
  '/privacy':                       'privacy.html',
  '/terms':                         'terms.html',
  '/about':                         'about.html',
  '/pricing':                       'pricing.html',
  '/help-center':                   'help-center.html',
};
for (const [cleanPath, file] of Object.entries(CLEAN_PAGES)) {
  app.get(cleanPath,          (_req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', file)));
  app.get('/pages/' + file,   (_req, res) => res.redirect(301, cleanPath));
}

// ── Resources: Markdown blog engine ──────────────────────────────────────────
// Server-rendered from Markdown in /content/resources. Registered before
// express.static so /resources (listing) and /resources/:slug (article) are
// handled here. Deep static paths like /images/resources/* never match
// /resources/:slug (>1 segment) and fall through to express.static.
app.get('/resources',        resourcesRoute.listingHandler);
app.get('/resources/:slug',  resourcesRoute.articleHandler);
app.get('/pages/resources.html', (_req, res) => res.redirect(301, '/resources'));

// ── Sitemap ──────────────────────────────────────────────────────────────────
// Served dynamically so every Markdown resource is included automatically.
app.get('/sitemap.xml', (_req, res) => {
  let base;
  try {
    base = fs.readFileSync(path.join(__dirname, 'public', 'sitemap.xml'), 'utf8');
  } catch (_) {
    base = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>';
  }
  const blocks = resourceSitemapEntries().map(e =>
    '  <url>\n' +
    `    <loc>${e.loc}</loc>\n` +
    (e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>\n` : '') +
    `    <changefreq>${e.changefreq}</changefreq>\n` +
    `    <priority>${e.priority}</priority>\n` +
    '  </url>'
  ).join('\n');
  const xml = blocks ? base.replace('</urlset>', blocks + '\n</urlset>') : base;
  res.set('Content-Type', 'application/xml; charset=utf-8').send(xml);
});

// ── Static site ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ─────────────────────────────────────────────────────────────
app.post('/api/audit',                    auditHandler);
app.get('/api/doctors/autocomplete',      doctorAutocompleteHandler);
app.get('/api/monthly-content',           monthlyContentHandler);
app.post('/api/checkout',                 checkoutHandler);
app.post('/api/verify-payment',           verifyPaymentHandler);
app.get('/api/payment-status',            paymentStatusHandler);   // backend-verified paid status (no URL/localStorage trust)
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
app.get('/api/dashboard',                 userDashboardHandler);    // aggregated Monitor dashboard
app.get('/api/history',                   userHistoryHandler);      // week-over-week trend series
app.get('/api/notifications',             userNotificationsHandler);
app.post('/api/notifications',            userNotificationsHandler); // mark read
app.get('/api/weekly-update',             weeklyCheckHandler);      // alias for the weekly cron
app.post('/api/weekly-update',            weeklyCheckHandler);
app.post('/api/checkout-subscription',        checkoutSubHandler);
app.post('/api/verify-subscription-payment', verifySubPaymentHandler);
app.post('/api/generate-report',              generateReportHandler);  // pipeline stage 1: insights
app.post('/api/render-pdf',                   renderPdfHandler);        // pipeline stage 2: pdf
app.post('/api/send-report-email',            sendReportEmailHandler);  // pipeline stage 3: email
app.get('/api/reconcile',                     reconcileHandler);        // safety-net (Vercel cron)
app.post('/api/reconcile',                    reconcileHandler);

app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Browsers auto-request /favicon.ico — serve the brand SVG instead of falling
// through to the catch-all (which would return index.html / a stale icon).
app.get('/favicon.ico', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.svg'));
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
