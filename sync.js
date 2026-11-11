/* Cloud sync through Supabase, using plain fetch (no libraries).
   Local data always works offline; sync merges phone and computer, never overwrites blindly. */
(function (root) {
  'use strict';

  var AUTH_KEY = 'fit.auth';
  var N_TYPES = 4;

  // ---------- pure merge logic ----------
  function uniq(a) {
    var seen = {}, out = [];
    a.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }
  function byId(list) {
    var m = {};
    (list || []).forEach(function (x) { m[x.id] = x; });
    return m;
  }
  function canon(x) {
    if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
    if (x && typeof x === 'object') {
      return '{' + Object.keys(x).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(x[k]); }).join(',') + '}';
    }
    return JSON.stringify(x === undefined ? null : x);
  }

  // Union of two states. Sessions and weigh-ins merge by id, deleted weigh-ins stay deleted,
  // and each exercise keeps whichever side changed it most recently.
  function mergeStates(local, remote) {
    local = local || {};
    remote = remote || {};
    var tomb = uniq((local.tomb || []).concat(remote.tomb || []));
    var dead = {};
    tomb.forEach(function (id) { dead[id] = 1; });

    var wm = byId(remote.weights);
    (local.weights || []).forEach(function (w) { wm[w.id] = w; });
    var weights = Object.keys(wm).filter(function (id) { return !dead[id]; })
      .map(function (id) { return wm[id]; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

    var sm = byId(remote.sessions);
    (local.sessions || []).forEach(function (s) { sm[s.id] = s; });
    var sessions = Object.keys(sm).map(function (id) { return sm[id]; }).sort(function (a, b) {
      return ((b.finishedAt || 0) - (a.finishedAt || 0)) || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
    });

    var lp = local.prog || {}, rp = remote.prog || {}, prog = {};
    uniq(Object.keys(lp).concat(Object.keys(rp))).forEach(function (id) {
      var l = lp[id], r = rp[id];
      if (!l) prog[id] = r;
      else if (!r) prog[id] = l;
      else prog[id] = (r.at || 0) > (l.at || 0) ? r : l;
    });

    var cycle = sessions.length ? (sessions[0].typeIdx + 1) % N_TYPES : (local.cycle || 0);
    return { v: 1, sessions: sessions, weights: weights, tomb: tomb, prog: prog, cycle: cycle };
  }
  function normalize(p) { return mergeStates(p, null); }

  // ---------- Supabase client ----------
  function cfg() { return (typeof FIT_CONFIG !== 'undefined' && FIT_CONFIG) || {}; }
  function configured() { return !!(cfg().supabaseUrl && cfg().supabaseKey); }
  function base() { return String(cfg().supabaseUrl).replace(/\/+$/, ''); }

  function readAuth() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { return null; }
  }
  function writeAuth(a) {
    try {
      if (a) localStorage.setItem(AUTH_KEY, JSON.stringify(a));
      else localStorage.removeItem(AUTH_KEY);
    } catch (e) { /* ignore */ }
  }
  function fromToken(j) {
    return { access_token: j.access_token, refresh_token: j.refresh_token,
             expires_at: Date.now() + (j.expires_in || 3600) * 1000,
             user_id: j.user && j.user.id, email: j.user && j.user.email };
  }

  function call(method, path, body, token, extraHeaders) {
    var headers = { apikey: cfg().supabaseKey, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) { headers[k] = extraHeaders[k]; });
    return fetch(base() + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (res) {
        return res.text().then(function (t) {
          var j = null;
          try { j = t ? JSON.parse(t) : null; } catch (e) { /* not json */ }
          return { ok: res.ok, status: res.status, json: j };
        });
      }, function () {
        var e = new Error('No connection');
        e.offline = true;
        throw e;
      });
  }
  function fail(r, fallback) {
    var j = r.json || {};
    var e = new Error(j.error_description || j.msg || j.message || (typeof j.error === 'string' ? j.error : '') || fallback);
    e.status = r.status;
    return e;
  }

  function signIn(email, password) {
    return call('POST', '/auth/v1/token?grant_type=password', { email: email, password: password }).then(function (r) {
      if (!r.ok) throw fail(r, 'Could not sign in');
      var a = fromToken(r.json);
      writeAuth(a);
      return a;
    });
  }
  function signUp(email, password) {
    return call('POST', '/auth/v1/signup', { email: email, password: password }).then(function (r) {
      if (!r.ok) throw fail(r, 'Could not create the account');
      if (r.json && r.json.access_token) {
        writeAuth(fromToken(r.json));
        return { signedIn: true };
      }
      return { needsConfirm: true };
    });
  }
  function signOut() { writeAuth(null); }
  function signedIn() { return configured() && !!readAuth(); }
  function email() { var a = readAuth(); return a ? a.email || '' : ''; }

  function ensureAuth(force) {
    var a = readAuth();
    if (!a) { var e = new Error('Not signed in'); e.auth = true; return Promise.reject(e); }
    if (!force && a.expires_at - Date.now() > 60000) return Promise.resolve(a);
    return call('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: a.refresh_token }).then(function (r) {
      if (!r.ok) {
        if (r.status >= 400 && r.status < 500) {
          writeAuth(null);
          var e2 = new Error('Signed out, please sign in again');
          e2.auth = true;
          throw e2;
        }
        throw fail(r, 'Could not refresh the session');
      }
      var n = fromToken(r.json);
      n.email = n.email || a.email;
      n.user_id = n.user_id || a.user_id;
      writeAuth(n);
      return n;
    });
  }
  function withAuth(fn) {
    return ensureAuth(false).then(fn).catch(function (e) {
      if (e && e.status === 401) return ensureAuth(true).then(fn);
      throw e;
    });
  }

  function pull(auth) {
    return call('GET', '/rest/v1/fit_state?select=data,updated_at&user_id=eq.' + encodeURIComponent(auth.user_id), null, auth.access_token)
      .then(function (r) {
        if (!r.ok) throw fail(r, 'Could not read your data');
        return (r.json && r.json[0]) || null;
      });
  }
  function push(auth, data) {
    return call('POST', '/rest/v1/fit_state',
      { user_id: auth.user_id, data: data, updated_at: new Date().toISOString() },
      auth.access_token, { Prefer: 'resolution=merge-duplicates,return=minimal' })
      .then(function (r) {
        if (!r.ok) throw fail(r, 'Could not save your data');
      });
  }

  // Pull, merge with local, push if the cloud copy is behind. Resolves { merged, pushed }.
  function run(local) {
    return withAuth(function (auth) {
      return pull(auth).then(function (row) {
        var remote = row ? row.data : null;
        var merged = mergeStates(local, remote);
        var behind = !row || canon(mergeStates(remote, null)) !== canon(merged);
        if (!behind) return { merged: merged, pushed: false };
        return push(auth, merged).then(function () { return { merged: merged, pushed: true }; });
      });
    });
  }

  var api = { configured: configured, signedIn: signedIn, email: email, signIn: signIn, signUp: signUp,
              signOut: signOut, run: run, mergeStates: mergeStates, normalize: normalize, canon: canon };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FitSync = api;
})(typeof window !== 'undefined' ? window : this);
