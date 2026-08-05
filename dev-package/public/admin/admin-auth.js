/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — admin client-side session helper

   Shared by every page under /admin. It does three things:

     1. Restores a Supabase session from the tokens in localStorage (the same
        tokens the customer dashboard uses — it is the same Supabase user).
     2. Calls GET /api/admin/me and branches on the status code.
     3. Exposes AdminAuth.api() so every later admin page sends the Bearer
        token without re-implementing it.

   This file decides what the ADMIN SEES, not what the admin may DO. It is
   ordinary client-side JavaScript and a determined visitor can read or skip
   it — which is fine, because it holds no secrets and grants no access. Every
   piece of data and every mutation is behind requireAuth + requireAdmin on the
   server, re-checked against profiles.role on each request. Bypassing this
   file gets you an empty page whose API calls all return 401 or 403.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var TOKEN_AT = 'tdm_access_token';
  var TOKEN_RT = 'tdm_refresh_token';
  var TOKEN_ID = 'tdm_user_id';
  var TOKEN_EM = 'tdm_user_email';

  var _supabase = null;
  var _session  = null;
  var _token    = null;
  var _admin    = null;

  // ── tokens ───────────────────────────────────────────────────────────────

  function storeTokens(session) {
    try {
      localStorage.setItem(TOKEN_AT, session.access_token);
      localStorage.setItem(TOKEN_RT, session.refresh_token);
      localStorage.setItem(TOKEN_ID, session.user.id);
      localStorage.setItem(TOKEN_EM, session.user.email || '');
    } catch (_) { /* private mode — session still works for this page load */ }
  }

  function clearTokens() {
    [TOKEN_AT, TOKEN_RT, TOKEN_ID, TOKEN_EM].forEach(function (k) {
      try { localStorage.removeItem(k); } catch (_) {}
    });
  }

  // ── supabase client ──────────────────────────────────────────────────────
  // The anon key comes from /api/client-config, exactly as every other page on
  // the site gets it. It is a public key by design. The service_role key is
  // never sent to the browser and never appears in any file under public/.

  async function getClient() {
    if (_supabase) return _supabase;
    var cfg = await fetch('/api/client-config').then(function (r) { return r.json(); });
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return null;
    _supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    return _supabase;
  }

  // Rebuilds the session from stored tokens, refreshing it if the access token
  // has expired. Returns null when there is nothing valid to restore.
  async function restore() {
    var sb = await getClient();
    if (!sb) return null;

    var at = null, rt = null;
    try { at = localStorage.getItem(TOKEN_AT); rt = localStorage.getItem(TOKEN_RT); } catch (_) {}

    if (at && rt) {
      try {
        var s = await sb.auth.setSession({ access_token: at, refresh_token: rt });
        if (s.data && s.data.session) {
          _session = s.data.session;
          storeTokens(_session);
        }
      } catch (_) { /* fall through to getSession */ }
    }

    if (!_session) {
      try {
        var chk = await sb.auth.getSession();
        _session = (chk.data && chk.data.session) || null;
      } catch (_) { _session = null; }
    }

    _token = _session ? _session.access_token : null;
    return _session;
  }

  // ── authenticated fetch ──────────────────────────────────────────────────
  // Resolves to { status, body } rather than throwing, because every admin page
  // needs to tell 401 (sign in) from 403 (not an admin) from 503 (try again).

  async function apiRaw(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    if (_token) headers['Authorization'] = 'Bearer ' + _token;
    if (opts.body && !headers['Content-Type'] && !(opts.body instanceof ArrayBuffer)) {
      headers['Content-Type'] = 'application/json';
    }

    var res = await fetch(path, {
      method:  opts.method || 'GET',
      headers: headers,
      body:    opts.body || undefined,
    });

    var body = null;
    try { body = await res.json(); } catch (_) { body = null; }
    return { status: res.status, ok: res.ok, body: body };
  }

  // Convenience wrapper for the common case: resolve the body, throw otherwise.
  async function api(path, opts) {
    var r = await apiRaw(path, opts);
    if (!r.ok) {
      var err = new Error((r.body && r.body.error) || ('Request failed (' + r.status + ')'));
      err.status = r.status;
      err.body = r.body;
      throw err;
    }
    return r.body;
  }

  // ── the page gate ────────────────────────────────────────────────────────

  function gateEl() { return document.getElementById('adm-gate'); }

  function showGate(title, message, actionHtml) {
    var g = gateEl();
    if (!g) return;
    g.hidden = false;
    g.innerHTML =
      '<div class="adm-gate-title">' + title + '</div>' +
      '<p class="adm-gate-msg">' + message + '</p>' +
      (actionHtml || '');
  }

  function hideGate() {
    var g = gateEl();
    if (g) g.hidden = true;
  }

  /**
   * Call at the top of every protected admin page.
   * onReady(admin) runs only after the SERVER has confirmed admin access.
   */
  async function guard(onReady) {
    var loginUrl = '/admin/login?return_to=' + encodeURIComponent(
      window.location.pathname + window.location.search
    );

    var session = null;
    try {
      session = await restore();
    } catch (e) {
      showGate('Something went wrong', 'Could not start the authentication service. Reload the page to try again.');
      return;
    }

    if (!session) { window.location.href = loginUrl; return; }

    var r;
    try {
      r = await apiRaw('/api/admin/me');
    } catch (e) {
      showGate('Network error', 'Could not reach the server. Check your connection and reload.');
      return;
    }

    if (r.status === 401) { clearTokens(); window.location.href = loginUrl; return; }

    if (r.status === 403) {
      showGate(
        'No admin access',
        'You are signed in as <strong>' + escapeHtml(sessionEmail()) + '</strong>, but this account ' +
        'is not an administrator. If this is wrong, ask an existing admin to grant access.',
        '<button class="adm-btn adm-btn--ghost" onclick="AdminAuth.logout()">Sign out</button>'
      );
      return;
    }

    if (!r.ok) {
      showGate(
        'Could not verify access',
        (r.body && r.body.error) || 'The server could not confirm your admin access right now.',
        '<button class="adm-btn" onclick="window.location.reload()">Try again</button>'
      );
      return;
    }

    _admin = r.body;
    hideGate();
    if (typeof onReady === 'function') onReady(_admin);
  }

  async function logout() {
    try {
      var sb = await getClient();
      if (sb) await sb.auth.signOut();
    } catch (_) {}
    clearTokens();
    _session = null; _token = null; _admin = null;
    window.location.href = '/admin/login';
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  function sessionEmail() {
    if (_session && _session.user && _session.user.email) return _session.user.email;
    try { return localStorage.getItem(TOKEN_EM) || 'this account'; } catch (_) { return 'this account'; }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  window.AdminAuth = {
    getClient:   getClient,
    restore:     restore,
    guard:       guard,
    api:         api,
    apiRaw:      apiRaw,
    logout:      logout,
    storeTokens: storeTokens,
    clearTokens: clearTokens,
    escapeHtml:  escapeHtml,
    token:       function () { return _token; },
    admin:       function () { return _admin; },
  };
})();
