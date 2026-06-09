'use strict';

const crypto = require('crypto');

// ── One PDF generation job per user at a time ────────────────────────────────
// If the same user clicks "Download PDF" twice, the second request joins the
// in-flight job instead of spawning duplicate Claude calls.

/** @type {Map<string, Promise<unknown>>} */
const activeJobs = new Map();

/**
 * Build a stable key for deduplication.
 * Prefer email; fall back to doctor+city+client IP for guest downloads.
 */
function getJobKey(req, auditData = {}) {
  const email = (req.body?.email || auditData.email || '').trim().toLowerCase();
  if (email) return `email:${email}`;

  const auditId = req.body?.auditId || auditData.auditId || '';
  if (auditId) return `audit:${auditId}`;

  const ip = (
    req.headers['x-forwarded-for'] ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  ).toString().split(',')[0].trim();

  const sig = [
    auditData.doctorName || '',
    auditData.cityState || auditData.city || '',
    auditData.specialty || '',
    ip,
  ].join('|');

  return `guest:${crypto.createHash('sha256').update(sig).digest('hex').slice(0, 20)}`;
}

/**
 * Run fn once per user key. Concurrent duplicate requests share the same Promise.
 */
async function runOncePerUser(req, auditData, fn) {
  const key = getJobKey(req, auditData);

  if (activeJobs.has(key)) {
    console.log(`[pdf-job] dedup — joining in-flight job for ${key}`);
    return activeJobs.get(key);
  }

  console.log(`[pdf-job] start — ${key} | active_jobs=${activeJobs.size + 1}`);

  const job = Promise.resolve()
    .then(fn)
    .finally(() => {
      activeJobs.delete(key);
      console.log(`[pdf-job] finished — ${key} | active_jobs=${activeJobs.size}`);
    });

  activeJobs.set(key, job);
  return job;
}

function getActiveJobCount() {
  return activeJobs.size;
}

module.exports = { runOncePerUser, getJobKey, getActiveJobCount };
