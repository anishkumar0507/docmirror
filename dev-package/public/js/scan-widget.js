/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — Scan Widget

   The homepage scan flow ("Show me what patients see"), extracted verbatim
   from index.html so the dashboard "Add doctor" modal can run the SAME code
   instead of a second copy that would drift.

   This file is a MOVE, not a rewrite: every function below is the homepage's
   original logic. The only changes are mechanical:
     • element ids come from cfg.ids instead of being hard-coded
     • the three audit outcomes (success / needsSelection / verify-fail) go
       through overridable hooks — the defaults do exactly what the homepage
       did (store the report + navigate, render #ds, render #vf)
     • getElementById results are null-guarded so a host page that has no
       #rs / #nf / #wl / #demo-strip doesn't throw. On the homepage all of
       those exist, so the guards never change what happens.

   Usage:
     var scan = TDMScan.create();                 // homepage defaults
     var scan = TDMScan.create({ ids: {...}, onSuccess: fn, ... });

   Instance: run() · runUrl() · audit(params) · reset() · noneOfThese()
             · toggleUrlPanel(btn) · abort()
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  function $(id) { return id ? document.getElementById(id) : null; }

  // Shallow merge — one level deep for the nested `ids` group.
  function merge(base, over) {
    var out = {}, k;
    for (k in base) out[k] = base[k];
    if (!over) return out;
    for (k in over) {
      if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] && typeof base[k] === 'object') {
        out[k] = merge(base[k], over[k]);
      } else if (over[k] !== undefined) {
        out[k] = over[k];
      }
    }
    return out;
  }

  var DEFAULTS = {
    apiUrl: '/api/audit',
    // Flip to false once /api/audit is not live — falls back to the seeded
    // free preview, exactly as the homepage did.
    apiReady: true,
    reportUrl: '/pages/preview-report.html',

    ids: {
      // form fields
      fn: 'fn', ln: 'ln', sp: 'sp', spParent: 'sp-parent', ct: 'ct', placeId: 'place-id',
      spInput: 'sp-input',
      // field wrappers + their error elements, in fn / ln / sp / city order
      wrapFn: 'ff', errFn: 'ef',
      wrapLn: 'fl', errLn: 'el',
      wrapSp: 'fsp', errSp: 'esp',
      wrapCt: 'fct', errCt: 'ect',
      // free-text / maps URL row
      urlInput: 'mu', urlPanel: 'url-panel',
      // states
      form: 'inp', loading: 'ls', timeoutMsg: 'tm', toolErr: 'tool-err',
      selection: 'ds', selectionBody: 'ds-body', selectionList: 'ds-list',
      verifyFail: 'vf', vfTitle: 'vf-title', vfMsg: 'vf-msg',
      demoStrip: 'demo-strip',
      // reset()
      scrollTarget: 'tool', waitlist: 'wl',
      // loading steps: <stepPrefix>N row + <iconPrefix>N icon
      stepPrefix: 's', iconPrefix: 'i'
    },
    steps: 5,
    resetStates: ['ls', 'rs', 'nf', 'vf', 'ds'],
    // localStorage keys cleared before every run and on a failed verification
    staleKeys: ['docmirrorPreviewReport', 'tdm_free_preview'],
    storeKey: 'docmirrorPreviewReport',
    freePreviewKey: 'tdm_free_preview',

    // ── Hooks (defaults = the homepage's behaviour) ───────────────────────
    onSuccess: null,        // (data, params)  → store report + go to report page
    onSelection: null,      // (matches, params, data) → render the #ds picker
    onVerifyFail: null,     // (data, params)  → render the #vf card
    onNetworkError: null,   // (err, params)   → show #tool-err
    onNotReady: null,       // (params)        → runFreePreview
    onNotReadyUrl: null,    // ()              → window.showWL()
    bindFieldErrors: true   // attach the "clear the error as you type" listeners
  };

  function create(userCfg) {
    var cfg = merge(DEFAULTS, userCfg || {});
    var ids = cfg.ids;

    var _ac = null;      // in-flight audit, so a new run cancels the old one
    var _tm = null;      // "taking a moment longer" timer
    var _dsParams = null; // params that produced the current selection list

    // ── FIELD HELPERS ───────────────────────────────────────────────────────
    function setErr(fid, eid, on) {
      var f = $(fid), e = $(eid);
      if (!f) return;
      var inp = f.querySelector('input,select');
      if (inp) inp.classList.toggle('err', on);
      if (e) e.classList.toggle('on', on);
    }

    var FIELD_PAIRS = [
      [ids.wrapFn, ids.errFn], [ids.wrapLn, ids.errLn],
      [ids.wrapSp, ids.errSp], [ids.wrapCt, ids.errCt]
    ];

    function clearAll() {
      FIELD_PAIRS.forEach(function (p) { setErr(p[0], p[1], false); });
    }

    function bindFieldErrors() {
      [[ids.fn, ids.wrapFn, ids.errFn], [ids.ln, ids.wrapLn, ids.errLn], [ids.ct, ids.wrapCt, ids.errCt]]
        .forEach(function (t) {
          var el = $(t[0]);
          if (el) el.addEventListener('input', function () { setErr(t[1], t[2], false); });
        });
      var spEl = $(ids.sp);
      if (spEl) spEl.addEventListener('change', function () {
        setErr(ids.wrapSp, ids.errSp, false);
        if (window.__updateSpecialtyConflict) window.__updateSpecialtyConflict();
      });
      var si = $(ids.spInput);
      if (si) si.addEventListener('input', function () { setErr(ids.wrapSp, ids.errSp, false); });
    }

    // ── VALIDATE ────────────────────────────────────────────────────────────
    function validate() {
      clearAll();
      var ok = true;
      var fn = val(ids.fn).trim(), ln = val(ids.ln).trim();
      var sp = val(ids.sp).trim(), ct = val(ids.ct).trim();
      if (!fn) { setErr(ids.wrapFn, ids.errFn, true); ok = false; }
      if (!ln) { setErr(ids.wrapLn, ids.errLn, true); ok = false; }
      if (!sp) { setErr(ids.wrapSp, ids.errSp, true); ok = false; }
      if (!ct || ct.length < 2) { setErr(ids.wrapCt, ids.errCt, true); ok = false; }
      if (!ok) {
        var first = document.querySelector('.field input.err,.field select.err');
        if (first) first.focus();
      }
      return ok;
    }

    function val(id) { var e = $(id); return (e && e.value) || ''; }

    function clearStale() {
      try {
        cfg.staleKeys.forEach(function (k) { localStorage.removeItem(k); });
      } catch (e) { /* private mode — non-fatal */ }
    }

    // ── RUN CHECK ───────────────────────────────────────────────────────────
    function run() {
      var fn = val(ids.fn).trim();
      var ln = val(ids.ln).trim();
      var sp = val(ids.sp).trim();
      var spp = val(ids.spParent).trim();
      var ct = val(ids.ct).trim();

      if (!validate()) return;

      // Specialty vs Google category is INFORMATIONAL only — refresh the notice
      // but never block. The doctor's selected specialty is always respected.
      if (window.__updateSpecialtyConflict) window.__updateSpecialtyConflict();

      // Clear any stale report data from previous sessions before starting fresh
      clearStale();

      var placeId = val(ids.placeId);
      var p = { fn: fn, ln: ln, sp: sp, spp: spp, ct: ct, placeId: placeId.trim() };
      if (!cfg.apiReady) {
        return (cfg.onNotReady || runFreePreview)({ fn: fn, ln: ln, sp: sp, ct: ct });
      }
      audit(p);
    }

    // ── FREE-TEXT / MAPS URL ROW ────────────────────────────────────────────
    function runUrl() {
      var inp = $(ids.urlInput);
      if (!inp) return;
      var value = inp.value.trim();
      var urlRe = /^https?:\/\/(www\.)?(maps\.google|google\.com\/maps|goo\.gl|g\.page)/i;

      if (!value) { inp.style.borderColor = 'var(--red)'; inp.focus(); return; }
      inp.style.borderColor = '';

      if (!cfg.apiReady) {
        if (cfg.onNotReadyUrl) cfg.onNotReadyUrl();
        else if (window.showWL) window.showWL();
        return;
      }

      clearStale();

      if (urlRe.test(value)) {
        // Clean Google Maps URL — use directly
        audit({ mapsUrl: value });
      } else {
        // Name or clinic name — pass as free text search.
        // Strip "Dr." prefix if present, split into first/last.
        var clean = value.replace(/^Dr\.?\s*/i, '').trim();
        var parts = clean.split(/\s+/);
        audit({ fn: parts[0] || clean, ln: parts.slice(1).join(' ') || '', freeText: value });
      }
    }

    // ── AUDIT (real API) ────────────────────────────────────────────────────
    // Navigate to the report after an audit. Breaks out of the Pricing modal
    // iframe (top window) when embedded, and carries the selected plan
    // (?plan=audit|monitor) forward so the report continues to the correct
    // checkout. Homepage (non-embed) audits have no plan param.
    function goReport() {
      var plan = null;
      try { plan = (new URLSearchParams(location.search)).get('plan'); } catch (e) {}
      var url = cfg.reportUrl + ((plan === 'audit' || plan === 'monitor') ? ('?plan=' + plan) : '');
      (window.top && window.top !== window.self ? window.top : window).location.href = url;
    }

    async function audit(p) {
      hide(ids.form);
      addClass(ids.loading, 'active');
      setS(1, 'spin');
      setTimeout(function () { setS(2, 'spin'); }, 600);
      _tm = setTimeout(function () { addClass(ids.timeoutMsg, 'on'); }, 8000);
      if (_ac) _ac.abort();
      _ac = new AbortController();
      try {
        var r = await fetch(cfg.apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p),
          signal: _ac.signal
        });
        setS(3, 'spin'); await wait(300); setS(4, 'spin');
        if (!r.ok) throw new Error('err ' + r.status);
        var d = await r.json();
        setS(5, 'spin'); await wait(400);
        for (var i = 1; i <= cfg.steps; i++) setS(i, 'dn');
        clearTimeout(_tm); await wait(600);
        if (d.needsSelection && d.matches && d.matches.length) {
          // Several plausible listings — let the user pick the right one.
          clearStale();
          (cfg.onSelection || showDidYouMean)(d.matches, p, d);
        } else if (d.verified === false || d.notFound) {
          // Verification failed — never store or show preview/competitor data.
          clearStale();
          (cfg.onVerifyFail || showVF)(d, p);
        } else if (cfg.onSuccess) {
          cfg.onSuccess(d, p);
        } else {
          try { localStorage.setItem(cfg.storeKey, JSON.stringify(d)); } catch (e2) {}
          goReport();
        }
      } catch (e) {
        clearTimeout(_tm);
        if (e.name === 'AbortError') return;
        if (cfg.onNetworkError) { cfg.onNetworkError(e, p); return; }
        removeClass(ids.loading, 'active');
        show(ids.form, 'block');
        var te = $(ids.toolErr);
        if (te) {
          te.textContent = 'Could not reach the server. Please try again in a moment.';
          te.classList.add('on');
        }
      }
    }

    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    var TICK = '<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>';

    function setS(n, st) {
      var el = $(ids.stepPrefix + n), ic = $(ids.iconPrefix + n);
      if (!el || !ic) return;
      el.classList.add('vis');
      if (st === 'spin') {
        ic.className = 's-icon spin';
        if (n > 1) {
          var pi = $(ids.iconPrefix + (n - 1)), ps = $(ids.stepPrefix + (n - 1));
          if (pi) { pi.className = 's-icon dn'; pi.innerHTML = TICK; }
          if (ps) ps.classList.add('done');
        }
      } else if (st === 'dn') {
        ic.className = 's-icon dn';
        ic.innerHTML = TICK;
        el.classList.add('done');
      }
    }

    // ── VERIFY-FAIL CARD ────────────────────────────────────────────────────
    // Could not verify this listing — a soft, reason-aware card (NOT alarming).
    // GMB-missing is NOT handled here (it returns verified:true → limited report).
    function showVF(d, p) {
      removeClass(ids.loading, 'active');
      hide(ids.form);
      var reason = (d && d.reason) || '';
      var titleEl = $(ids.vfTitle);
      if (titleEl) {
        titleEl.textContent = reason === 'city_mismatch'
          ? "We couldn't find this doctor in that city"
          : "We couldn't confirm this listing";
      }
      var msg = (d && d.message) ? d.message
        : "Please double-check the name, city and specialty, then try again.";
      var el = $(ids.vfMsg); if (el) el.textContent = msg;
      addClass(ids.verifyFail, 'active');
      scrollTo(ids.verifyFail);
    }

    // ── "PLEASE SELECT YOURS" ───────────────────────────────────────────────
    // Render candidate profiles; picking one re-runs the audit with that exact
    // placeId (the trusted path). "None of these" generates a GMB-missing
    // report (never another clinic's data).
    function showDidYouMean(matches, p, d) {
      _dsParams = p;
      removeClass(ids.loading, 'active');
      hide(ids.form);
      var body = $(ids.selectionBody);
      if (body && d && d.message) body.textContent = d.message;
      var list = $(ids.selectionList);
      if (list) {
        list.innerHTML = '';
        matches.forEach(function (m) {
          list.appendChild(buildMatchItem(m, function () {
            removeClass(ids.selection, 'active');
            selectMatch(m, p);
          }));
        });
      }
      addClass(ids.selection, 'active');
      scrollTo(ids.selection);
    }

    // One candidate row. Exposed so a host (the dashboard modal) can render the
    // same card markup into its own container.
    function buildMatchItem(m, onPick) {
      var item = document.createElement('div');
      item.className = 'ds-item';
      item.innerHTML = '<div class="ds-info"><span class="ds-name"></span><span class="ds-addr"></span><span class="ds-meta2"></span></div><button type="button" class="ds-use">Use this profile</button>';
      item.querySelector('.ds-name').textContent = m.name || 'Listing';
      item.querySelector('.ds-addr').textContent = m.address || '';
      var meta = (m.rating != null ? ('★ ' + m.rating + ' · ') : '') + (m.reviewCount || 0) + ' reviews';
      var metaEl = item.querySelector('.ds-meta2');
      metaEl.textContent = meta;
      if (m.website) {
        metaEl.appendChild(document.createTextNode(' · '));
        var a = document.createElement('a');
        a.className = 'ds-web'; a.href = m.website; a.target = '_blank';
        a.rel = 'noopener'; a.textContent = 'Website';
        metaEl.appendChild(a);
      }
      item.querySelector('.ds-use').onclick = onPick;
      return item;
    }

    // Re-run the audit pinned to one exact Google listing.
    function selectMatch(m, p) {
      p = p || _dsParams || {};
      var np = {}; for (var k in p) np[k] = p[k];
      np.placeId = m.placeId; np.gmbMissing = false;
      audit(np);
    }

    // "None of these" → no GMB for this exact doctor → limited GMB-missing report.
    function noneOfThese() {
      removeClass(ids.selection, 'active');
      var p = _dsParams || {};
      var np = {}; for (var k in p) np[k] = p[k];
      np.gmbMissing = true; np.placeId = '';
      audit(np);
    }

    // ── RESET ───────────────────────────────────────────────────────────────
    function reset() {
      cfg.resetStates.forEach(function (id) {
        var el = $(id); if (el) el.classList.remove('active', 'on');
      });
      show(ids.form, 'block');
      removeClass(ids.waitlist, 'on');
      removeClass(ids.timeoutMsg, 'on');
      removeClass(ids.toolErr, 'on');
      clearAll();
      scrollTo(ids.scrollTarget);
    }

    // ── FREE PREVIEW FLOW (only when apiReady === false) ────────────────────
    var _imul = Math.imul || function (a, b) {
      var ah = (a >>> 16) & 0xffff, al = a & 0xffff, bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
      return ((al * bh + ah * bl) << 16) + (al * bl) | 0;
    };
    function _strSeed(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (_imul(31, h) + s.charCodeAt(i)) | 0; return (h >>> 0) || 1; }
    function _mkRng(seed) { var s = seed >>> 0; return function (lo, hi) { s = (_imul(1664525, s) + 1013904223) >>> 0; return lo + (s % (hi - lo + 1)); }; }

    function calculateFreeVisibilityScore(p) {
      var seed = _strSeed((p.fn + p.ln + p.sp + p.ct).toLowerCase().replace(/\s+/g, ''));
      var r = _mkRng(seed);
      var base = 42 + (p.sp ? 5 : 0) + (p.ct && p.ct.length > 2 ? 4 : 0) + r(0, 21) - 8;
      var google = Math.min(88, Math.max(28, base + r(4, 14)));
      var chatgpt = Math.min(google - 3, Math.max(15, google - r(8, 22)));
      var gemini = Math.min(chatgpt + 3, Math.max(12, chatgpt - r(2, 10)));
      var claude = Math.min(gemini, Math.max(10, gemini - r(2, 8)));
      var overall = Math.round((google + chatgpt + gemini + claude) / 4);
      return {
        doctorName: 'Dr. ' + p.fn + ' ' + p.ln, specialty: p.sp, cityState: p.ct,
        overallScore: overall, googleScore: google, chatgptScore: chatgpt,
        geminiScore: gemini, claudeScore: claude,
        reviewStrength: r(15, 70), competitorGap: 0, competitors: []
      };
    }

    function runFreePreview(p) {
      hide(ids.form);
      hide(ids.demoStrip);
      addClass(ids.loading, 'active');
      setS(1, 'spin');
      setTimeout(function () { setS(2, 'spin'); }, 480);
      setTimeout(function () { setS(3, 'spin'); }, 960);
      setTimeout(function () { setS(4, 'spin'); }, 1440);
      setTimeout(function () {
        setS(5, 'spin');
        var result = calculateFreeVisibilityScore(p);
        try { localStorage.setItem(cfg.freePreviewKey, JSON.stringify(result)); } catch (e) {}
        setTimeout(function () { goReport(); }, 380);
      }, 1920);
    }

    // ── URL TOGGLE ──────────────────────────────────────────────────────────
    function toggleUrlPanel(btn) {
      var p = $(ids.urlPanel);
      if (!p) return;
      var open = p.classList.toggle('open');
      if (btn) btn.setAttribute('aria-expanded', String(open));
    }

    // ── tiny DOM helpers (null-safe) ────────────────────────────────────────
    function addClass(id, c) { var e = $(id); if (e) e.classList.add(c); }
    function removeClass(id, c) { var e = $(id); if (e) e.classList.remove(c); }
    function hide(id) { var e = $(id); if (e) e.style.display = 'none'; }
    function show(id, disp) { var e = $(id); if (e) e.style.display = disp; }
    function scrollTo(id) { var e = $(id); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

    if (cfg.bindFieldErrors) bindFieldErrors();

    return {
      cfg: cfg,
      run: run,
      runUrl: runUrl,
      audit: audit,
      validate: validate,
      reset: reset,
      noneOfThese: noneOfThese,
      selectMatch: selectMatch,
      buildMatchItem: buildMatchItem,
      toggleUrlPanel: toggleUrlPanel,
      clearErrors: clearAll,
      setFieldError: setErr,
      goReport: goReport,
      abort: function () { if (_ac) _ac.abort(); clearTimeout(_tm); }
    };
  }

  window.TDMScan = { create: create, DEFAULTS: DEFAULTS };
})();
