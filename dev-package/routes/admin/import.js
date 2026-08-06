'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   POST /api/admin/import/markdown

   Takes the text of a .md file and returns the editor's fields filled in from
   it. Behind requireAuth + requireAdmin via the /api/admin mount.

   Reads only. Nothing is written, nothing is published: the editor fills its
   form from the response and the author reviews before saving, so an import
   can never put an unread article on the site.
   ────────────────────────────────────────────────────────────────────────── */

require('../../lib/env');
const { parseMarkdownImport } = require('../../lib/markdown-import');

// A generous ceiling — the longest live article is about 17 KB — that still
// stops a stray large file from being parsed.
const MAX_BYTES = 512 * 1024;

function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const raw = String((req.body && req.body.markdown) || '');
  if (!raw.trim()) {
    return res.status(400).json({ error: 'No Markdown received. Choose a .md file or paste its contents.' });
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) {
    return res.status(413).json({
      error: `That file is larger than ${Math.round(MAX_BYTES / 1024)} KB. Split it, or paste just the article.`,
    });
  }

  // The filename decides the URL when the file has no `slug:` — the same rule
  // the live Markdown engine follows — so it is sent alongside the text.
  const filename = String((req.body && req.body.filename) || '').replace(/[\\/]/g, '').slice(0, 200);

  let result;
  try {
    result = parseMarkdownImport(raw, { filename });
  } catch (err) {
    // Malformed YAML frontmatter is the usual cause, and gray-matter's message
    // names the line, so it is worth passing on to the person who wrote it.
    console.warn(`[admin/import] parse failed for ${req.admin.email}: ${err.message}`);
    return res.status(422).json({
      error: 'Could not read that Markdown file: ' + err.message,
      hint: 'Check the frontmatter block at the top — the --- fences and the YAML indentation.',
    });
  }

  if (!result.fields.title) {
    return res.status(422).json({
      error: 'No title found. Add `title:` to the frontmatter, or start the file with a "# Heading" line.',
    });
  }

  console.log(
    `[admin/import] parsed "${result.fields.title}" by ${req.admin.email} — ` +
    `filled=${result.filled.length} empty=${result.empty.length} faq=${result.fields.faq.length} ` +
    `related=${result.fields.related_slugs.length}`
  );

  return res.json(result);
}

module.exports = handler;
module.exports.MAX_BYTES = MAX_BYTES;
