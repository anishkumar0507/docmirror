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
const cancelSubHandler            = require('./routes/cancel-subscription');
const webhookRazorpayHandler      = require('./routes/webhook-razorpay');
const generateReportHandler       = require('./routes/generate-report');
const renderPdfHandler            = require('./routes/render-pdf');
const sendReportEmailHandler      = require('./routes/send-report-email');
const reconcileHandler            = require('./routes/reconcile');

// ── Resources: Markdown-driven blog engine ──────────────────────────────────
const resourcesRoute              = require('./routes/resources');
const { buildSitemapXml }         = require('./lib/sitemap');
const { warmResources }           = require('./lib/resources');

// ── Admin CMS ───────────────────────────────────────────────────────────────
const { requireAuth }             = require('./lib/auth-middleware');
const { requireAdmin }            = require('./lib/admin-auth');
const adminMeHandler              = require('./routes/admin/me');
const adminStatsHandler           = require('./routes/admin/stats');
const adminOptionsHandler         = require('./routes/admin/options');
const adminPosts                  = require('./routes/admin/posts');
const adminMedia                  = require('./routes/admin/media');
const adminPreviewHandler         = require('./routes/admin/preview');
const adminImportHandler          = require('./routes/admin/import');

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
  '/doctor-visibility-score':       'doctor-visibility-score.html',
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

// ── Migrated guides → Resources blog engine ──────────────────────────────────
// The old hand-coded guide pages now live in the Markdown Resources system.
// 301-redirect the old clean URLs (and their legacy /pages/*.html) to the new
// /resources/<slug> URLs so links and search rankings carry over.
const GUIDE_REDIRECTS = {
  '/ai-visibility-for-doctors':     '/resources/ai-visibility-for-doctors',
  '/how-doctors-rank-in-chatgpt':   '/resources/how-doctors-rank-in-chatgpt',
  '/google-visibility-for-doctors': '/resources/google-visibility-guide',
};
for (const [oldPath, newPath] of Object.entries(GUIDE_REDIRECTS)) {
  app.get(oldPath,                              (_req, res) => res.redirect(301, newPath));
  app.get('/pages' + oldPath + '.html',         (_req, res) => res.redirect(301, newPath));
}

// ── Resources: Markdown blog engine ──────────────────────────────────────────
// Server-rendered from Markdown in /content/resources. Registered before
// express.static so /resources (listing) and /resources/:slug (article) are
// handled here. Deep static paths like /images/resources/* never match
// /resources/:slug (>1 segment) and fall through to express.static.
//
// warmResources loads the content source before the handler runs. The handlers
// and lib/sitemap.js read content synchronously while building HTML, so any
// source that needs I/O has to be ready first. With the Markdown source it
// calls next() straight through — no added latency, no behaviour change.
app.get('/resources',        warmResources, resourcesRoute.listingHandler);
app.get('/resources/:slug',  warmResources, resourcesRoute.articleHandler);
app.get('/pages/resources.html', (_req, res) => res.redirect(301, '/resources'));

// ── Sitemap ──────────────────────────────────────────────────────────────────
// Built by lib/sitemap.js, which is also what `npm run sitemap` writes to
// public/sitemap.xml. One builder, so the committed file and the URL Google
// fetches can never disagree. Registered before express.static, so this
// always wins over the file on disk — the served copy is never stale.
app.get('/sitemap.xml', warmResources, (_req, res) => {
  res.set('Content-Type', 'application/xml; charset=utf-8').send(buildSitemapXml());
});

// ── Admin CMS pages ──────────────────────────────────────────────────────────
// Served at clean URLs, before express.static, the same way the resources routes
// are. These files carry NO data and NO keys — every field on them is filled by
// an authenticated /api/admin/* call that answers 401/403 to a non-admin — so
// the HTML being publicly fetchable (exactly like /dashboard.html already is)
// discloses nothing. Both pages are noindex, and robots.txt disallows /admin.
// coming-soon.html is a gated placeholder so the dashboard's navigation leads
// somewhere real instead of falling through to the public catch-all. Each entry
// is repointed at its own page as that build step lands.
const ADMIN_PAGES = {
  '/admin':            'index.html',
  '/admin/login':      'login.html',
  '/admin/blogs/new':  'editor.html',
  '/admin/blogs':      'coming-soon.html',
  '/admin/media':      'coming-soon.html',
  '/admin/categories': 'coming-soon.html',
};
for (const [cleanPath, file] of Object.entries(ADMIN_PAGES)) {
  app.get(cleanPath, (_req, res) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.sendFile(path.join(__dirname, 'public', 'admin', file));
  });
}
// Editing an existing blog uses the same page; the editor reads the id from the
// URL and loads it through /api/admin/posts/:id.
app.get('/admin/blogs/:id/edit', (_req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.sendFile(path.join(__dirname, 'public', 'admin', 'editor.html'));
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
app.post('/api/cancel-subscription',          cancelSubHandler);        // stop auto-pay now, keep access until cycle end
app.post('/api/generate-report',              generateReportHandler);  // pipeline stage 1: insights
app.post('/api/render-pdf',                   renderPdfHandler);        // pipeline stage 2: pdf
app.post('/api/send-report-email',            sendReportEmailHandler);  // pipeline stage 3: email
app.get('/api/reconcile',                     reconcileHandler);        // safety-net (Vercel cron)
app.post('/api/reconcile',                    reconcileHandler);

// ── Admin CMS API ───────────────────────────────────────────────────────────
// One choke point for the whole admin surface: this app.use runs before EVERY
// /api/admin/* route regardless of method or path, so a route added later
// cannot forget its guard. requireAuth validates the Supabase session;
// requireAdmin re-reads profiles.role from the database on every request using
// the service-role client. Nothing about the role is taken from the browser.
app.use('/api/admin', requireAuth, requireAdmin);

app.get('/api/admin/me',      adminMeHandler);
app.get('/api/admin/stats',   adminStatsHandler);   // dashboard counts + recent posts
app.get('/api/admin/options', adminOptionsHandler); // categories, authors, timezones, limits

// blog_posts CRUD. The two literal paths are registered BEFORE '/:id' — Express
// matches in order, so otherwise "slug-check" would be read as an id.
app.get('/api/admin/posts/slug-check',      adminPosts.slugCheck);
app.get('/api/admin/posts/related-search',  adminPosts.relatedSearch);
app.get('/api/admin/posts/resolve-related', adminPosts.resolveRelated);
app.get('/api/admin/posts',                 adminPosts.list);
app.get('/api/admin/posts/:id',             adminPosts.get);
app.post('/api/admin/posts',                adminPosts.create);
app.patch('/api/admin/posts/:id',           adminPosts.update);
app.delete('/api/admin/posts/:id',          adminPosts.remove);   // permanent; live posts need ?confirm=live

// Media. The upload takes the raw image bytes rather than multipart, so no new
// dependency is needed; express.json() above ignores an image Content-Type, so
// the body arrives here untouched. The 6 MB cap leaves headroom over the
// bucket's 5 MB limit so an oversized file is rejected with a clear message
// instead of a truncated body.
app.get('/api/admin/media', adminMedia.list);
app.post('/api/admin/media/upload',
  express.raw({ type: adminMedia.ALLOWED_MIME, limit: '6mb' }),
  adminMedia.upload);

// Draft preview, rendered by the real public article renderer.
app.post('/api/admin/preview', adminPreviewHandler);

// Markdown import: parses a .md file into editor fields. Reads only — the
// author reviews what came back before anything is saved.
app.post('/api/admin/import/markdown', adminImportHandler);

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
