/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — Specialty Combobox (vanilla, dependency-free)

   A searchable, grouped, keyboard-accessible specialty picker backed by the
   shared master list in medical-specialties.js. Replaces the native <select>.

   Features: debounced search · category headings · max-height scroll ·
   no-result state · manual exact entry only when nothing matches · writes a
   NORMALIZED value (+ parentSpecialty) to hidden inputs for the backend.

   Usage:
     <div class="sp-cb" id="sp-combobox">
       <input class="sp-cb-input" id="sp-input" role="combobox" ...>
       <input type="hidden" id="sp">          // normalized specialty name
       <input type="hidden" id="sp-parent">   // parentSpecialty
       <div class="sp-cb-panel" id="sp-cb-list" role="listbox"></div>
     </div>
     SpecialtyCombobox.init({ root:'sp-combobox', input:'sp-input',
                              value:'sp', parent:'sp-parent', list:'sp-cb-list' });
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var MAX_RESULTS = 80;     // cap rendered options (panel scrolls)
  var DEBOUNCE_MS = 150;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function normalizeValue(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  function init(cfg) {
    var DB = (typeof window !== 'undefined' && window.MEDICAL_SPECIALTIES) || null;
    var root   = $(cfg.root);
    var input  = $(cfg.input);
    var hidden = $(cfg.value);
    var parent = $(cfg.parent);
    var panel  = $(cfg.list);
    if (!DB || !root || !input || !hidden || !panel) {
      if (input) input.placeholder = 'Specialty';
      return null;
    }

    var state = { open: false, active: -1, options: [], timer: null, selected: null };

    function setValue(name, parentSpecialty) {
      var v = normalizeValue(name);
      hidden.value = v;
      if (parent) parent.value = normalizeValue(parentSpecialty || name);
      input.value = v;
      state.selected = v;
      input.classList.remove('err');
      // let existing form logic clear the error state
      try { hidden.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    }

    function clearValue() {
      hidden.value = '';
      if (parent) parent.value = '';
      state.selected = null;
    }

    function close() {
      if (!state.open) return;
      state.open = false;
      state.active = -1;
      panel.classList.remove('open');
      input.setAttribute('aria-expanded', 'false');
    }

    function open() {
      if (state.open) return;
      state.open = true;
      panel.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
    }

    function render(query) {
      var q = normalizeValue(query);
      var results = DB.search(q, MAX_RESULTS);
      state.options = [];

      if (!results.length) {
        // No-result state + manual exact entry (only path to free text).
        var html = '<div class="sp-cb-empty">No matching specialty found.</div>';
        if (q) {
          html += '<div class="sp-cb-opt sp-cb-manual" role="option" data-idx="0" data-manual="1" data-name="' +
                  esc(q) + '">Use “<strong>' + esc(q) + '</strong>” as the specialty</div>';
          state.options.push({ name: q, parentSpecialty: q, manual: true });
        }
        panel.innerHTML = html;
        state.active = q ? 0 : -1;
        paintActive();
        open();
        return;
      }

      // Group by category, preserving the master category order.
      var byCat = {};
      var order = [];
      results.forEach(function (s) {
        if (!byCat[s.category]) { byCat[s.category] = []; order.push(s.category); }
        byCat[s.category].push(s);
      });
      // Order categories by their position in DB.CATEGORIES (stable), then leftovers.
      order.sort(function (a, b) {
        var ia = DB.CATEGORIES.indexOf(a), ib = DB.CATEGORIES.indexOf(b);
        return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
      });

      var out = [];
      var idx = 0;
      order.forEach(function (cat) {
        out.push('<div class="sp-cb-group" role="presentation">' + esc(cat) + '</div>');
        byCat[cat].forEach(function (s) {
          out.push(
            '<div class="sp-cb-opt" role="option" id="' + cfg.list + '-opt-' + idx + '" data-idx="' + idx +
            '" data-name="' + esc(s.name) + '" data-parent="' + esc(s.parentSpecialty) + '">' +
            '<span class="sp-cb-name">' + esc(s.name) + '</span>' +
            (s.parentSpecialty && s.parentSpecialty !== s.name
              ? '<span class="sp-cb-sub">' + esc(s.parentSpecialty) + '</span>' : '') +
            '</div>'
          );
          state.options.push({ name: s.name, parentSpecialty: s.parentSpecialty, manual: false });
          idx++;
        });
      });
      panel.innerHTML = out.join('');
      state.active = -1;
      open();
    }

    function optionEls() { return panel.querySelectorAll('.sp-cb-opt'); }

    function paintActive() {
      var els = optionEls();
      for (var i = 0; i < els.length; i++) {
        var on = (parseInt(els[i].getAttribute('data-idx'), 10) === state.active);
        els[i].classList.toggle('active', on);
        if (on) {
          input.setAttribute('aria-activedescendant', els[i].id || '');
          if (els[i].scrollIntoView) els[i].scrollIntoView({ block: 'nearest' });
        }
      }
      if (state.active < 0) input.removeAttribute('aria-activedescendant');
    }

    function choose(opt) {
      if (!opt) return;
      setValue(opt.name, opt.parentSpecialty);
      close();
    }

    function chooseByIndex(i) {
      var opt = state.options[i];
      choose(opt);
    }

    // ── Events ───────────────────────────────────────────────────────────────
    input.addEventListener('input', function () {
      clearValue(); // typing invalidates any previous selection
      if (state.timer) clearTimeout(state.timer);
      var q = input.value;
      state.timer = setTimeout(function () { render(q); }, DEBOUNCE_MS);
    });

    input.addEventListener('focus', function () {
      if (!state.open) render(input.value);
    });

    input.addEventListener('keydown', function (e) {
      if (!state.open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { render(input.value); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.active = Math.min(state.options.length - 1, state.active + 1);
        paintActive();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.active = Math.max(0, state.active - 1);
        paintActive();
      } else if (e.key === 'Enter') {
        if (state.open && state.active >= 0) { e.preventDefault(); chooseByIndex(state.active); }
      } else if (e.key === 'Escape') {
        close();
      }
    });

    // mousedown (not click) so selection fires before the input blur closes it
    panel.addEventListener('mousedown', function (e) {
      var opt = e.target.closest ? e.target.closest('.sp-cb-opt') : null;
      if (!opt) return;
      e.preventDefault();
      chooseByIndex(parseInt(opt.getAttribute('data-idx'), 10));
    });

    input.addEventListener('blur', function () {
      // Allow click selection to land first.
      setTimeout(function () {
        if (!state.selected) {
          // Accept an exactly-typed known specialty; otherwise leave empty.
          var hit = DB.findByName(input.value);
          if (hit) setValue(hit.name, hit.parentSpecialty);
        }
        close();
      }, 150);
    });

    document.addEventListener('click', function (e) {
      if (!root.contains(e.target)) close();
    });

    // Public per-instance API
    return {
      get value() { return hidden.value; },
      get parent() { return parent ? parent.value : ''; },
      reset: function () { input.value = ''; clearValue(); close(); },
      setByName: function (name) { var h = DB.findByName(name); if (h) setValue(h.name, h.parentSpecialty); }
    };
  }

  window.SpecialtyCombobox = { init: init };

  // Auto-init the default specialty field if present.
  function auto() {
    if ($('sp-combobox') && $('sp-input')) {
      window.__spCombobox = init({
        root: 'sp-combobox', input: 'sp-input', value: 'sp', parent: 'sp-parent', list: 'sp-cb-list'
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto);
  else auto();
})();
