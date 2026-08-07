/* Company entity fill for pages that do NOT render the shared footer
 * (checkout / auth-style pages). Fills [data-company="key"] elements from
 * lib/company.js via /api/client-config — same single source of truth as the
 * footer in layout.js, just standalone for pages without it. Empty values hide
 * their [data-company-row] wrapper. Nothing hardcodes the entity name here. */
(function () {
  'use strict';
  function fill(company) {
    if (!company) return;
    var els = document.querySelectorAll('[data-company]');
    for (var i = 0; i < els.length; i++) {
      var el  = els[i];
      var val = company[el.getAttribute('data-company')];
      var row = el.closest('[data-company-row]');
      if (val) {
        el.textContent = val;
        if (el.hasAttribute('data-company-mailto')) el.setAttribute('href', 'mailto:' + val);
        if (el.hasAttribute('data-company-tel'))    el.setAttribute('href', 'tel:' + val.replace(/\s+/g, ''));
        if (row) row.hidden = false;
      } else if (row) {
        row.hidden = true;
      }
    }
  }
  function run() {
    if (!document.querySelector('[data-company]')) return;
    fetch('/api/client-config', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (cfg) { fill(cfg && cfg.company); })
      .catch(function () {});
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
