/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — Doctor Name Autocomplete (Google-style, vanilla)

   Suggests REAL doctors from Google Places (via /api/doctors/autocomplete) as
   the user types their name. Never shows fabricated/guessed names.

   Behaviour: fires at >= 3 chars · debounce 350ms · cancels the in-flight
   request on new input · loading + empty states · keyboard nav · on select
   fills name, city, specialty and stores the Google Place ID for verification.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var MIN_CHARS  = 3;
  var DEBOUNCE   = 350;   // ms (300–500 range)

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  // Wrap matches of the typed terms in <mark> (after escaping).
  function highlight(text, query) {
    var safe = esc(text);
    var terms = norm(query).toLowerCase().split(' ').filter(function (t) { return t.length > 1; });
    if (!terms.length) return safe;
    terms.sort(function (a, b) { return b.length - a.length; });
    var pattern = terms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|');
    try {
      return safe.replace(new RegExp('(' + pattern + ')', 'ig'), '<mark>$1</mark>');
    } catch (e) { return safe; }
  }

  var STAR = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
  var PIN  = '<svg class="dr-ac-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>';

  function init(cfg) {
    var fn      = $(cfg.fn);
    var ln      = $(cfg.ln);
    var cityEl  = $(cfg.city);
    var placeEl = $(cfg.placeId);
    var panel   = $(cfg.panel);
    var root    = $(cfg.root);
    if (!fn || !ln || !panel || !root || !placeEl) return null;

    var state = { open: false, active: -1, items: [], timer: null, ctrl: null, lastQuery: '' };

    function query() { return norm(fn.value + ' ' + ln.value); }

    function open()  { if (!state.open) { state.open = true; panel.classList.add('open'); setAria('true'); } }
    function close() { if (state.open) { state.open = false; state.active = -1; panel.classList.remove('open'); setAria('false'); } }
    function setAria(v) { fn.setAttribute('aria-expanded', v); ln.setAttribute('aria-expanded', v); }

    function clearPlace() {
      placeEl.value = '';
      var detEl = $('detected-specialty');
      if (detEl) detEl.value = '';
      if (root && root.dataset) {
        ['placeId', 'rawPlaceName', 'formattedAddress', 'city', 'detectedSpecialty', 'doctorFullName']
          .forEach(function (k) { delete root.dataset[k]; });
      }
      if (typeof window.__updateSpecialtyConflict === 'function') window.__updateSpecialtyConflict();
    }

    function renderState(html) { panel.innerHTML = html; open(); }

    function renderResults(items, q) {
      state.items = items;
      if (!items.length) {
        renderState('<div class="dr-ac-state">No verified doctor found. Try adding city or checking spelling.</div>');
        state.active = -1;
        return;
      }
      var rows = items.map(function (it, i) {
        var meta = [];
        if (it.specialty) meta.push(esc(it.specialty));
        if (it.clinicName) meta.push(esc(it.clinicName));
        if (it.city) meta.push(esc(it.city));
        var metaHtml = meta.join('<span class="dot">·</span>');
        var rate = (it.rating > 0)
          ? '<span class="dr-ac-rate">' + STAR + esc(it.rating.toFixed(1)) +
            (it.reviewCount ? ' (' + it.reviewCount + ')' : '') + '</span>'
          : '';
        return '<div class="dr-ac-opt" role="option" id="' + cfg.panel + '-opt-' + i + '" data-idx="' + i + '">' +
          PIN +
          '<div class="dr-ac-main">' +
            '<div class="dr-ac-name">' + highlight(it.doctorName, q) + '</div>' +
            (metaHtml ? '<div class="dr-ac-meta">' + metaHtml + '</div>' : '') +
          '</div>' + rate +
        '</div>';
      });
      rows.push('<div class="dr-ac-foot">Verified Google Places results only</div>');
      renderState(rows.join(''));
      state.active = -1;
    }

    function fetchSuggestions(q) {
      if (state.ctrl) { try { state.ctrl.abort(); } catch (e) {} }
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      state.ctrl = ctrl;
      renderState('<div class="dr-ac-state"><span class="dr-ac-spin"></span>Searching verified doctors…</div>');

      var url = '/api/doctors/autocomplete?query=' + encodeURIComponent(q) +
                (cityEl && norm(cityEl.value) ? '&city=' + encodeURIComponent(norm(cityEl.value)) : '');

      fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (data) {
          if (state.ctrl !== ctrl) return;             // a newer request superseded this one
          if (norm(query()) !== q) return;             // input changed since
          renderResults(Array.isArray(data) ? data : [], q);
        })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return;
          if (state.ctrl !== ctrl) return;
          renderState('<div class="dr-ac-state">No verified doctor found. Try adding city or checking spelling.</div>');
          state.items = []; state.active = -1;
        });
    }

    function onInput() {
      clearPlace();                                   // manual edit invalidates a prior selection
      if (state.timer) clearTimeout(state.timer);
      var q = query();
      if (q.length < MIN_CHARS) { close(); return; }
      state.lastQuery = q;
      state.timer = setTimeout(function () { fetchSuggestions(q); }, DEBOUNCE);
    }

    function options() { return panel.querySelectorAll('.dr-ac-opt'); }
    function paint() {
      var els = options();
      for (var i = 0; i < els.length; i++) {
        var on = (parseInt(els[i].getAttribute('data-idx'), 10) === state.active);
        els[i].classList.toggle('active', on);
        if (on) { fn.setAttribute('aria-activedescendant', els[i].id); if (els[i].scrollIntoView) els[i].scrollIntoView({ block: 'nearest' }); }
      }
    }

    function pick(i) {
      var it = state.items[i];
      if (!it) return;
      // Split "Dr. First Last ..." into first / last for the existing two fields.
      // Parse the messy Google Places title into clean structured fields.
      // Never put clinic/hospital/marketing/location text into the name fields.
      var parsed = (window.DoctorNameParser && window.DoctorNameParser.parseDoctorPlaceResult)
        ? window.DoctorNameParser.parseDoctorPlaceResult(it)
        : null;

      if (parsed && parsed.firstName) {
        fn.value = parsed.firstName;
        ln.value = parsed.lastName;
      } else {
        // Fallback (parser unavailable): strip a leading "Dr." only.
        var clean = norm(String(it.doctorName).replace(/^dr\.?\s+/i, ''));
        var parts = clean.split(' ');
        fn.value = parts[0] || clean;
        ln.value = parts.slice(1).join(' ');
      }

      placeEl.value = it.placeId || '';

      // Store the structured, verified result (req. 1) — form values stay clean,
      // these power conflict-checking and final verification.
      var detected = (parsed && parsed.specialty) || it.specialty || '';
      if (root && root.dataset) {
        root.dataset.placeId          = it.placeId || '';
        root.dataset.rawPlaceName     = (parsed && parsed.rawPlaceName) || it.doctorName || '';
        root.dataset.formattedAddress = (parsed && parsed.formattedAddress) || it.address || '';
        root.dataset.city             = (parsed && parsed.city) || it.city || '';
        root.dataset.detectedSpecialty = detected;
        root.dataset.doctorFullName   = (parsed && parsed.fullName) || '';
      }
      var detEl = $('detected-specialty');
      if (detEl) detEl.value = detected;

      // Auto-fill city (the doctor's real city → guarantees the verification match)
      var fillCity = (parsed && parsed.city) || it.city || '';
      if (fillCity && cityEl) {
        cityEl.value = fillCity;
        try { cityEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
      }

      // Specialty: auto-fill if empty; if it conflicts with a pre-selected one,
      // surface a warning and block report generation until corrected.
      var setSp = window.__spCombobox && window.__spCombobox.setByName;
      var curSp = ($('sp') || {}).value || '';
      if (detected) {
        if (!curSp && setSp) { window.__spCombobox.setByName(detected); }
      }
      if (typeof window.__updateSpecialtyConflict === 'function') window.__updateSpecialtyConflict();

      // clear name field errors
      ['ef', 'el'].forEach(function (eid) {
        var e = $(eid); if (e) e.classList.remove('on');
      });
      fn.classList.remove('err'); ln.classList.remove('err');
      close();
    }

    function onKeydown(e) {
      if (!state.open) {
        if ((e.key === 'ArrowDown') && query().length >= MIN_CHARS) { fetchSuggestions(query()); }
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); state.active = Math.min(state.items.length - 1, state.active + 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); state.active = Math.max(0, state.active - 1); paint(); }
      else if (e.key === 'Enter') { if (state.active >= 0) { e.preventDefault(); pick(state.active); } }
      else if (e.key === 'Escape') { close(); }
    }

    [fn, ln].forEach(function (el) {
      el.addEventListener('input', onInput);
      el.addEventListener('keydown', onKeydown);
      el.addEventListener('focus', function () { if (query().length >= MIN_CHARS && state.items.length) open(); });
      el.addEventListener('blur', function () {
        setTimeout(function () { if (!root.contains(document.activeElement)) close(); }, 150);
      });
    });

    // mousedown so the pick fires before the input blur closes the panel
    panel.addEventListener('mousedown', function (e) {
      var opt = e.target.closest ? e.target.closest('.dr-ac-opt') : null;
      if (!opt) return;
      e.preventDefault();
      pick(parseInt(opt.getAttribute('data-idx'), 10));
    });

    document.addEventListener('click', function (e) { if (!root.contains(e.target)) close(); });

    return { close: close, get placeId() { return placeEl.value; } };
  }

  window.DoctorAutocomplete = { init: init };

  function auto() {
    if ($('name-ac') && $('fn') && $('ln') && $('dr-ac-panel')) {
      window.__drAutocomplete = init({
        root: 'name-ac', fn: 'fn', ln: 'ln', city: 'ct',
        placeId: 'place-id', panel: 'dr-ac-panel'
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto);
  else auto();
})();
