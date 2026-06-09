'use strict';

const nodemailer = require('nodemailer');

/**
 * Gmail SMTP transport.
 * Local Windows / corporate proxies may inject self-signed certs → TLS errors.
 * Production (Vercel) uses strict TLS; local dev relaxes unless GMAIL_TLS_STRICT=true.
 */
function createGmailTransport() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD not configured');
  }

  const useStrictTls =
    process.env.GMAIL_TLS_STRICT === 'true' ||
    !!process.env.VERCEL ||
    process.env.NODE_ENV === 'production';

  const config = {
    host:   'smtp.gmail.com',
    port:   465,
    secure: true,
    auth:   { user, pass },
  };

  if (!useStrictTls) {
    config.tls = { rejectUnauthorized: false };
    console.log('[gmail] TLS relaxed for local dev (set GMAIL_TLS_STRICT=true to enforce)');
  }

  return nodemailer.createTransport(config);
}

/** Verify SMTP credentials at startup (optional diagnostic) */
async function verifyGmailConnection() {
  const transport = createGmailTransport();
  await transport.verify();
  return true;
}

module.exports = { createGmailTransport, verifyGmailConnection };
