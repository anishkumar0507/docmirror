'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Private delivery for report-credit PDFs.
//
// The EXISTING report pipeline (routes/report.js runPdfStage) uploads every
// generated PDF into the PUBLIC "reports" bucket, unchanged — that is shared
// with the anonymous scan-first flow and subscriber reports, and is out of
// scope to change here.
//
// For a report bought with a credit, we additionally copy the PDF into a
// SEPARATE, PRIVATE bucket ("report-pdfs-private") the first time it is
// downloaded, and hand out only a short-lived signed URL from there — never the
// public one. This is lazy (copy-on-first-download) so nothing here needs to
// hook into the pipeline's internal stages; it just needs the PDF to already
// exist in the public bucket, which runPdfStage guarantees before responding.
//
// NOTE: the file also still exists at its original public (unguessable-path)
// URL in the "reports" bucket — this module does not delete or move it, only
// adds a genuinely access-controlled copy. Deleting the public original would
// touch the shared pipeline's own bookkeeping (reports.pdf_url) and is out of
// scope here.
// ─────────────────────────────────────────────────────────────────────────────

const PRIVATE_BUCKET = 'report-pdfs-private';
const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes

let _verified = null;

/** Confirms the private bucket exists. Logged once; never auto-creates it —
 *  same "tell the operator, don't provision infrastructure from app code"
 *  convention routes/report.js's verifyReportsBucket follows. */
async function verifyPrivateBucket(supabase) {
  if (_verified !== null) return _verified;
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) { console.error('[report-storage-private] listBuckets failed:', error.message); return (_verified = false); }
    const found = (buckets || []).some((b) => b.name === PRIVATE_BUCKET);
    if (!found) {
      console.error(
        `[report-storage-private] bucket "${PRIVATE_BUCKET}" NOT FOUND. ` +
        `Create it in Supabase → Storage → New bucket → name: ${PRIVATE_BUCKET} → Public: FALSE.`
      );
      return (_verified = false);
    }
    _verified = true;
    return true;
  } catch (e) {
    console.error('[report-storage-private] verify exception:', e.message);
    return (_verified = false);
  }
}

/**
 * Ensures a private copy of auditId's PDF exists, then returns a short-lived
 * signed URL for it. Returns null if the public PDF doesn't exist yet, the
 * private bucket is missing, or the copy/sign step fails — callers should show
 * "not ready yet, try again shortly" rather than a broken link.
 */
async function getSignedDownloadUrl(supabase, auditId) {
  if (!(await verifyPrivateBucket(supabase))) return null;

  const path = `${auditId}.pdf`;

  // Already copied? Signing doesn't require re-uploading.
  const { data: existing } = await supabase.storage.from(PRIVATE_BUCKET).list('', { search: `${auditId}.pdf` });
  const alreadyThere = (existing || []).some((f) => f.name === `${auditId}.pdf`);

  if (!alreadyThere) {
    const { downloadPdfBuffer } = require('../routes/report');
    const bytes = await downloadPdfBuffer(supabase, auditId);
    if (!bytes) {
      console.warn(`[report-storage-private] no public PDF yet for auditId=${auditId} — not ready`);
      return null;
    }
    const { error: upErr } = await supabase.storage
      .from(PRIVATE_BUCKET)
      .upload(path, bytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) {
      console.error(`[report-storage-private] copy-in FAILED auditId=${auditId}: ${upErr.message}`);
      return null;
    }
    console.log(`[report-storage-private] copied public → private auditId=${auditId}`);
  }

  const { data, error } = await supabase.storage.from(PRIVATE_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    console.error(`[report-storage-private] createSignedUrl FAILED auditId=${auditId}: ${error && error.message}`);
    return null;
  }
  return data.signedUrl;
}

module.exports = { getSignedDownloadUrl, PRIVATE_BUCKET, SIGNED_URL_TTL_SECONDS };
