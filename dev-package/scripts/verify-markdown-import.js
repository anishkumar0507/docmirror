#!/usr/bin/env node
'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — Markdown import verification

   The best fixtures for this importer are the articles that are already live:
   every one of them is run through it and compared against what the Markdown
   engine produces for the same file. If the two ever disagree, importing an
   article into the CMS would change it.

   Also covers the shapes a hand-written file arrives in: no frontmatter, an
   FAQ written as a body section, a missing title, broken YAML.

   Usage:  npm run verify-import
   ────────────────────────────────────────────────────────────────────────── */

const fs = require('fs');
const path = require('path');

const { parseMarkdownImport } = require('../lib/markdown-import');
const markdown = require('../lib/resources-markdown');

const DIR = path.join(__dirname, '..', 'content', 'resources');

let passed = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failures.push(label + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}
const group = (t) => console.log(`\n${t}`);

// ── 1. Every live article imports identically ───────────────────────────────

function checkLiveArticles() {
  group('1. Every live article imports exactly as the site already reads it');

  const files = fs.readdirSync(DIR).filter((f) =>
    /\.md$/i.test(f) && f.toLowerCase() !== 'readme.md' && !f.startsWith('_') && !f.startsWith('.'));

  let allTitles = true, allSlugs = true, allCats = true, allTags = true;
  let allFaq = true, allSeo = true, allImages = true, allExcerpts = true;
  let totalFaq = 0, totalRelated = 0, firstBad = '';

  for (const file of files) {
    const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
    // The filename is passed exactly as the editor passes it, because it is
    // what decides the URL for a file with no explicit slug.
    const r = parseMarkdownImport(raw, { filename: file });
    const live = markdown.getResourceBySlug(markdown.slugify(file));
    if (!live) continue;

    const f = r.fields;
    if (f.title !== live.title) { allTitles = false; firstBad = firstBad || `${file}: title`; }
    if (f.slug !== live.slug) { allSlugs = false; firstBad = firstBad || `${file}: slug "${f.slug}" vs "${live.slug}"`; }
    if (f.category !== live.category) { allCats = false; firstBad = firstBad || `${file}: category`; }
    if (JSON.stringify(f.tags) !== JSON.stringify(live.tags)) { allTags = false; firstBad = firstBad || `${file}: tags`; }
    if (JSON.stringify(f.faq) !== JSON.stringify(live.faq)) { allFaq = false; firstBad = firstBad || `${file}: faq`; }
    if (f.seo_title !== live.seoTitle) { allSeo = false; firstBad = firstBad || `${file}: seoTitle`; }
    if (f.featured_image !== live.image) { allImages = false; firstBad = firstBad || `${file}: image`; }
    if (f.excerpt !== live.excerpt) { allExcerpts = false; firstBad = firstBad || `${file}: excerpt`; }

    totalFaq += f.faq.length;
    totalRelated += f.related_slugs.length;
  }

  check(`all ${files.length} articles parsed`, files.length > 0);
  check('titles match the live site', allTitles, firstBad);
  check('slugs match the live site', allSlugs, firstBad);
  check('categories match', allCats, firstBad);
  check('tags match', allTags, firstBad);
  check('FAQ matches question for question', allFaq, firstBad);
  check('SEO titles match', allSeo, firstBad);
  check('featured images match', allImages, firstBad);
  check('excerpts match', allExcerpts, firstBad);
  console.log(`    ${totalFaq} FAQ questions and ${totalRelated} related links recovered across ${files.length} articles`);

  // Nothing should be reported as missing for a complete article.
  const sample = parseMarkdownImport(fs.readFileSync(path.join(DIR, files[0]), 'utf8'), { filename: files[0] });
  check('a complete article reports nothing left blank', sample.empty.length === 0, sample.empty.join(', '));
  check('and reports every field as filled', sample.filled.length === 12, String(sample.filled.length));

  // The filename is what gives an unslugged file its URL.
  const noSlug = ['---', 'title: What Is AEO (Answer Engine Optimization) for Doctors?', '---', '', 'Body.'].join('\n');
  check('with no slug in the file, the FILENAME decides the URL',
    parseMarkdownImport(noSlug, { filename: 'aeo-for-doctors.md' }).fields.slug === 'aeo-for-doctors',
    parseMarkdownImport(noSlug, { filename: 'aeo-for-doctors.md' }).fields.slug);
  check('an explicit slug still wins over the filename',
    parseMarkdownImport(['---', 'title: x', 'slug: chosen-slug', '---', '', 'b'].join('\n'),
      { filename: 'other-name.md' }).fields.slug === 'chosen-slug');
  check('pasted text with no filename falls back to the title',
    parseMarkdownImport(noSlug, {}).fields.slug === 'what-is-aeo-answer-engine-optimization-for-doctors');
  check('and says so, because that URL may not be the one intended',
    parseMarkdownImport(noSlug, {}).notes.some((n) => /built from the title/.test(n)));
}

// ── 2. Related links come out of the prose ──────────────────────────────────

function checkRelated() {
  group('2. Related articles are picked up from links inside the text');

  const md = [
    '---', 'title: Related test', 'category: Guide', '---', '',
    'See [GEO for doctors](/resources/geo-for-doctors) and',
    '[what is visibility](/resources/what-is-doctor-online-visibility).',
    'Also [the same one again](/resources/geo-for-doctors).',
    'And an [absolute link](https://www.thedocmirror.com/resources/medical-faq-content-ai).',
    'Plus an [external one](https://example.com/page) that must not count.',
    'And [itself](/resources/related-test) which must not count either.',
  ].join('\n');

  const r = parseMarkdownImport(md);
  check('internal links become related slugs', r.fields.related_slugs.length === 3,
    JSON.stringify(r.fields.related_slugs));
  check('duplicates collapse',
    r.fields.related_slugs.filter((s) => s === 'geo-for-doctors').length === 1);
  check('an absolute thedocmirror.com link counts',
    r.fields.related_slugs.includes('medical-faq-content-ai'), JSON.stringify(r.fields.related_slugs));
  check('an external link does not', !r.fields.related_slugs.some((s) => /example/.test(s)));
  check('the article does not relate to itself',
    !r.fields.related_slugs.includes('related-test'));
  check('order follows the article', r.fields.related_slugs[0] === 'geo-for-doctors');
}

// ── 3. FAQ written as a body section ────────────────────────────────────────

function checkBodyFaq() {
  group('3. An FAQ written in the body is moved into the FAQ editor');

  const md = [
    '---', 'title: Body FAQ test', '---', '',
    'Intro paragraph.', '',
    '## A real section', '', 'Some content.', '',
    '## Frequently asked questions', '',
    '### Is this parsed?', '', 'Yes, **it is** — with the emphasis flattened.', '',
    '### What about a second one?', '', 'That works too.', '',
    '## After the FAQ', '', 'This section must survive.',
  ].join('\n');

  const r = parseMarkdownImport(md);
  check('both questions extracted', r.fields.faq.length === 2, JSON.stringify(r.fields.faq));
  check('question text is clean', r.fields.faq[0].question === 'Is this parsed?', r.fields.faq[0].question);
  check('answer markdown is flattened to plain prose',
    r.fields.faq[0].answer === 'Yes, it is — with the emphasis flattened.', r.fields.faq[0].answer);
  check('the FAQ section is removed from the body',
    !/Frequently asked questions/i.test(r.fields.content_md) && !/Is this parsed/.test(r.fields.content_md));
  check('sections before the FAQ survive', /## A real section/.test(r.fields.content_md));
  check('sections after the FAQ survive', /## After the FAQ/.test(r.fields.content_md) &&
    /This section must survive/.test(r.fields.content_md));
  check('the author is told what happened',
    r.notes.some((n) => /moved into the FAQ editor/.test(n)), r.notes.join(' | '));

  const fmWins = parseMarkdownImport([
    '---', 'title: x', 'faq:', '  - question: From frontmatter', '    answer: Yes.', '---', '',
    '## FAQ', '', '### From the body', '', 'Should be ignored.',
  ].join('\n'));
  check('frontmatter FAQ takes precedence over a body section',
    fmWins.fields.faq.length === 1 && fmWins.fields.faq[0].question === 'From frontmatter',
    JSON.stringify(fmWins.fields.faq));
}

// ── 4. A plain file with no frontmatter ─────────────────────────────────────

function checkNoFrontmatter() {
  group('4. A plain Markdown file with no frontmatter');

  const md = [
    '# How doctors show up in AI search', '',
    'Opening paragraph that becomes the excerpt.', '',
    '## First section', '', 'Body text here.',
  ].join('\n');

  const r = parseMarkdownImport(md);
  check('title taken from the first heading',
    r.fields.title === 'How doctors show up in AI search', r.fields.title);
  check('that heading is removed from the body so it is not shown twice',
    !/^#\s+How doctors/m.test(r.fields.content_md));
  check('slug derived from the title',
    r.fields.slug === 'how-doctors-show-up-in-ai-search', r.fields.slug);
  check('excerpt derived from the opening',
    /Opening paragraph/.test(r.fields.excerpt), r.fields.excerpt);
  check('read time computed', r.fields.read_time_minutes > 0);

  check('category left EMPTY, not guessed', r.fields.category === '', r.fields.category);
  check('tags left EMPTY, not guessed', r.fields.tags.length === 0);
  check('meta description left EMPTY, not written', r.fields.meta_description === '');
  check('SEO title left EMPTY, not written', r.fields.seo_title === '');
  check('featured image left EMPTY', r.fields.featured_image === '');
  check('FAQ left EMPTY, not invented', r.fields.faq.length === 0);
  check('the blanks are reported to the author',
    ['Category', 'Tags', 'SEO Title', 'Meta Description', 'Featured Image', 'FAQ']
      .every((l) => r.empty.includes(l)), r.empty.join(', '));
  check('the missing frontmatter is explained',
    r.notes.some((n) => /No frontmatter/.test(n)));
}

// ── 5. Awkward input is handled, not crashed on ─────────────────────────────

function checkEdgeCases() {
  group('5. Awkward input');

  const noTitle = parseMarkdownImport('Just a paragraph with no heading at all.');
  check('a file with no title returns an empty title for the route to reject',
    noTitle.fields.title === '', noTitle.fields.title);

  const badImage = parseMarkdownImport(['---', 'title: x', 'image: javascript:alert(1)', '---', '', 'body'].join('\n'));
  check('a dangerous image URL is dropped', badImage.fields.featured_image === '');
  check('and the author is told', badImage.notes.some((n) => /featured image/i.test(n)));

  const badLink = parseMarkdownImport(['---', 'title: x', '---', '', '[bad](javascript:alert(1))'].join('\n'));
  check('a javascript: link does not become a related slug', badLink.fields.related_slugs.length === 0);

  const csvTags = parseMarkdownImport(['---', 'title: x', 'tags: One, Two , Three', '---', '', 'body'].join('\n'));
  check('comma-separated tags parse', JSON.stringify(csvTags.fields.tags) === '["One","Two","Three"]',
    JSON.stringify(csvTags.fields.tags));

  const aliases = parseMarkdownImport([
    '---', 'title: x', 'featuredImage: /images/resources/a.png', 'excerpt: An alias excerpt.',
    'readTime: 7 min', '---', '', 'body',
  ].join('\n'));
  check('featuredImage alias accepted', aliases.fields.featured_image === '/images/resources/a.png');
  check('excerpt alias accepted', aliases.fields.excerpt === 'An alias excerpt.');
  check('readTime "7 min" parsed as 7', aliases.fields.read_time_minutes === 7,
    String(aliases.fields.read_time_minutes));

  const dated = parseMarkdownImport(['---', 'title: x', 'date: 2026-08-05', '---', '', 'body'].join('\n'));
  check('a date-only frontmatter date fills the publish date',
    dated.fields.publish_date === '2026-08-05', dated.fields.publish_date);
  check('and leaves the time blank', dated.fields.publish_time === '', dated.fields.publish_time);

  let threw = false;
  try { parseMarkdownImport(''); } catch (_) { threw = true; }
  check('an empty file does not throw', !threw);

  const html = parseMarkdownImport(['---', 'title: x', '---', '', '<script>alert(1)</script>', '', 'Safe text.'].join('\n'));
  check('raw markup survives parsing untouched — the save path sanitises it',
    typeof html.fields.content_md === 'string');
}

// ── 6. The rendered preview matches the live renderer ───────────────────────

function checkRenderedHtml() {
  group('6. The HTML handed to the visual editor');

  const files = fs.readdirSync(DIR).filter((f) => /\.md$/i.test(f) && f.toLowerCase() !== 'readme.md');
  const raw = fs.readFileSync(path.join(DIR, files[0]), 'utf8');
  const r = parseMarkdownImport(raw, { filename: files[0] });
  const live = markdown.getResourceBySlug(markdown.slugify(files[0]));

  check('the editor HTML matches what the site renders for the same body',
    r.contentHtml === live.html, 'the imported article would render differently');
  check('headings survive', /<h2/.test(r.contentHtml));
  check('links survive', /<a href=/.test(r.contentHtml));
}

// ── main ────────────────────────────────────────────────────────────────────

console.log('\nMarkdown import verification');

checkLiveArticles();
checkRelated();
checkBodyFaq();
checkNoFrontmatter();
checkEdgeCases();
checkRenderedHtml();

console.log(`\n${'─'.repeat(72)}`);
if (failures.length) {
  console.log(`${passed} passed, ${failures.length} FAILED\n`);
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  console.log('');
  process.exitCode = 1;
} else {
  console.log(`${passed} passed, 0 failed — importing changes nothing about an article\n`);
  process.exitCode = 0;
}
