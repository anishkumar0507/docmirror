/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — Brand single source of truth
   (the vanilla-stack equivalent of /src/config/branding.ts + <Logo/>)

   • window.BRAND          — name, colours, asset paths
   • window.TDM_LOGO       — the ONLY official logo markup (mark + variants)
   • [data-tdm-logo]       — the ONLY way to render a logo in HTML:
        <span data-tdm-logo></span>                 → mark on dark container
        <span data-tdm-logo="light"></span>         → mark on a LIGHT container
        <span data-tdm-logo="full"></span>          → mark + "The Doc Mirror"
        add data-size="sm|md|lg" to size it.

   There is exactly ONE logo and ONE brand identity. Do not hand-author logo
   SVGs anywhere else — render through this module (or reference BRAND.logo).
   ────────────────────────────────────────────────────────────────────────── */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { window.BRAND = api.BRAND; window.TDM_LOGO = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BRAND = {
    name: 'The Doc Mirror',
    shortName: 'TDM',
    logo: '/assets/logo/thedocmirror-logo.svg',   // full lockup (mark + wordmark)
    mark: '/assets/logo/thedocmirror-mark.svg',   // mark only
    favicon: '/favicon.svg',
    appleTouchIcon: '/assets/logo/apple-touch-icon.png',
    ogImage: '/assets/logo/og-image.png',
    manifest: '/manifest.webmanifest',
    // Official brand colours (the app's existing palette; within rounding of the
    // brand spec navy #0B2545 / green #00A870).
    navy: '#0A2540',
    green: '#00A878',
    white: '#FFFFFF',
    primaryColor: '#0A2540',
    accentColor: '#00A878',
  };

  // The official "mirror" mark — the green ring + reflection arc + dot.
  // `arc` is the only colour that flips with the container background.
  function markSvg(arcColor) {
    return '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true">' +
      '<circle cx="9" cy="9" r="7.5" stroke="#00A878" stroke-width="1.3"/>' +
      '<path d="M5.5 9C5.5 7 7 5.5 9 5.5S12.5 7 12.5 9" stroke="' + arcColor + '" stroke-width="1.3" stroke-linecap="round"/>' +
      '<circle cx="9" cy="12" r="1.3" fill="#00A878"/></svg>';
  }
  var MARK_ON_DARK  = markSvg('#ffffff');   // for navy/dark containers (nav, footer)
  var MARK_ON_LIGHT = markSvg('#0A2540');   // for white/light containers (dashboard)

  var SIZES = { sm: 26, md: 32, lg: 40 };

  // Build a self-contained lockup: navy rounded square holding the mark, plus
  // an optional "The Doc Mirror" wordmark.
  function lockup(opts) {
    opts = opts || {};
    var px = SIZES[opts.size] || SIZES.md;
    var mark =
      '<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;' +
        'width:' + px + 'px;height:' + px + 'px;background:' + BRAND.navy + ';border-radius:' + Math.round(px / 4) + 'px;">' +
        '<span style="width:' + Math.round(px * 0.56) + 'px;height:' + Math.round(px * 0.56) + 'px;display:block;">' +
          MARK_ON_DARK +
        '</span></span>';
    if (!opts.wordmark) return mark;
    var word =
      '<span style="font-weight:800;letter-spacing:-.02em;font-size:' + Math.round(px * 0.5) + 'px;color:' + BRAND.navy + ';">' +
        'The Doc <span style="color:' + BRAND.green + '">Mirror</span></span>';
    return '<span style="display:inline-flex;align-items:center;gap:' + Math.round(px * 0.3) + 'px;">' + mark + word + '</span>';
  }

  // Replace the contents of any [data-tdm-logo] element with the official logo.
  function render(ctx) {
    var scope = ctx || document;
    var nodes = scope.querySelectorAll('[data-tdm-logo]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var variant = el.getAttribute('data-tdm-logo') || 'dark';
      var size = el.getAttribute('data-size') || 'md';
      if (variant === 'full') el.innerHTML = lockup({ size: size, wordmark: true });
      else if (variant === 'light') el.innerHTML = MARK_ON_LIGHT;
      else el.innerHTML = MARK_ON_DARK;   // bare mark; container supplies the navy square
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { render(); });
    else render();
  }

  return {
    BRAND: BRAND,
    MARK_ON_DARK: MARK_ON_DARK,
    MARK_ON_LIGHT: MARK_ON_LIGHT,
    lockup: lockup,
    render: render,
  };
});
