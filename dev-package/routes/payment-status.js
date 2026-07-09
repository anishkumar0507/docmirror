'use strict';

require('../lib/env');

const paidReports = require('../lib/paid-reports');
const auditCache  = require('../lib/audit-cache');

// ── GET /api/payment-status?reportId=tdm_xxx ─────────────────────────────────
// The ONLY source of truth for whether a report is paid. The preview page calls
// this before unlocking paid sections — URL params (?paid / ?demo) and any
// localStorage flag are never trusted.
//
// "Paid" means a Razorpay payment was signature-verified server-side. That is
// exactly the set of statuses written only AFTER verification:
//   verify-payment.js / webhook payment.captured / reconcile → 'generating' → … → 'delivered'
// A 'pending' row (created at checkout, before payment) or 'failed' row is NOT paid.
const PAID_STATUSES = new Set(['generating', 'generated', 'delivered']);

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const reportId = String(req.query?.reportId || req.query?.auditId || '').trim();
  if (!reportId) {
    return res.status(400).json({ paid: false, error: 'reportId required' });
  }
  if (!auditCache.isValidAuditId(reportId)) {
    return res.json({ paid: false, reportId, status: 'invalid' });
  }

  try {
    const row = await paidReports.get(reportId);
    const paid = !!row && (!!row.delivered_at || PAID_STATUSES.has(row.status));
    return res.json({ paid, reportId, status: row?.status || 'not_found' });
  } catch (err) {
    console.error('[payment-status] error:', err.message);
    // Fail CLOSED — never unlock on an error.
    return res.status(500).json({ paid: false, reportId, error: 'status_check_failed' });
  }
}

module.exports = handler;
