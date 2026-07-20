/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — shared site header & footer
   Single source of truth for the navbar and footer across every public page.
   Usage: place <div id="dm-header"></div> at the top of <body>,
          <div id="dm-footer"></div> near the bottom,
          and <script src="/js/layout.js" defer></script> before </body>.
   All styles are scoped with a `dm-` prefix so they never collide with a
   page's own CSS. Visual style mirrors the home page (master design).
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  var CSS = '\
.dm-nav{position:sticky;top:0;z-index:1000;margin:0;background:rgba(255,255,255,0.96);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid #E2E8F0;padding:0 clamp(1rem,4vw,2.5rem);height:60px;display:flex;align-items:center;justify-content:space-between;gap:1rem;font-family:"DM Sans",system-ui,sans-serif}\
.dm-nav-logo{display:flex;align-items:center;gap:10px;text-decoration:none;flex-shrink:0}\
.dm-logo-mark{width:32px;height:32px;background:#0A2540;border-radius:8px;display:flex;align-items:center;justify-content:center}\
.dm-logo-mark svg{width:18px;height:18px}\
.dm-logo-word{font-size:16px;font-weight:700;color:#0A2540;letter-spacing:-0.02em}\
.dm-logo-word span{color:#00A878}\
.dm-nav-mid{display:flex;align-items:center;gap:1.75rem}\
.dm-nav-mid a{font-size:14px;color:#3D4D5C;text-decoration:none;font-weight:500}\
.dm-nav-mid a:hover{color:#0A2540}\
.dm-nav-right{display:flex;align-items:center;gap:12px}\
.dm-nav-login{font-size:14px;color:#6B7A8D;text-decoration:none;font-weight:500;white-space:nowrap}\
.dm-nav-login:hover{color:#0A2540}\
.dm-nav-cta{background:#0A2540;color:#fff;padding:8px 18px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;transition:background .15s;white-space:nowrap}\
.dm-nav-cta:hover{background:#00A878;color:#fff}\
@media(max-width:760px){.dm-nav-mid{display:none}}\
@media(max-width:480px){.dm-nav-login{display:none}}\
.dm-footer{width:100%;margin:0;background:#0D1B35;padding:56px 1rem 24px;display:flex;justify-content:center;text-align:left;font-family:"DM Sans",system-ui,sans-serif}\
.dm-footer-card{width:100%;max-width:1200px;margin:0 auto;background:#102343;border-radius:32px;padding:48px 48px 32px;box-shadow:0 30px 80px rgba(4,18,45,.18)}\
.dm-footer-grid{display:grid;grid-template-columns:repeat(4,minmax(140px,1fr));gap:32px}\
.dm-footer-col{display:flex;flex-direction:column;gap:1rem}\
.dm-footer-logo{font-size:1.35rem;font-weight:800;color:#fff;letter-spacing:-.02em}\
.dm-footer-logo a{color:inherit;text-decoration:none;transition:color .15s}\
.dm-footer-logo a:hover{color:#00A878}\
.dm-footer-brand p{color:rgba(255,255,255,.75);font-size:0.95rem;line-height:1.8;max-width:320px}\
.dm-footer-col h4{font-size:0.82rem;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.16em;margin-bottom:1rem;position:relative;padding-bottom:0.75rem}\
.dm-footer-col h4::after{content:"";position:absolute;left:0;bottom:0;width:32px;height:3px;background:#00A878;border-radius:2px}\
.dm-footer-links{display:flex;flex-direction:column;gap:0.85rem}\
.dm-footer-links a{color:rgba(255,255,255,.82);text-decoration:none;font-size:0.95rem;transition:color .15s}\
.dm-footer-links a:hover{color:#00A878}\
.dm-footer-social{display:flex;gap:0.75rem;margin-top:0.5rem}\
.dm-social-chip{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.08);color:#c8d4e0;text-decoration:none;transition:background .15s,color .15s}\
.dm-social-chip svg{width:18px;height:18px}\
.dm-social-chip:hover{background:rgba(0,168,120,.18);color:#00A878}\
.dm-footer-divider{height:1px;background:rgba(255,255,255,.12);margin:24px 0 0}\
.dm-footer-bottom{margin:0 auto;padding-top:24px;color:rgba(255,255,255,.55);font-size:0.95rem;text-align:center;max-width:1200px;width:100%}\
@media(max-width:960px){.dm-footer-grid{grid-template-columns:1fr 1fr;gap:28px 24px}.dm-footer-brand{grid-column:1 / -1}}\
@media(max-width:768px){.dm-footer{padding:36px 1rem 18px}.dm-footer-card{padding:28px 22px 18px}.dm-footer-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px 24px}.dm-footer-brand{grid-column:1 / -1}.dm-footer-links{gap:0.65rem}.dm-footer-col h4{margin-bottom:0.8rem;padding-bottom:0.65rem}}\
@media(max-width:420px){.dm-footer-card{padding:24px 16px 16px}.dm-footer-grid{grid-template-columns:1fr 1fr;gap:26px 16px}.dm-footer-col h4{font-size:0.78rem;letter-spacing:.12em}.dm-footer-links a{font-size:0.88rem}.dm-footer-brand p{font-size:0.88rem}}\
';

  var HEADER = '\
<nav class="dm-nav">\
  <a class="dm-nav-logo" href="/" aria-label="The Doc Mirror homepage">\
    <span class="dm-logo-mark"><svg viewBox="0 0 18 18" fill="none" aria-hidden="true" focusable="false"><circle cx="9" cy="9" r="7.5" stroke="#00A878" stroke-width="1.3"/><path d="M5.5 9C5.5 7 7 5.5 9 5.5S12.5 7 12.5 9" stroke="white" stroke-width="1.3" stroke-linecap="round"/><circle cx="9" cy="12" r="1.3" fill="#00A878"/></svg></span>\
    <span class="dm-logo-word">The Doc <span>Mirror</span></span>\
  </a>\
  <div class="dm-nav-mid">\
    <a href="/">Home</a>\
    <a href="/resources">Resources</a>\
    <a href="/pricing">Pricing</a>\
    <a href="/about">About</a>\
    <a href="/#faq">FAQ</a>\
  </div>\
  <div class="dm-nav-right">\
    <a class="dm-nav-login" href="/pages/auth.html?tab=login">Log In</a>\
    <a class="dm-nav-cta" href="/#tool">Check my listing free</a>\
  </div>\
</nav>';

  var FOOTER = '\
<footer class="dm-footer">\
  <div class="dm-footer-card">\
    <div class="dm-footer-grid">\
      <div class="dm-footer-col dm-footer-brand">\
        <div class="dm-footer-logo"><a href="/">The Doc Mirror</a></div>\
        <p>The Doc Mirror is an AI visibility platform built for medical practices. It helps doctors understand how they appear on Google, ChatGPT, Gemini and Claude.</p>\
        <div class="dm-footer-social">\
          <a class="dm-social-chip" href="https://www.facebook.com/profile.php?id=61591407977305" target="_blank" rel="noopener noreferrer" aria-label="Facebook"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg></a>\
          <a class="dm-social-chip" href="https://x.com/thedocmirror" target="_blank" rel="noopener noreferrer" aria-label="X"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>\
          <a class="dm-social-chip" href="https://www.linkedin.com/in/the-doc-mirror-6650a741a/" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/></svg></a>\
          <a class="dm-social-chip" href="https://www.instagram.com/thedocmirror/" target="_blank" rel="noopener noreferrer" aria-label="Instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg></a>\
          <a class="dm-social-chip" href="https://www.youtube.com/@thedocmirror" target="_blank" rel="noopener noreferrer" aria-label="YouTube"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 00.5 6.2 31 31 0 000 12a31 31 0 00.5 5.8 3 3 0 002.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 002.1-2.1A31 31 0 0024 12a31 31 0 00-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z"/></svg></a>\
        </div>\
      </div>\
      <div class="dm-footer-col">\
        <h4>PRODUCT</h4>\
        <div class="dm-footer-links">\
          <a href="/#how-it-works">How it works</a>\
          <a href="/#tool">Free audit</a>\
          <a href="/pricing">Pricing</a>\
          <a href="/about">About</a>\
          <a href="/#faq">FAQ</a>\
          <a href="/resources">Resources</a>\
        </div>\
      </div>\
      <div class="dm-footer-col">\
        <h4>COMPANY</h4>\
        <div class="dm-footer-links">\
          <a href="/about">About Us</a>\
          <a href="/about#contact">Contact</a>\
          <a href="/privacy">Privacy</a>\
          <a href="/terms">Terms</a>\
        </div>\
      </div>\
      <div class="dm-footer-col">\
        <h4>SUPPORT</h4>\
        <div class="dm-footer-links">\
          <a href="/#faq">FAQ</a>\
          <a href="/help-center">Help Center</a>\
          <a href="/about#contact">Contact Support</a>\
        </div>\
      </div>\
    </div>\
    <div class="dm-footer-divider"></div>\
    <div class="dm-footer-bottom">© 2026 The Doc Mirror. All rights reserved.</div>\
  </div>\
</footer>';

  function mount() {
    if (!document.getElementById('dm-layout-css')) {
      var style = document.createElement('style');
      style.id = 'dm-layout-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    var h = document.getElementById('dm-header');
    if (h) h.innerHTML = HEADER;
    var f = document.getElementById('dm-footer');
    if (f) f.innerHTML = FOOTER;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
