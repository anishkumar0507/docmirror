/* Region-aware price display.
 *
 * Fetches /api/client-config (which resolves the buyer's region server-side from
 * geo IP, or an explicit ?region= override) and fills every element carrying a
 * data-price attribute with the correct currency + amount.
 *
 *   <span data-price="report"></span>                   -> symbol + amount
 *   <span data-price="monitor" data-price-full></span>  -> ... plus "/month"
 *   <span data-price="agency"  data-price-full></span>
 *   <span data-price-symbol></span>                     -> just "₹" or "$"
 *
 * For text built in JS (button labels, injected HTML) use TDMPricing.get(),
 * or inject [data-price] spans and call TDMPricing.refresh(container).
 *
 * NO PRICE IS EVER WRITTEN IN THE MARKUP. Every price element ships with an
 * em dash as its pre-load placeholder, never a number: a number baked into HTML
 * survives a price change in lib/pricing.js and is then shown to buyers while
 * a different amount is charged — the exact failure this module exists to stop.
 * Changing a price must mean editing lib/pricing.js (or env) and nothing else.
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

  // Fill every [data-price] under `root` (default: the document). A root lets a
  // page re-fill a fragment it just injected, instead of re-scanning everything.
  function apply(prices, root) {
    if (!prices) return;
    var scope = root || document;
    var els = scope.querySelectorAll('[data-price]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var p = prices[el.getAttribute('data-price')];
      if (!p) continue;
      el.textContent = el.hasAttribute('data-price-full') ? p.display : p.bare;
    }
    // Bare currency symbol, for copy like "<symbol>0 forever" where there is no
    // amount to look up but the symbol must still follow the region.
    if (prices.symbol) {
      var syms = scope.querySelectorAll('[data-price-symbol]');
      for (var j = 0; j < syms.length; j++) syms[j].textContent = prices.symbol;
    }
  }

  // Price as a STRING, for text a page builds in JS (button labels, injected
  // HTML) where a [data-price] span cannot be used. Returns `fallback` when the
  // config has not loaded yet, so a page never renders an empty price.
  // Callers pass no fallback: the default is an em dash, never a number, for the
  // same reason the markup carries none.
  //   get('report')          -> the report price, bare
  //   get('monitor', true)   -> the monitor price with its period suffix
  function get(product, full, fallback) {
    var p = window.TDM_PRICING && window.TDM_PRICING.prices && window.TDM_PRICING.prices[product];
    if (!p) return fallback == null ? '—' : fallback;
    return full ? p.display : p.bare;
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
    get: get,
    // Re-fill [data-price] spans inside markup that was injected after boot.
    refresh: function (root) {
      apply(window.TDM_PRICING && window.TDM_PRICING.prices, root);
    },
    // Region currently in effect: explicit session choice, else whatever geo resolved.
    region: function () {
      return storedRegion() || (window.TDM_PRICING && window.TDM_PRICING.region) || '';
    },
    // Force a region (from the currency toggle): persist, re-fetch, re-render.
    setRegion: function (r) { setStoredRegion(r); return (window.TDMPricing.ready = load(r)); },
    stored: storedRegion,
  };

  // Resolves once prices have loaded (or failed). Pages that build markup at load
  // time can wait on it before calling refresh(), instead of racing the fetch.
  window.TDMPricing.ready = null;
  function boot() { window.TDMPricing.ready = load(storedRegion()); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
