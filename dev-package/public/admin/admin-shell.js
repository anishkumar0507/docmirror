/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — admin shell

   Renders the sidebar and top bar every signed-in admin page shares, so the
   navigation lives in one file instead of being copied into each page. Same
   idea as /js/layout.js on the public site — except this one is never loaded
   by a public page, and the public one is never loaded here: the marketing nav
   and footer have no place behind a login.

   Usage:
     <div class="adm-app">
       <aside class="adm-side" id="adm-side"></aside>
       <div class="adm-content">
         <header class="adm-bar" id="adm-bar"></header>
         <div class="adm-body"> … page … </div>
       </div>
     </div>
     AdminShell.mount({ active: 'blogs', title: 'Add Blog', actions: '<button…>' });
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var ICONS = {
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    blogs:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>',
    media:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
    categories:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h4v4H3zM3 15h4v4H3z"/><path d="M11 7h10M11 17h10"/></svg>',
    logout:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg>',
  };

  var NAV = [
    { key: 'dashboard',  href: '/admin',            label: 'Dashboard' },
    { key: 'blogs',      href: '/admin/blogs',      label: 'Blogs' },
    { key: 'media',      href: '/admin/media',      label: 'Media' },
    { key: 'categories', href: '/admin/categories', label: 'Categories' },
  ];

  var LOGO =
    '<div class="adm-logo">' +
    '<span class="adm-logo-mark"><svg viewBox="0 0 18 18" fill="none" aria-hidden="true">' +
    '<circle cx="9" cy="9" r="7.5" stroke="#00A878" stroke-width="1.3"/>' +
    '<path d="M5.5 9C5.5 7 7 5.5 9 5.5S12.5 7 12.5 9" stroke="white" stroke-width="1.3" stroke-linecap="round"/>' +
    '<circle cx="9" cy="12" r="1.3" fill="#00A878"/></svg></span>' +
    '<span class="adm-logo-word">The Doc <span>Mirror</span></span>' +
    '<span class="adm-logo-tag">Admin</span>' +
    '</div>';

  function mount(opts) {
    opts = opts || {};

    var side = document.getElementById('adm-side');
    if (side) {
      var links = NAV.map(function (n) {
        var active = n.key === opts.active ? ' class="is-active"' : '';
        return '<a href="' + n.href + '"' + active + '>' + ICONS[n.key] + '<span>' + n.label + '</span></a>';
      }).join('');

      side.innerHTML =
        '<div class="adm-side-brand"><a href="/admin" style="text-decoration:none">' + LOGO + '</a></div>' +
        '<nav class="adm-side-nav" aria-label="Admin sections">' + links + '</nav>' +
        '<div class="adm-side-foot"><button type="button" id="adm-logout">' + ICONS.logout + '<span>Logout</span></button></div>';

      var out = document.getElementById('adm-logout');
      if (out) out.addEventListener('click', function () { AdminAuth.logout(); });
    }

    var bar = document.getElementById('adm-bar');
    if (bar) {
      bar.innerHTML =
        '<h1>' + AdminAuth.escapeHtml(opts.title || 'Admin') + '</h1>' +
        '<div class="adm-bar-right">' +
        (opts.actions || '') +
        '<span class="adm-who">Signed in as <strong id="adm-who-email">—</strong></span>' +
        '</div>';
    }
  }

  function setEmail(email) {
    var el = document.getElementById('adm-who-email');
    if (el) el.textContent = email || '—';
  }

  window.AdminShell = { mount: mount, setEmail: setEmail, ICONS: ICONS };
})();
