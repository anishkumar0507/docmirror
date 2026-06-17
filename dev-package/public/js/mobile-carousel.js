/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — mobile card carousel
   Turns stacked card groups into a smooth, auto-sliding, swipeable carousel
   ONLY on mobile (≤767px). Desktop and tablet are untouched.

   Performance model (no jank):
   - Manual swipe is 100% native: CSS scroll-snap does the work, the finger is
     never fought. We NEVER write scrollLeft during a manual scroll.
   - Autoplay uses a single setInterval that calls the NATIVE scrollTo({behavior:
     'smooth'}) — and only when the user is idle, the tab is visible and the
     carousel is on screen. No transform animation, no rAF scroll loop.
   - Active dot updates once per gesture, on `scrollend` (or a 150ms debounce
     fallback) — never on every scroll pixel.

   Opt-in: add class `js-carousel` (or `data-carousel`) to any card-group
   wrapper. `.steps-grid` and `.stats-grid` are wired in by default.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  var MOBILE   = '(max-width: 767px)';
  var INTERVAL = 3000;   // auto-slide interval
  var RESUME   = 2000;   // resume autoplay this long after interaction ends
  var SETTLE   = 150;    // dot-update debounce when scrollend is unsupported
  var SELECTORS = ['.steps-grid', '.stats-grid', '.js-carousel', '[data-carousel]'];

  var SUPPORTS_SCROLLEND = ('onscrollend' in window);
  var instances = [];

  function qsa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function collectGroups() {
    var out = [];
    SELECTORS.forEach(function (sel) {
      qsa(sel).forEach(function (el) {
        if (out.indexOf(el) < 0 && el.children && el.children.length > 1) out.push(el);
      });
    });
    return out;
  }

  function makeCarousel(track) {
    var n = track.children.length;
    track.classList.add('dm-car-on');

    // ── pagination dots ──────────────────────────────────────────────────────
    var dots = document.createElement('div');
    dots.className = 'dm-car-dots';
    var dotEls = [];
    for (var i = 0; i < n; i++) {
      (function (idx) {
        var d = document.createElement('button');
        d.type = 'button';
        d.className = 'dm-car-dot';
        d.setAttribute('aria-label', 'Go to slide ' + (idx + 1));
        d.addEventListener('click', function () { holdAutoplay(); goTo(idx); }, { passive: true });
        dots.appendChild(d);
        dotEls.push(d);
      })(i);
    }
    track.parentNode.insertBefore(dots, track.nextSibling);

    var current = 0;
    var userInteracting = false;
    var interval = null, resumeT = null, settleT = null;

    // scrollLeft that centers slide `idx` (matches CSS scroll-snap-align:center)
    function targetLeft(idx) {
      var s = track.children[idx];
      return s.offsetLeft - (track.clientWidth - s.offsetWidth) / 2;
    }
    function setActive(idx) {
      for (var i = 0; i < dotEls.length; i++) dotEls[i].classList.toggle('active', i === idx);
    }
    // Programmatic, native smooth scroll. Skipped if the user is mid-gesture so
    // autoplay can never fight the finger.
    function goTo(idx) {
      current = (idx % n + n) % n;            // wrap → infinite loop, no clones
      setActive(current);
      if (userInteracting) return;
      track.scrollTo({ left: targetLeft(current), behavior: 'smooth' });
    }

    // ── interaction gating ────────────────────────────────────────────────────
    function startInteract() {
      userInteracting = true;
      if (resumeT) { clearTimeout(resumeT); resumeT = null; }
    }
    function endInteract() {
      if (resumeT) clearTimeout(resumeT);
      resumeT = setTimeout(function () { userInteracting = false; }, RESUME);
    }
    // Dot-click pause: behave like a quick interaction, then resume after RESUME.
    function holdAutoplay() { startInteract(); endInteract(); }

    // ── dot sync after the scroll settles (NOT per-pixel) ─────────────────────
    function syncActive() {
      var center = track.scrollLeft + track.clientWidth / 2;
      var nearest = 0, min = Infinity;
      for (var i = 0; i < n; i++) {
        var c = track.children[i].offsetLeft + track.children[i].offsetWidth / 2;
        var d = Math.abs(c - center);
        if (d < min) { min = d; nearest = i; }
      }
      current = nearest;
      setActive(current);
    }
    function onScrollDebounced() {
      if (settleT) clearTimeout(settleT);
      settleT = setTimeout(syncActive, SETTLE);
    }

    // ── autoplay ──────────────────────────────────────────────────────────────
    function inViewport() {
      var r = track.getBoundingClientRect();
      return r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight);
    }
    function tick() {
      if (userInteracting) return;            // never interrupt the user
      if (document.hidden) return;            // tab not visible
      if (!inViewport()) return;              // carousel off screen
      goTo(current + 1);
    }

    // ── wire up (passive everywhere we can) ───────────────────────────────────
    track.addEventListener('touchstart',  startInteract, { passive: true });
    track.addEventListener('pointerdown',  startInteract, { passive: true });
    track.addEventListener('mousedown',    startInteract, { passive: true });
    track.addEventListener('touchend',     endInteract,   { passive: true });
    track.addEventListener('pointerup',    endInteract,   { passive: true });
    track.addEventListener('mouseup',      endInteract,   { passive: true });

    var settleEvent = SUPPORTS_SCROLLEND ? 'scrollend' : 'scroll';
    var settleHandler = SUPPORTS_SCROLLEND ? syncActive : onScrollDebounced;
    track.addEventListener(settleEvent, settleHandler, { passive: true });

    setActive(0);
    interval = setInterval(tick, INTERVAL);

    return {
      destroy: function () {
        if (interval) clearInterval(interval);
        if (resumeT) clearTimeout(resumeT);
        if (settleT) clearTimeout(settleT);
        track.removeEventListener('touchstart',  startInteract);
        track.removeEventListener('pointerdown',  startInteract);
        track.removeEventListener('mousedown',    startInteract);
        track.removeEventListener('touchend',     endInteract);
        track.removeEventListener('pointerup',    endInteract);
        track.removeEventListener('mouseup',      endInteract);
        track.removeEventListener(settleEvent, settleHandler);
        track.classList.remove('dm-car-on');
        track.scrollLeft = 0;
        if (dots.parentNode) dots.parentNode.removeChild(dots);
      }
    };
  }

  function enable() {
    if (instances.length) return;
    collectGroups().forEach(function (g) { instances.push(makeCarousel(g)); });
  }
  function disable() {
    instances.forEach(function (i) { i.destroy(); });
    instances = [];
  }

  var mq = window.matchMedia(MOBILE);
  function apply() { if (mq.matches) enable(); else disable(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();

  if (mq.addEventListener) mq.addEventListener('change', apply);
  else if (mq.addListener) mq.addListener(apply);
})();
