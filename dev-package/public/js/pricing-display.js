/* Region-aware price display.
 *
 * Fetches /api/client-config (which resolves the buyer's region server-side from
 * geo IP, or an explicit ?region= override) and fills every element carrying a
 * data-price attribute with the correct currency + amount.
 *
 *   <span data-price="report"></span>        -> "$19"  or "₹1,828"   (bare: symbol+amount)
 *   <span data-price="monitor"></span>       -> "$49"  or "₹4,715"
 *   <span data-price="monitor" data-price-full></span> -> "$49/month" or "₹4,715/month"
 *
 * The in-HTML text is a static default; this only ever overwrites it once real
 * prices arrive, so a fetch failure leaves the page readable.
 */
(function () {
  'use strict';

  // An explicit currency choice (checkout toggle) is remembered for the session
  // so it survives the hop from report checkout to subscription checkout.
  function storedRegion() {
    try { return sessionStorage.getItem('tdm_region') || ''; } catch (e) { return ''; }
  }
  function setStoredRegion(r) {
    try { r ? sessionStorage.setItem('tdm_region', r) : sessionStorage.removeItem('tdm_region'); } catch (e) {}
  }

  function apply(prices) {
    if (!prices) return;
    var els = document.querySelectorAll('[data-price]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var p = prices[el.getAttribute('data-price')];
      if (!p) continue;
      el.textContent = el.hasAttribute('data-price-full') ? p.display : p.bare;
    }
  }

  function load(region) {
    var url = '/api/client-config' + (region ? ('?region=' + encodeURIComponent(region)) : '');
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        window.TDM_PRICING = cfg;
        if (cfg && cfg.prices) apply(cfg.prices);
        return cfg;
      })
      .catch(function (e) { console.warn('[pricing] load failed, keeping default prices', e); });
  }

  window.TDMPricing = {
    load: load,
    apply: apply,
    // Region currently in effect: explicit session choice, else whatever geo resolved.
    region: function () {
      return storedRegion() || (window.TDM_PRICING && window.TDM_PRICING.region) || '';
    },
    // Force a region (from the currency toggle): persist, re-fetch, re-render.
    setRegion: function (r) { setStoredRegion(r); return load(r); },
    stored: storedRegion,
  };

  function boot() { load(storedRegion()); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
