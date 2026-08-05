/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — Add / Edit Blog

   A visual editor for people who do not write HTML. What is typed is stored as
   MARKDOWN in blog_posts.content_md, because the public renderer already turns
   Markdown into the Resources article design — the same `marked` pipeline the
   24 existing .md articles go through. Sharing that pipeline is what
   guarantees a CMS article and a Markdown article look identical.

   Round trip: content_md --(server, marked)--> HTML --> contenteditable
               contenteditable --(serialise here)--> content_md

   Nothing privileged happens in this file. Every read and write goes through
   /api/admin/*, which re-checks profiles.role = 'admin' on the server for each
   request. The browser holds no storage credential and no service key.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var esc = AdminAuth.escapeHtml;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    id: new URLSearchParams(location.search).get('id') || null,
    options: null,
    faq: [],
    related: [],          // [{slug, title, source}]
    dirty: false,
    saving: false,
    status: 'draft',
    slugLocked: false,
    slugTouched: false,
    slugOk: true,
  };

  // The starting skeleton for a new article: enough shape that a non-technical
  // author is never staring at an empty box, but every block is deletable and
  // nothing is required.
  var STARTER_HTML =
    '<p>Write your introduction here — set up the problem and why it matters.</p>' +
    '<h2>First section heading</h2><p>Write this section\'s content here.</p>' +
    '<h2>Second section heading</h2><p>Write this section\'s content here.</p>' +
    '<h3>A subheading</h3><p>Write the subsection content here.</p>';

  /* ── HTML → Markdown ─────────────────────────────────────────────────────
     A whitelist walker, not a regex pass. Anything not recognised contributes
     only its text, so pasted markup can never smuggle a tag into content_md.
     The server sanitises again on save — this is the first of two gates. */

  function escapeInline(s) {
    return String(s).replace(/([\\`*\[\]])/g, '\\$1');
  }

  function escapeBlockStart(line) {
    return line.replace(/^(\s*)(#{1,6}\s|>\s|[-+*]\s|\d+\.\s)/, function (m, sp, tok) {
      return sp + '\\' + tok;
    });
  }

  function safeHref(url) {
    var v = String(url || '').trim();
    if (!v) return '';
    if (/^(javascript|vbscript|data|file):/i.test(v)) return '';
    if (/^https?:\/\//i.test(v) || /^mailto:/i.test(v) || v.charAt(0) === '/' || v.charAt(0) === '#') return v;
    return '';
  }

  function inlineMd(node) {
    var out = '';
    for (var i = 0; i < node.childNodes.length; i++) {
      var n = node.childNodes[i];

      if (n.nodeType === 3) { out += escapeInline(n.nodeValue.replace(/\s+/g, ' ')); continue; }
      if (n.nodeType !== 1) continue;

      var tag = n.tagName.toLowerCase();
      var inner = inlineMd(n);

      if (tag === 'br') { out += '  \n'; }
      else if (tag === 'strong' || tag === 'b') { out += inner.trim() ? '**' + inner + '**' : ''; }
      else if (tag === 'em' || tag === 'i') { out += inner.trim() ? '*' + inner + '*' : ''; }
      else if (tag === 'u') { out += inner.trim() ? '<u>' + inner + '</u>' : ''; }
      else if (tag === 's' || tag === 'strike' || tag === 'del') { out += inner.trim() ? '~~' + inner + '~~' : ''; }
      else if (tag === 'code') { out += '`' + n.textContent + '`'; }
      else if (tag === 'a') {
        var href = safeHref(n.getAttribute('href'));
        out += href ? '[' + (inner || href) + '](' + href + ')' : inner;
      } else if (tag === 'img') {
        var src = safeHref(n.getAttribute('src'));
        if (src) out += '![' + escapeInline(n.getAttribute('alt') || '') + '](' + src + ')';
      } else {
        out += inner;                       // span, font, unknown → text only
      }
    }
    return out;
  }

  function listMd(el, ordered, depth) {
    var pad = new Array(depth * 2 + 1).join(' ');
    var lines = [];
    var idx = 0;
    for (var i = 0; i < el.children.length; i++) {
      var li = el.children[i];
      if (li.tagName.toLowerCase() !== 'li') continue;
      idx++;

      // Nested lists are pulled out so they are not swallowed by the parent line.
      var nested = [];
      var clone = li.cloneNode(true);
      var subs = clone.querySelectorAll(':scope > ul, :scope > ol');
      for (var s = 0; s < subs.length; s++) {
        nested.push(listMd(subs[s], subs[s].tagName.toLowerCase() === 'ol', depth + 1));
        subs[s].remove();
      }

      var text = inlineMd(clone).trim();
      lines.push(pad + (ordered ? idx + '. ' : '- ') + text);
      if (nested.length) lines.push(nested.join('\n'));
    }
    return lines.join('\n');
  }

  function tableMd(table) {
    var rows = table.querySelectorAll('tr');
    if (!rows.length) return '';
    var out = [];
    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r].querySelectorAll('th,td');
      var vals = [];
      for (var c = 0; c < cells.length; c++) {
        vals.push(inlineMd(cells[c]).replace(/\|/g, '\\|').trim());
      }
      out.push('| ' + vals.join(' | ') + ' |');
      if (r === 0) out.push('|' + vals.map(function () { return ' --- '; }).join('|') + '|');
    }
    return out.join('\n');
  }

  function blockMd(el) {
    var tag = el.tagName ? el.tagName.toLowerCase() : '';

    if (tag === 'h1') return '# '   + inlineMd(el).trim();
    if (tag === 'h2') return '## '  + inlineMd(el).trim();
    if (tag === 'h3') return '### ' + inlineMd(el).trim();
    if (tag === 'h4') return '#### ' + inlineMd(el).trim();
    if (tag === 'hr') return '---';
    if (tag === 'ul') return listMd(el, false, 0);
    if (tag === 'ol') return listMd(el, true, 0);
    if (tag === 'table') return tableMd(el);
    if (tag === 'pre') return '```\n' + el.textContent.replace(/\s+$/, '') + '\n```';

    if (tag === 'blockquote') {
      var innerBlocks = [];
      for (var i = 0; i < el.children.length; i++) innerBlocks.push(blockMd(el.children[i]));
      var text = innerBlocks.filter(Boolean).join('\n\n') || inlineMd(el).trim();
      return text.split('\n').map(function (l) { return '> ' + l; }).join('\n');
    }

    if (tag === 'figure' || tag === 'div') {
      var parts = [];
      for (var j = 0; j < el.children.length; j++) parts.push(blockMd(el.children[j]));
      var joined = parts.filter(Boolean).join('\n\n');
      return joined || escapeBlockStart(inlineMd(el).trim());
    }

    // p and everything else
    var line = inlineMd(el).trim();
    return line ? escapeBlockStart(line) : '';
  }

  function serialiseContent() {
    var root = $('editor');
    var blocks = [];
    for (var i = 0; i < root.childNodes.length; i++) {
      var n = root.childNodes[i];
      if (n.nodeType === 3) {
        var t = n.nodeValue.trim();
        if (t) blocks.push(escapeBlockStart(escapeInline(t)));
        continue;
      }
      if (n.nodeType !== 1) continue;
      var md = blockMd(n);
      if (md && md.trim()) blocks.push(md);
    }
    return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ── toolbar ─────────────────────────────────────────────────────────── */

  function exec(cmd, value) {
    document.execCommand(cmd, false, value === undefined ? null : value);
    $('editor').focus();
    markDirty();
  }

  function handleCommand(cmd) {
    switch (cmd) {
      case 'h1': case 'h2': case 'h3': exec('formatBlock', '<' + cmd + '>'); break;
      case 'p':  exec('formatBlock', '<p>'); break;
      case 'bold': exec('bold'); break;
      case 'italic': exec('italic'); break;
      case 'underline': exec('underline'); break;
      case 'strike': exec('strikeThrough'); break;
      case 'ul': exec('insertUnorderedList'); break;
      case 'ol': exec('insertOrderedList'); break;
      case 'quote': exec('formatBlock', '<blockquote>'); break;
      case 'code': exec('formatBlock', '<pre>'); break;
      case 'hr': exec('insertHorizontalRule'); break;
      case 'undo': exec('undo'); break;
      case 'redo': exec('redo'); break;
      case 'unlink': exec('unlink'); break;

      case 'link': {
        var sel = window.getSelection();
        var selected = sel && sel.toString();
        var text = selected || window.prompt('Link text');
        if (!text) return;
        var url = window.prompt('Link URL — a full https:// address, or a site path like /resources/some-article');
        if (!url) return;
        if (!safeHref(url)) { flash('That link type is not allowed. Use https://, mailto: or a /site path.', 'error'); return; }
        if (selected) exec('createLink', url);
        else exec('insertHTML', '<a href="' + esc(url) + '">' + esc(text) + '</a>');
        break;
      }

      case 'image':
        openMedia('content');
        break;

      case 'table':
        exec('insertHTML',
          '<table><tr><th>Column</th><th>Column</th></tr>' +
          '<tr><td>Value</td><td>Value</td></tr>' +
          '<tr><td>Value</td><td>Value</td></tr></table><p><br></p>');
        break;
    }
  }

  /* ── checklist ───────────────────────────────────────────────────────── */

  // Mirrors PUBLISH_REQUIRED in routes/admin/posts.js. The server re-checks and
  // refuses on its own; this only tells the admin what is missing before they
  // hit a button.
  var REQUIRED = [
    ['f-title',    'Title'],
    ['f-slug',     'Slug'],
    ['f-image',    'Featured Image'],
    ['f-alt',      'Featured Image ALT'],
    ['f-category', 'Category'],
    ['f-seotitle', 'SEO Title'],
    ['f-metadesc', 'Meta Description'],
  ];

  function missingFields() {
    return REQUIRED.filter(function (r) { return !$(r[0]).value.trim(); }).map(function (r) { return r[1]; });
  }

  function renderChecklist() {
    var miss = missingFields();
    var box = $('checklist');
    box.className = 'adm-checklist show' + (miss.length ? '' : ' is-ready');
    box.innerHTML = miss.length
      ? '<div class="adm-checklist-title">⚠ Complete these before publishing (' + miss.length + ')</div>' +
        '<ul>' + miss.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>'
      : '<div class="adm-checklist-title">✓ Ready to publish</div>';

    var block = miss.length > 0 || state.slugOk === false;
    $('btn-publish').disabled = block || state.saving;
    $('btn-schedule').disabled = block || state.saving;
  }

  /* ── small helpers ───────────────────────────────────────────────────── */

  function slugify(s) {
    return String(s).toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function markDirty() {
    state.dirty = true;
    var d = $('save-state');
    if (d) d.innerHTML = '<span class="adm-dirty show">Unsaved changes</span>';
    renderChecklist();
    updateReadTime();
  }

  function markClean(text) {
    state.dirty = false;
    var d = $('save-state');
    if (d) d.textContent = text || 'All changes saved';
  }

  function flash(text, kind) {
    var el = $('msg');
    el.className = 'adm-msg show adm-msg--' + (kind || 'error');
    el.innerHTML = esc(text);
    if (kind === 'info') setTimeout(function () { el.className = 'adm-msg'; }, 5000);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function clearFlash() { $('msg').className = 'adm-msg'; }

  function updateReadTime() {
    var words = ($('editor').innerText || '').trim().split(/\s+/).filter(Boolean).length;
    var mins = Math.max(1, Math.round(words / 200));
    var el = $('f-readtime');
    if (!el.dataset.touched) el.value = mins;
    $('ed-stats').textContent = words + ' words · about ' + mins + ' min read';
  }

  function updateCanonical() {
    var slug = $('f-slug').value.trim();
    var pattern = (state.options && state.options.canonicalPattern) || '/{slug}';
    $('f-canonical').value = slug ? pattern.replace('{slug}', slug) : '';
  }

  function counter(inputId, counterId, max) {
    var v = $(inputId).value.length;
    var c = $(counterId);
    c.textContent = v + '/' + max;
    c.className = 'adm-counter' + (v > max ? ' is-over' : '');
  }

  function renderTags() {
    var tags = $('f-tags').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    $('tag-preview').innerHTML = tags.map(function (t) {
      return '<span class="adm-pill">' + esc(t) + '</span>';
    }).join('');
    return tags;
  }

  /* ── slug availability ───────────────────────────────────────────────── */

  var slugTimer = null;
  function checkSlug() {
    clearTimeout(slugTimer);
    var slug = $('f-slug').value.trim();
    var hint = $('slug-hint');
    if (!slug) { hint.textContent = ''; state.slugOk = true; renderChecklist(); return; }

    hint.className = 'adm-hint';
    hint.textContent = 'Checking availability…';

    slugTimer = setTimeout(async function () {
      try {
        var q = '/api/admin/posts/slug-check?slug=' + encodeURIComponent(slug) +
                (state.id ? '&id=' + encodeURIComponent(state.id) : '');
        var r = await AdminAuth.api(q);
        state.slugOk = !!r.available;
        hint.className = 'adm-hint ' + (r.available ? 'is-good' : 'is-bad');
        hint.textContent = r.available
          ? 'Available — the article will live at /resources/' + r.slug
          : (r.reason || 'That URL is taken.');
        $('f-slug').classList.toggle('is-bad', !r.available);
      } catch (e) {
        hint.className = 'adm-hint';
        hint.textContent = 'Could not check availability.';
      }
      renderChecklist();
    }, 350);
  }

  /* ── FAQ ─────────────────────────────────────────────────────────────── */

  function renderFaq() {
    var box = $('faq-list');
    box.innerHTML = state.faq.map(function (f, i) {
      return '<div class="adm-repeat-item">' +
        '<div class="adm-repeat-head"><span class="adm-repeat-num">Question ' + (i + 1) + '</span>' +
        '<button type="button" class="adm-x" data-faq-del="' + i + '">Remove</button></div>' +
        '<input class="adm-in" data-faq-q="' + i + '" placeholder="Question" value="' + esc(f.question) + '">' +
        '<textarea class="adm-ta" data-faq-a="' + i + '" placeholder="Answer">' + esc(f.answer) + '</textarea>' +
        '</div>';
    }).join('');

    $('faq-count').textContent = state.faq.length + (state.faq.length === 1 ? ' question' : ' questions');
    $('faq-empty').style.display = state.faq.length ? 'none' : '';
    updateSchemaHint();          // the FAQ count changes what the schema line says
  }

  /* ── related ─────────────────────────────────────────────────────────── */

  function renderRelated() {
    $('rel-list').innerHTML = state.related.map(function (r, i) {
      var url = r.url || ('/resources/' + r.slug);
      return '<span class="adm-pill" title="' + esc(url) + '">' + esc(r.title || r.slug) +
        '<span class="adm-pill-src">' + esc(r.status === 'scheduled' ? 'scheduled' : (r.source || '')) + '</span>' +
        '<button type="button" data-rel-del="' + i + '" aria-label="Remove">×</button></span>';
    }).join('');
    $('rel-count').textContent = state.related.length + ' selected';
  }

  function addRelated(item) {
    if (state.related.length >= 6) { flash('Up to 6 related articles.', 'error'); return false; }
    if (state.related.some(function (x) { return x.slug === item.slug; })) {
      flash('That article is already in the list.', 'error'); return false;
    }
    state.related.push(item);
    renderRelated();
    markDirty();
    return true;
  }

  // The picker is also a browser: an empty box lists EVERY article on the site —
  // the existing Resources articles and every CMS blog, scheduled ones included —
  // so the admin can pick from the catalogue instead of having to recall a title.
  var relTimer = null;
  function searchRelated(immediate) {
    clearTimeout(relTimer);
    var q = $('rel-search').value.trim();
    var list = $('rel-results');

    relTimer = setTimeout(async function () {
      list.innerHTML = '<button type="button" disabled><span class="s-meta">Loading…</span></button>';
      list.className = 'adm-suggest-list show';
      try {
        var r = await AdminAuth.api('/api/admin/posts/related-search?q=' + encodeURIComponent(q) +
          '&exclude=' + encodeURIComponent($('f-slug').value.trim()));
        var picked = state.related.map(function (x) { return x.slug; });
        var items = (r.results || []).filter(function (x) { return picked.indexOf(x.slug) === -1; });

        list.innerHTML = items.length
          ? items.map(function (x) {
              var badge = x.status === 'scheduled' ? ' · scheduled' : '';
              return '<button type="button"' +
                ' data-add-slug="' + esc(x.slug) + '"' +
                ' data-add-title="' + esc(x.title) + '"' +
                ' data-add-source="' + esc(x.source) + '"' +
                ' data-add-url="' + esc(x.url || ('/resources/' + x.slug)) + '"' +
                ' data-add-status="' + esc(x.status || '') + '">' +
                '<span class="s-title">' + esc(x.title) + '</span>' +
                '<span class="s-meta">' + esc(x.url || ('/resources/' + x.slug)) +
                ' · ' + esc(x.source) + badge + '</span></button>';
            }).join('')
          : '<button type="button" disabled><span class="s-meta">' +
            (q ? 'No matches for “' + esc(q) + '”' : 'No articles found') + '</span></button>';

        $('rel-hint').textContent = q
          ? items.length + ' of ' + (r.total || 0) + ' articles match'
          : (r.total || 0) + ' articles available — every Resources article and CMS blog, including scheduled ones.';
      } catch (e) {
        list.innerHTML = '<button type="button" disabled><span class="s-meta">Could not load the list</span></button>';
      }
    }, immediate ? 0 : 250);
  }

  // "Add by URL" — accepts a full address, a /resources path, or a bare slug,
  // and is resolved SERVER-side so a related link can never be a typo pointing
  // at a page that does not exist.
  /** Turns stored slugs back into real titles when an existing post is opened. */
  async function hydrateRelatedTitles() {
    if (!state.related.length) return;
    try {
      var r = await AdminAuth.api('/api/admin/posts/related-search?limit=300');
      var bySlug = {};
      (r.results || []).forEach(function (x) { bySlug[x.slug] = x; });
      state.related = state.related.map(function (item) {
        var hit = bySlug[item.slug];
        return hit ? { slug: hit.slug, title: hit.title, source: hit.source, url: hit.url, status: hit.status } : item;
      });
      renderRelated();
    } catch (_) { /* pills keep showing the slug — harmless */ }
  }

  function updateSchemaHint() {
    var art = $('f-schema-article').checked;
    var faq = $('f-schema-faq').checked;
    var faqCount = state.faq.filter(function (f) { return f.question && f.answer; }).length;

    document.querySelectorAll('.adm-check').forEach(function (el) {
      var box = el.querySelector('input');
      el.classList.toggle('is-off', box && !box.checked);
    });

    var parts = [];
    parts.push(art ? 'BlogPosting schema will be emitted.' : 'BlogPosting schema is OFF for this article.');
    if (!faq) parts.push('FAQPage schema is OFF.');
    else if (!faqCount) parts.push('FAQPage schema is on, but there are no questions yet, so nothing is emitted.');
    else parts.push('FAQPage schema will be emitted for ' + faqCount + ' question' + (faqCount === 1 ? '' : 's') + '.');
    parts.push('Breadcrumb schema, canonical, Open Graph and Twitter tags are always included.');

    $('schema-hint').textContent = parts.join(' ');
  }

  async function addRelatedByUrl() {
    var raw = $('rel-url').value.trim();
    var hint = $('rel-url-hint');
    if (!raw) { hint.className = 'adm-hint is-bad'; hint.textContent = 'Paste a URL or a slug first.'; return; }

    hint.className = 'adm-hint';
    hint.textContent = 'Checking…';
    try {
      var r = await AdminAuth.api('/api/admin/posts/resolve-related?value=' + encodeURIComponent(raw));
      if (addRelated(r.result)) {
        $('rel-url').value = '';
        hint.className = 'adm-hint is-good';
        hint.textContent = 'Added “' + r.result.title + '”.';
      } else {
        hint.className = 'adm-hint'; hint.textContent = '';
      }
    } catch (e) {
      hint.className = 'adm-hint is-bad';
      hint.textContent = e.message;
    }
  }

  /* ── media ───────────────────────────────────────────────────────────── */

  var mediaTarget = 'featured';   // 'featured' | 'content'

  function openMedia(target) {
    mediaTarget = target || 'featured';
    $('media-title').textContent = target === 'content' ? 'Insert image into the article' : 'Featured image';
    $('media-modal').classList.add('show');
    $('media-msg').className = 'adm-msg';
    loadMedia();
  }
  function closeMedia() { $('media-modal').classList.remove('show'); }

  async function loadMedia() {
    var grid = $('media-grid');
    grid.innerHTML = '<p class="adm-hint">Loading…</p>';
    try {
      var r = await AdminAuth.api('/api/admin/media?limit=60');
      var items = r.media || [];
      $('media-empty').style.display = items.length ? 'none' : '';
      grid.innerHTML = items.map(function (m) {
        return '<div class="adm-media-item" data-url="' + esc(m.public_url || '') + '" data-alt="' + esc(m.alt_text || '') + '">' +
          '<div class="m-thumb"><img src="' + esc(m.public_url || '') + '" alt="' + esc(m.alt_text || m.filename) + '" loading="lazy"></div>' +
          '<div class="m-meta"><span class="m-name">' + esc(m.filename) + '</span>' +
          (m.width ? m.width + '×' + m.height : '') + '</div></div>';
      }).join('');
    } catch (e) {
      grid.innerHTML = '';
      $('media-msg').className = 'adm-msg show adm-msg--error';
      $('media-msg').textContent = e.message;
    }
  }

  function pickImage(url, alt) {
    if (!url) return;
    if (mediaTarget === 'content') {
      $('editor').focus();
      exec('insertHTML', '<img src="' + esc(url) + '" alt="' + esc(alt || '') + '"><p><br></p>');
    } else {
      $('f-image').value = url;
      if (alt && !$('f-alt').value.trim()) $('f-alt').value = alt;
      renderFeaturedPreview();
      markDirty();
    }
    closeMedia();
  }

  function renderFeaturedPreview() {
    var url = $('f-image').value.trim();
    var drop = $('img-drop');
    drop.innerHTML = url
      ? '<img src="' + esc(url) + '" alt="preview">'
      : '<span id="img-drop-label">Click to upload, or drag an image here</span>';
  }

  async function uploadFile(file) {
    if (!file) return;
    var limits = (state.options && state.options.upload) || {};
    if (limits.allowedMime && limits.allowedMime.indexOf(file.type) === -1) {
      flash('That file type is not supported. Use PNG, JPG, WebP or GIF.', 'error'); return;
    }
    if (limits.maxBytes && file.size > limits.maxBytes) {
      flash('That image is ' + (file.size / 1048576).toFixed(1) + ' MB. The limit is 5 MB.', 'error'); return;
    }

    $('media-msg').className = 'adm-msg show adm-msg--info';
    $('media-msg').textContent = 'Uploading ' + file.name + '…';

    try {
      var buf = await file.arrayBuffer();
      var r = await AdminAuth.apiRaw(
        '/api/admin/media/upload?filename=' + encodeURIComponent(file.name),
        { method: 'POST', headers: { 'Content-Type': file.type }, body: buf }
      );
      if (!r.ok) throw new Error((r.body && r.body.error) || 'Upload failed');

      if (r.body.warning) {
        $('media-msg').className = 'adm-msg show adm-msg--error';
        $('media-msg').textContent = r.body.warning;
      } else {
        $('media-msg').className = 'adm-msg';
      }
      await loadMedia();
      pickImage(r.body.media.public_url, r.body.media.alt_text);
    } catch (e) {
      $('media-msg').className = 'adm-msg show adm-msg--error';
      $('media-msg').textContent = e.message;
    }
  }

  /* ── payload + save ──────────────────────────────────────────────────── */

  function collect(action) {
    // Pull FAQ values straight from the DOM so nothing typed is lost if the
    // list was edited without a re-render.
    var faq = state.faq.map(function (_, i) {
      var q = document.querySelector('[data-faq-q="' + i + '"]');
      var a = document.querySelector('[data-faq-a="' + i + '"]');
      return { question: q ? q.value : '', answer: a ? a.value : '' };
    });

    return {
      action: action,
      title: $('f-title').value.trim(),
      slug: $('f-slug').value.trim(),
      excerpt: $('f-excerpt').value.trim(),
      content_md: serialiseContent(),
      author: $('f-author').value.trim(),
      category: $('f-category').value,
      tags: renderTags(),
      featured_image: $('f-image').value.trim(),
      image_alt: $('f-alt').value.trim(),
      seo_title: $('f-seotitle').value.trim(),
      meta_description: $('f-metadesc').value.trim(),
      read_time_minutes: parseInt($('f-readtime').value, 10) || null,
      faq: faq,
      related_slugs: state.related.map(function (r) { return r.slug; }),
      enable_article_schema: $('f-schema-article').checked,
      enable_faq_schema: $('f-schema-faq').checked,
      publish_date: $('f-date').value,
      publish_time: $('f-time').value,
      timezone: $('f-tz').value,
    };
  }

  function setStatusChip(status) {
    state.status = status;
    var el = $('f-status');
    el.className = 'adm-chip adm-chip--' + status;
    el.textContent = status.charAt(0).toUpperCase() + status.slice(1);
  }

  async function save(action) {
    if (state.saving) return;
    clearFlash();

    if (action === 'archive' && !window.confirm('Archive this blog? It will be removed from the public site.')) return;

    state.saving = true;
    ['btn-draft', 'btn-schedule', 'btn-archive', 'btn-publish'].forEach(function (b) { $(b).disabled = true; });
    $('save-state').textContent = 'Saving…';

    try {
      var payload = collect(action);
      var r = state.id
        ? await AdminAuth.apiRaw('/api/admin/posts/' + state.id, { method: 'PATCH', body: JSON.stringify(payload) })
        : await AdminAuth.apiRaw('/api/admin/posts', { method: 'POST', body: JSON.stringify(payload) });

      if (!r.ok) throw new Error((r.body && r.body.error) || 'Could not save.');

      var post = r.body.post;
      if (!state.id) {
        state.id = post.id;
        history.replaceState({}, '', '/admin/blogs/' + post.id + '/edit');
      }
      setStatusChip(post.status);
      applySlugLock(post);
      syncDeleteButton();
      markClean('Saved · ' + new Date().toLocaleTimeString());

      var word = action === 'publish' ? 'published' : action === 'schedule' ? 'scheduled'
               : action === 'archive' ? 'archived' : 'saved as draft';
      flash('Blog ' + word + '.', 'info');
    } catch (e) {
      flash(e.message, 'error');
      $('save-state').textContent = '';
    } finally {
      state.saving = false;
      ['btn-draft', 'btn-archive'].forEach(function (b) { $(b).disabled = false; });
      renderChecklist();
    }
  }

  // Nothing to delete until the post exists, so the button only appears once it
  // has an id — either loaded for editing, or created by the first save.
  function syncDeleteButton() {
    var b = $('btn-delete');
    if (b) b.hidden = !state.id;
  }

  function applySlugLock(post) {
    var live = post.published_at && Date.parse(post.published_at) <= Date.now();
    state.slugLocked = !!live;
    var el = $('f-slug');
    el.readOnly = state.slugLocked;
    if (state.slugLocked) {
      $('slug-hint').className = 'adm-hint';
      $('slug-hint').textContent = 'Locked — this article has been published, so its URL cannot change.';
    }
  }

  // Permanent — there is no undo and no soft-delete column. Archive is the
  // reversible option, which is why the confirmation says so out loud, and says
  // it more firmly when the post is already public.
  async function deleteBlog() {
    if (!state.id) return;
    var title = $('f-title').value.trim() || '(untitled)';
    var isLive = state.slugLocked;          // set when published_at has passed

    var msg = isLive
      ? 'Delete "' + title + '"?\n\nThis post is LIVE. Deleting it will 404 its public URL ' +
        'for anyone who has it bookmarked or linked.\n\nArchive removes it from the site and ' +
        'can be undone — delete cannot.'
      : 'Delete "' + title + '"?\n\nThis cannot be undone.';
    if (!window.confirm(msg)) return;

    try {
      var r = await AdminAuth.apiRaw('/api/admin/posts/' + state.id + (isLive ? '?confirm=live' : ''),
        { method: 'DELETE' });
      if (r.status === 409 && r.body && r.body.requires_confirm) {
        if (!window.confirm(r.body.error + '\n\nDelete anyway?')) return;
        r = await AdminAuth.apiRaw('/api/admin/posts/' + state.id + '?confirm=live', { method: 'DELETE' });
      }
      if (!r.ok) throw new Error((r.body && r.body.error) || 'Could not delete.');
      state.dirty = false;                  // do not warn about unsaved changes on the way out
      window.location.href = '/admin';
    } catch (e) {
      flash(e.message, 'error');
    }
  }

  async function preview() {
    var payload = collect('preview');
    var win = window.open('', '_blank');
    if (!win) { flash('Allow pop-ups to use Preview.', 'error'); return; }
    win.document.write('<p style="font-family:sans-serif;padding:2rem">Building preview…</p>');
    try {
      var res = await fetch('/api/admin/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AdminAuth.token() },
        body: JSON.stringify(Object.assign(payload, { status: state.status })),
      });
      var html = await res.text();
      if (!res.ok) { win.close(); flash('Preview failed.', 'error'); return; }
      win.document.open(); win.document.write(html); win.document.close();
    } catch (e) { win.close(); flash('Preview failed: ' + e.message, 'error'); }
  }

  /* ── load ────────────────────────────────────────────────────────────── */

  function fillOptions(o) {
    var cat = $('f-category');
    cat.innerHTML = '<option value="">Select a category</option>' +
      o.categories.map(function (c) { return '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>'; }).join('');

    $('cat-hint').innerHTML = o.categories.length
      ? ''
      : 'No categories yet — <a href="/admin/categories">add one</a>, or type a name after choosing later.';

    $('author-list').innerHTML = o.authors.map(function (a) { return '<option value="' + esc(a) + '">'; }).join('');
    if (!$('f-author').value) $('f-author').value = o.defaultAuthor;

    $('f-tz').innerHTML = o.timezones.map(function (t) {
      return '<option value="' + esc(t.id) + '"' + (t.id === o.defaultTimezone ? ' selected' : '') + '>' + esc(t.label) + '</option>';
    }).join('');
  }

  function fillPost(p, contentHtml) {
    $('f-title').value = p.title || '';
    $('f-slug').value = p.slug || '';
    $('f-excerpt').value = p.excerpt || '';
    $('f-author').value = p.author || '';
    $('f-category').value = p.category || '';
    $('f-tags').value = (p.tags || []).join(', ');
    $('f-image').value = p.featured_image || '';
    $('f-alt').value = p.image_alt || '';
    $('f-seotitle').value = p.seo_title || '';
    $('f-metadesc').value = p.meta_description || '';
    if (p.read_time_minutes) { $('f-readtime').value = p.read_time_minutes; $('f-readtime').dataset.touched = '1'; }

    $('f-schema-article').checked = p.enable_article_schema !== false;
    $('f-schema-faq').checked     = p.enable_faq_schema !== false;

    state.faq = Array.isArray(p.faq) ? p.faq : [];
    // Stored as slugs; the titles are filled in from the catalogue so the pills
    // read like article names rather than URLs.
    state.related = (p.related_slugs || []).map(function (s) {
      return { slug: s, title: s, source: '', url: '/resources/' + s };
    });
    hydrateRelatedTitles();

    if (p.published_at) {
      var d = new Date(p.published_at);
      if (!isNaN(d.getTime())) {
        $('f-date').value = d.toISOString().slice(0, 10);
        $('f-time').value = d.toISOString().slice(11, 16);
      }
    }

    $('editor').innerHTML = contentHtml || '<p><br></p>';
    setStatusChip(p.status || 'draft');
    applySlugLock(p);
    state.slugTouched = true;
  }

  async function init(admin) {
    AdminShell.mount({
      active: 'blogs',
      title: state.id ? 'Edit Blog' : 'Add Blog',
      actions:
        '<span class="adm-dirty" id="top-dirty">Unsaved changes</span>' +
        '<button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" id="btn-preview">Preview</button>' +
        '<a class="adm-btn adm-btn--ghost adm-btn--sm" href="/admin/blogs" style="text-decoration:none">Back</a>',
    });
    AdminShell.setEmail(admin.email);
    $('btn-preview').addEventListener('click', preview);

    try {
      state.options = await AdminAuth.api('/api/admin/options');
      fillOptions(state.options);
    } catch (e) { flash('Could not load editor options: ' + e.message, 'error'); }

    if (state.id) {
      try {
        var r = await AdminAuth.api('/api/admin/posts/' + state.id);
        fillPost(r.post, r.content_html);
      } catch (e) { flash('Could not load this blog: ' + e.message, 'error'); }
    } else {
      $('editor').innerHTML = STARTER_HTML;
    }

    renderFaq();
    renderRelated();
    renderTags();
    renderFeaturedPreview();
    updateCanonical();
    updateReadTime();
    updateSchemaHint();
    syncDeleteButton();
    counter('f-seotitle', 'seo-title-count', 60);
    counter('f-metadesc', 'meta-desc-count', 160);
    renderChecklist();
    markClean(state.id ? 'Loaded' : '');
    wire();
  }

  /* ── wiring ──────────────────────────────────────────────────────────── */

  function wire() {
    $('ed-toolbar').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-cmd]');
      if (b) { e.preventDefault(); handleCommand(b.dataset.cmd); }
    });

    var ed = $('editor');
    ed.addEventListener('input', markDirty);
    // Paste as plain text: pasted Word/web markup is the fastest way to get
    // junk into content_md, and the toolbar can re-apply real formatting.
    ed.addEventListener('paste', function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    $('f-title').addEventListener('input', function () {
      if (!state.slugTouched && !state.slugLocked) {
        $('f-slug').value = slugify($('f-title').value);
        updateCanonical(); checkSlug();
      }
      if (!$('f-seotitle').value.trim()) {
        $('f-seotitle').value = $('f-title').value.slice(0, 60);
        counter('f-seotitle', 'seo-title-count', 60);
      }
      markDirty();
    });

    $('f-slug').addEventListener('input', function () {
      state.slugTouched = true;
      $('f-slug').value = $('f-slug').value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      updateCanonical(); checkSlug(); markDirty();
    });

    ['f-excerpt', 'f-author', 'f-category', 'f-tags', 'f-image', 'f-alt', 'f-date', 'f-time', 'f-tz']
      .forEach(function (id) {
        $(id).addEventListener('input', markDirty);
        $(id).addEventListener('change', markDirty);
      });

    $('f-tags').addEventListener('input', renderTags);
    $('f-image').addEventListener('input', renderFeaturedPreview);
    $('f-readtime').addEventListener('input', function () { this.dataset.touched = '1'; markDirty(); });

    $('f-seotitle').addEventListener('input', function () { counter('f-seotitle', 'seo-title-count', 60); markDirty(); });
    $('f-metadesc').addEventListener('input', function () { counter('f-metadesc', 'meta-desc-count', 160); markDirty(); });

    ['f-schema-article', 'f-schema-faq'].forEach(function (id) {
      $(id).addEventListener('change', function () { updateSchemaHint(); markDirty(); });
    });

    // FAQ
    $('faq-add').addEventListener('click', function () {
      state.faq.push({ question: '', answer: '' }); renderFaq(); markDirty();
    });
    $('faq-list').addEventListener('click', function (e) {
      var del = e.target.closest('[data-faq-del]');
      if (!del) return;
      state.faq.splice(+del.dataset.faqDel, 1); renderFaq(); markDirty();
    });
    $('faq-list').addEventListener('input', function (e) {
      var q = e.target.dataset.faqQ, a = e.target.dataset.faqA;
      if (q !== undefined) state.faq[+q].question = e.target.value;
      if (a !== undefined) state.faq[+a].answer = e.target.value;
      markDirty();
    });

    // Related
    $('rel-search').addEventListener('input', function () { searchRelated(); });
    $('rel-search').addEventListener('focus', function () { searchRelated(true); });
    $('rel-results').addEventListener('click', function (e) {
      var b = e.target.closest('[data-add-slug]');
      if (!b) return;
      addRelated({
        slug: b.dataset.addSlug,
        title: b.dataset.addTitle,
        source: b.dataset.addSource,
        url: b.dataset.addUrl,
        status: b.dataset.addStatus,
      });
      $('rel-search').value = '';
      $('rel-results').className = 'adm-suggest-list';
    });
    $('rel-url-add').addEventListener('click', addRelatedByUrl);
    $('rel-url').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addRelatedByUrl(); }
    });
    $('rel-list').addEventListener('click', function (e) {
      var d = e.target.closest('[data-rel-del]');
      if (!d) return;
      state.related.splice(+d.dataset.relDel, 1); renderRelated(); markDirty();
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.adm-suggest')) $('rel-results').className = 'adm-suggest-list';
    });

    // Media
    $('img-library').addEventListener('click', function () { openMedia('featured'); });
    $('img-drop').addEventListener('click', function () { openMedia('featured'); });
    $('media-close').addEventListener('click', closeMedia);
    $('media-modal').addEventListener('click', function (e) { if (e.target === $('media-modal')) closeMedia(); });
    $('media-upload-btn').addEventListener('click', function () { $('file-input').click(); });
    $('file-input').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) uploadFile(e.target.files[0]);
      e.target.value = '';
    });
    $('media-grid').addEventListener('click', function (e) {
      var item = e.target.closest('.adm-media-item');
      if (item) pickImage(item.dataset.url, item.dataset.alt);
    });

    // Drag and drop straight onto the featured image box
    ['dragenter', 'dragover'].forEach(function (ev) {
      $('img-drop').addEventListener(ev, function (e) { e.preventDefault(); this.classList.add('is-drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      $('img-drop').addEventListener(ev, function (e) { e.preventDefault(); this.classList.remove('is-drag'); });
    });
    $('img-drop').addEventListener('drop', function (e) {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        mediaTarget = 'featured';
        uploadFile(e.dataTransfer.files[0]);
      }
    });

    // Actions
    $('btn-draft').addEventListener('click', function () { save('save_draft'); });
    $('btn-publish').addEventListener('click', function () { save('publish'); });
    $('btn-schedule').addEventListener('click', function () {
      if (!$('f-date').value) { flash('Pick a publish date and time to schedule.', 'error'); return; }
      save('schedule');
    });
    $('btn-archive').addEventListener('click', function () { save('archive'); });
    $('btn-delete').addEventListener('click', deleteBlog);

    window.addEventListener('beforeunload', function (e) {
      if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  AdminAuth.guard(init);
})();
