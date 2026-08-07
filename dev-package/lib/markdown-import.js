'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — Markdown → CMS import

   Turns a .md file into the fields the blog editor holds, so an article that
   is already written can be dropped in rather than retyped.

   This is PARSING, not interpretation. Nothing is invented: every value comes
   from something the file actually says. A field the file does not contain is
   returned empty and reported as empty, for the author to fill in or leave.
   No AI, no network, no cost — the same gray-matter/marked pair that already
   serves the live Markdown articles.

   It reads the exact frontmatter vocabulary lib/resources-markdown.js accepts,
   aliases included, so a file that works in content/resources/ imports here
   with identical results.

   Deliberately does NOT write to the database. The route returns these fields,
   the editor fills its form, and the author reviews before saving — an import
   should never publish something nobody has looked at.
   ────────────────────────────────────────────────────────────────────────── */

const matter = require('gray-matter');
const { slugify } = require('./resources-markdown');
const { autoExcerpt, stripMarkdown, readingTimeMinutes, renderMarkdown } = require('./blog-post-mapper');

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_RELATED = 6;

// Headings that mean "the FAQ starts here" when the questions live in the body
// rather than in frontmatter.
const FAQ_HEADING_RE = /^(faq|faqs|frequently asked questions?|common questions?|questions? and answers?)\b/i;

/* ── recovering from the one YAML mistake everybody makes ──────────────────
   `title: AEO vs SEO vs GEO: What Every Doctor Needs to Know` is not valid
   YAML — the second colon reads as the start of a nested mapping, and the whole
   frontmatter block fails to parse. It is by far the most common way a
   hand-written .md file breaks here, because a colon in a headline is normal
   English and nothing about it looks wrong.

   So when parsing fails, the frontmatter is retried with unquoted values that
   contain a colon wrapped in quotes. This runs ONLY after a genuine failure, so
   a valid file is never touched, and the author is told their file has a YAML
   problem worth fixing at the source. */

/** Quotes `key: value` lines whose value contains a colon and is not already quoted. */
function quoteRiskyScalars(frontmatter) {
  return frontmatter.split('\n').map((line) => {
    const m = line.match(/^(\s*(?:-\s+)?)([A-Za-z0-9_][A-Za-z0-9_ -]*):[ \t]+(.+?)[ \t]*$/);
    if (!m) return line;

    const prefix = m[1];
    const key = m[2];
    const value = m[3];

    if (!/:\s/.test(value)) return line;              // no inner colon — already fine
    if (/^["'[{|>&*!#]/.test(value)) return line;     // quoted, a list, or a block scalar

    return `${prefix}${key}: "${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }).join('\n');
}

// Passing an options object makes gray-matter skip its module-level cache.
// That matters twice over: the cache is keyed by the whole file and grows
// without bound in a long-lived server, and it made repeated parses of the same
// text return different answers depending on what had been parsed before —
// which is no way to decide whether someone's file is valid.
const MATTER_OPTS = { language: 'yaml' };

/**
 * matter(), with one retry that repairs unquoted colons.
 * Returns { parsed, repaired } — `repaired` is true when the retry was needed.
 */
function parseFrontmatter(raw) {
  try {
    return { parsed: matter(raw, MATTER_OPTS), repaired: false };
  } catch (firstError) {
    const m = String(raw).match(/^(﻿?---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)/);
    if (!m) throw firstError;

    const repairedBody = quoteRiskyScalars(m[2]);
    if (repairedBody === m[2]) throw firstError;       // nothing to fix — this is a different problem

    const repairedRaw = m[1] + repairedBody + m[3] + String(raw).slice(m[0].length);
    try {
      return { parsed: matter(repairedRaw, MATTER_OPTS), repaired: true };
    } catch (_) {
      throw firstError;                                // report the original, clearer message
    }
  }
}

/** Only site-relative paths and real web URLs survive; anything else is dropped. */
function safeUrl(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return '';
  if (/^(javascript|vbscript|data|file):/i.test(v)) return '';
  if (/^https?:\/\//i.test(v) || v.startsWith('/')) return v;
  return '';
}

function toArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (value == null || value === '') return [];
  return String(value).split(',').map((v) => v.trim()).filter(Boolean);
}

/** Frontmatter faq:, accepting the question/q and answer/a spellings. */
function faqFromFrontmatter(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      question: String((item && (item.question || item.q)) || '').trim(),
      answer:   String((item && (item.answer   || item.a)) || '').trim(),
    }))
    .filter((f) => f.question && f.answer);
}

/**
 * Recognises a line as the start of a question, in any of the shapes people
 * actually write FAQs in. Returns the question text, or null.
 *
 *   ### What is AEO?          a heading deeper than the FAQ heading
 *   **What is AEO?**          a bold line on its own, ending in a question mark
 *   Q: What is AEO?           Q-prefixed, with or without bold
 *   **Q. What is AEO?**
 *
 * Only these four; anything else in the section is treated as answer text.
 */
function questionFromLine(line, sectionLevel) {
  const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
  if (heading && heading[1].length > sectionLevel) return heading[2].trim();

  const qPrefixed = line.match(/^\s*(?:\*\*|__)?\s*Q\s*[:.]\s*(.+?)\s*(?:\*\*|__)?\s*$/i);
  if (qPrefixed && qPrefixed[1].trim()) return qPrefixed[1].replace(/(\*\*|__)\s*$/, '').trim();

  // A whole line in bold that asks something. The question mark is what keeps
  // an emphasised sentence inside an answer from being read as a new question.
  const boldOnly = line.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/);
  if (boldOnly && /\?\s*$/.test(boldOnly[1])) return boldOnly[1].trim();

  return null;
}

/** Drops a leading "A:" / "A." from an answer, bold or not. */
function stripAnswerPrefix(text) {
  return String(text).replace(/^\s*(?:\*\*|__)?\s*A\s*[:.]\s*/i, '');
}

/**
 * Finds an FAQ written as a body section — an "## FAQ" heading followed by
 * question/answer pairs in any of the shapes questionFromLine recognises.
 *
 * Returns the questions AND the line range they occupy, because the section has
 * to be removed from the body: the article template renders the FAQ as its own
 * accordion, so leaving it in the prose would print every question twice.
 */
function faqFromBody(body) {
  const lines = body.split('\n');

  // H2 to H4 only. An "# FAQ" is deliberately not recognised: at H1 the section
  // runs until the next H1, so every ordinary "## Section" after it would be
  // swallowed and read as a question. H1 is the article title's level anyway —
  // a file that writes "# FAQ" should write "## FAQ".
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{2,4})\s+(.+?)\s*$/);
    if (m && FAQ_HEADING_RE.test(m[2].replace(/[:\-—(]\s*.*$/, '').trim())) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  if (start === -1) return null;

  // The section ends at the next heading of the same or higher rank — but a
  // heading that is itself a question belongs to the FAQ, not after it.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= level) { end = i; break; }
  }

  const faq = [];
  let current = null;
  for (let i = start + 1; i < end; i++) {
    const q = questionFromLine(lines[i], level);
    if (q) {
      if (current && current.answer.trim()) faq.push(current);
      current = { question: q, answer: '' };
    } else if (current) {
      const text = current.answer ? lines[i] : stripAnswerPrefix(lines[i]);
      current.answer += (current.answer ? '\n' : '') + text;
    }
  }
  if (current && current.answer.trim()) faq.push(current);

  // The public FAQ accordion escapes its answers, so Markdown inside one would
  // show as literal asterisks. Flatten to the plain prose the template expects.
  const cleaned = faq
    .map((f) => ({ question: f.question, answer: stripMarkdown(f.answer) }))
    .filter((f) => f.question && f.answer);

  if (!cleaned.length) return null;
  return { faq: cleaned, start, end };
}

/** Internal links already written in the article become the related list. */
function relatedFromBody(body, selfSlug) {
  const found = [];
  const re = /\]\(\s*(?:https?:\/\/(?:www\.)?thedocmirror\.com)?\/resources\/([a-z0-9-]+)\s*[)#]/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    const slug = slugify(m[1]);
    if (!slug || slug === selfSlug) continue;
    if (!found.includes(slug)) found.push(slug);
    if (found.length >= MAX_RELATED) break;
  }
  return found;
}

/**
 * "2026-08-05" / a Date / an ISO string → { date: 'YYYY-MM-DD', time: 'HH:MM' }
 *
 * YAML parses a bare `date: 2026-08-05` into a Date, so the original string is
 * gone by the time this sees it and "is there a clock in this value" cannot be
 * answered by looking at the text. Midnight UTC is therefore read as date-only,
 * which is what every frontmatter date in this project is. The cost is that a
 * time deliberately set to exactly 00:00 UTC comes through blank — the author
 * sees the empty Publish Time field before saving.
 */
function splitDate(raw) {
  if (!raw) return { date: '', time: '' };

  const asText = String(raw).trim();
  const dateOnlyText = /^\d{4}-\d{2}-\d{2}$/.test(asText);

  const d = raw instanceof Date ? raw : new Date(asText);
  if (isNaN(d.getTime())) return { date: '', time: '' };

  const midnightUtc = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  const iso = d.toISOString();

  return {
    date: iso.slice(0, 10),
    time: (dateOnlyText || midnightUtc) ? '' : iso.slice(11, 16),
  };
}

/**
 * The one public entry point.
 *
 * `opts.filename` matters more than it looks: when a file carries no `slug:`,
 * lib/resources-markdown.js derives the URL from the FILENAME, not the title.
 * Importing "aeo-for-doctors.md" therefore has to produce /resources/aeo-for-doctors,
 * not /resources/what-is-aeo-answer-engine-optimization-for-doctors. Only the
 * caller knows the filename, so it is passed in; pasted text falls back to the
 * title, and the author is told when that happens.
 *
 * Returns { fields, contentHtml, filled, empty, notes }.
 */
function parseMarkdownImport(raw, opts) {
  const filename = String((opts && opts.filename) || '').trim();
  const notes = [];

  const { parsed, repaired } = parseFrontmatter(String(raw || ''));
  const data = parsed.data || {};
  let body = String(parsed.content || '').replace(/^\n+/, '');

  if (repaired) {
    notes.push(
      'The frontmatter had a value containing a colon that was not quoted — a title like ' +
      '"AEO vs SEO: what changed" breaks YAML. It was read anyway, but wrap such values in ' +
      'double quotes in the file so it parses cleanly next time.'
    );
  }

  if (!Object.keys(data).length) {
    notes.push('No frontmatter found — the title was taken from the first heading and the rest is left for you to fill in.');
  }

  // ── title ───────────────────────────────────────────────────────────────
  let title = String(data.title || '').trim();
  if (!title) {
    const h1 = body.match(/^#\s+(.+?)\s*$/m);
    if (h1) {
      title = h1[1].trim();
      // The article template prints the title as the page's own H1, so the
      // duplicate in the prose is removed rather than shown twice.
      body = body.replace(h1[0], '').replace(/^\n+/, '');
      notes.push(`Title taken from the first heading, and that heading removed from the body so it does not appear twice.`);
    }
  }

  // ── faq ─────────────────────────────────────────────────────────────────
  let faq = faqFromFrontmatter(data.faq);
  if (faq.length) {
    notes.push(`${faq.length} FAQ ${faq.length === 1 ? 'question' : 'questions'} read from the frontmatter.`);
  } else {
    const fromBody = faqFromBody(body);
    if (fromBody) {
      faq = fromBody.faq;
      const lines = body.split('\n');
      body = lines.slice(0, fromBody.start).concat(lines.slice(fromBody.end)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
      notes.push(
        `${faq.length} FAQ ${faq.length === 1 ? 'question' : 'questions'} found in the body and moved into the FAQ editor — ` +
        'that section was removed from the article so the page does not show it twice.'
      );
    }
  }

  // ── slug ────────────────────────────────────────────────────────────────
  // Same precedence the live Markdown engine uses: an explicit slug, otherwise
  // the filename, and only then the title.
  const fromFile = filename ? slugify(filename.replace(/\.(md|markdown|txt)$/i, '')) : '';
  let slug = slugify(String(data.slug || '').trim()) || fromFile || slugify(title);

  if (slug && !SLUG_RE.test(slug)) {
    notes.push('The slug could not be used as a URL and was left blank.');
    slug = '';
  } else if (!data.slug && !fromFile && slug) {
    notes.push(`No slug in the file and no filename, so the URL was built from the title: /resources/${slug} — change it if that is not what you want.`);
  }

  // ── the rest ────────────────────────────────────────────────────────────
  const excerpt = String(data.description || data.excerpt || '').trim();
  const image = safeUrl(data.image || data.featuredImage);
  if ((data.image || data.featuredImage) && !image) {
    notes.push('The featured image path was not a usable URL and was skipped — choose one from the media library.');
  }

  const explicitRead = parseInt(String(data.readTime || data.readingTime || '').match(/\d+/) || 0, 10);
  const when = splitDate(data.date);
  const related = relatedFromBody(body, slug);
  if (related.length) {
    notes.push(`${related.length} related ${related.length === 1 ? 'article' : 'articles'} picked up from links inside the text.`);
  }

  const fields = {
    title,
    slug,
    excerpt: excerpt || autoExcerpt(body),
    content_md: body.trim(),
    author: String(data.author || '').trim(),
    category: String(data.category || '').trim(),
    tags: toArray(data.tags),
    featured_image: image,
    image_alt: String(data.imageAlt || data.image_alt || '').trim(),
    seo_title: String(data.seoTitle || data.seo_title || '').trim(),
    meta_description: String(data.metaDescription || data.meta_description || '').trim(),
    read_time_minutes: explicitRead > 0 ? explicitRead : readingTimeMinutes(body),
    faq,
    related_slugs: related,
    publish_date: when.date,
    publish_time: when.time,
  };

  if (!excerpt && fields.excerpt) {
    notes.push('No description in the frontmatter, so the excerpt was taken from the opening of the article.');
  }

  // What the author still has to decide. Reported rather than guessed — this
  // importer never invents a category, a tag or a meta description.
  const REPORTABLE = [
    ['title', 'Title'], ['slug', 'Slug'], ['category', 'Category'], ['tags', 'Tags'],
    ['author', 'Author'], ['featured_image', 'Featured Image'], ['image_alt', 'Featured Image ALT'],
    ['seo_title', 'SEO Title'], ['meta_description', 'Meta Description'], ['excerpt', 'Excerpt'],
    ['faq', 'FAQ'], ['related_slugs', 'Related in this series'],
  ];
  const filled = [];
  const empty = [];
  for (const [key, label] of REPORTABLE) {
    const v = fields[key];
    const has = Array.isArray(v) ? v.length > 0 : String(v || '').trim() !== '';
    (has ? filled : empty).push(label);
  }

  return {
    fields,
    contentHtml: renderMarkdown(fields.content_md),
    filled,
    empty,
    notes,
  };
}

module.exports = {
  parseMarkdownImport,
  parseFrontmatter,
  quoteRiskyScalars,
  faqFromBody,
  questionFromLine,
  relatedFromBody,
  splitDate,
  MAX_RELATED,
};
