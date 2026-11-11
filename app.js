/* Fit: phase 1 (workout plan + log + weight). Local-first, no dependencies. */
(function () {
  'use strict';
  var L = window.FitLogic, P = window.FitPlan;
  var KEY = 'fit.v1';
  var app = document.getElementById('app');
  var view = 'today';
  var summary = null;
  var S = loadState();

  // ---------- state ----------
  function defaults() {
    return { v: 1, cycle: 0, profile: 'home', prog: JSON.parse(JSON.stringify(P.SEED)),
             sessions: [], weights: [], tomb: [], active: null };
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.v === 1) return Object.assign(defaults(), s);
      }
    } catch (e) { /* fall through */ }
    return defaults();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save on this device'); }
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(x) { return Number.isInteger(x) ? String(x) : x.toFixed(1); }
  function fmtLoad(ex, load) {
    if (ex.kind === 'bw') return load > 0 ? '+' + num(load) + ' lb' : 'bodyweight';
    return load == null ? 'choose a weight' : num(load) + ' ' + P.UNIT[ex.kind];
  }
  function relDays(iso) {
    var d = L.daysBetween(iso, L.today());
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago';
  }
  function shortDate(iso) {
    var d = L.parseDate(iso);
    return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getDate();
  }
  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 2200);
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ---------- session building ----------
  function makeEx(slotKey, exId) {
    var ex = P.EX[exId];
    var sg = L.suggest(ex, S.prog[exId], L.today());
    var sets = [];
    for (var i = 0; i < sg.sets; i++) {
      sets.push({ w: sg.load, r: null, done: false });
    }
    return { slot: slotKey, exId: exId, load: sg.load, top: sg.top, lo: ex.lo, extra: sg.extra,
             plannedSets: sg.sets, pct: sg.pct, gap: sg.gap, tempo: sg.tempo, atMax: sg.atMax,
             skipped: false, sets: sets };
  }
  function startSession(idx) {
    var sess = P.SESSIONS[idx];
    S.active = { id: uid(), date: L.today(), typeIdx: idx, profile: S.profile, warm: false,
                 exercises: sess.slots.map(function (sl) { return makeEx(sl.key, sl.opts[S.profile]); }) };
    summary = null;
    save();
  }
  function slotFor(a, rec) {
    return P.SESSIONS[a.typeIdx].slots.filter(function (s) { return s.key === rec.slot; })[0];
  }

  // ---------- rendering ----------
  function render(keepScroll) {
    var y = window.scrollY || 0;
    var html = '';
    if (view === 'today') html = renderToday();
    else if (view === 'history') html = renderHistory();
    else if (view === 'progress') html = renderProgress();
    else html = renderSettings();
    app.innerHTML = html;
    var btns = document.querySelectorAll('#nav button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].className = btns[i].getAttribute('data-v') === view ? 'on' : '';
    }
    window.scrollTo(0, keepScroll ? y : 0);
  }

  function profileSeg() {
    return '<div class="seg" role="group" aria-label="Where are you training">' +
      Object.keys(P.PROFILES).map(function (k) {
        return '<button class="' + (S.profile === k ? 'on' : '') + '" data-act="profile" data-p="' + k + '">' +
               esc(P.PROFILES[k]) + '</button>';
      }).join('') + '</div>';
  }

  function previewList(idx) {
    var sess = P.SESSIONS[idx];
    return '<ul class="plist">' + sess.slots.map(function (sl) {
      var ex = P.EX[sl.opts[S.profile]];
      var sg = L.suggest(ex, S.prog[ex.id], L.today());
      return '<li><span>' + esc(ex.name) + '</span><span class="meta">' + sg.sets + ' × ' + ex.lo + '–' + sg.top +
             ' · ' + esc(fmtLoad(ex, sg.load)) + '</span></li>';
    }).join('') + '</ul>';
  }

  function renderToday() {
    var h = '';
    if (summary) h += renderSummary();
    if (S.active) return h + renderActive();
    var idx = S.cycle, sess = P.SESSIONS[idx], last = S.sessions[0];
    h += '<section class="card"><div class="eyebrow">Next up</div><h1>' + esc(sess.name) + '</h1>' +
         '<p class="muted">' + esc(sess.blurb) + '</p>';
    if (last) h += '<p class="muted small">Last session: ' + esc(P.SESSIONS[last.typeIdx].name) + ', ' + relDays(last.date) + '</p>';
    h += profileSeg() + previewList(idx) +
         '<button class="btn primary block" data-act="start" data-idx="' + idx + '">Start workout</button></section>';
    h += '<section class="card"><h2>Different session today?</h2><div class="grid2">' +
         P.SESSIONS.map(function (s, i) {
           return i === idx ? '' : '<button class="btn" data-act="start" data-idx="' + i + '">' + esc(s.name) + '</button>';
         }).join('') + '</div></section>';
    return h;
  }

  function renderSummary() {
    var icon = { up: '▲', reps: '+', down: '▼', hold: '=', 'off-plan': '~' };
    var cls = { up: '', reps: '', down: 'down', hold: 'flat', 'off-plan': 'flat' };
    var h = '<section class="card summary"><div class="eyebrow">Workout saved</div><h2>What changes next time</h2>';
    summary.forEach(function (l) {
      h += '<div class="line"><span class="ico ' + (cls[l.result] || '') + '">' + (icon[l.result] || '') + '</span><span><b>' +
           esc(l.name) + '</b><br><span class="muted">' + esc(l.note) + '</span></span></div>';
    });
    if (!summary.length) h += '<p class="muted">Nothing was logged.</p>';
    return h + '<button class="btn block" data-act="dismiss">Done</button></section>';
  }

  function renderActive() {
    var a = S.active, sess = P.SESSIONS[a.typeIdx];
    var h = '<section class="card"><div class="eyebrow">' + esc(P.PROFILES[a.profile]) + '</div><h1>' + esc(sess.name) + '</h1>' +
            '<label class="check"><input type="checkbox" data-f="warm" ' + (a.warm ? 'checked' : '') + '> ' + esc(P.WARMUP) + '</label></section>';
    a.exercises.forEach(function (rec, ei) { h += renderEx(a, rec, ei); });
    h += '<div class="stack"><button class="btn primary block" data-act="finish">Finish workout</button>' +
         '<button class="btn ghost danger block" data-act="cancel">Cancel workout</button></div>';
    return h;
  }

  function renderEx(a, rec, ei) {
    var ex = P.EX[rec.exId];
    var alts = P.alternatives(slotFor(a, rec), a.profile);
    var h = '<section class="card' + (rec.skipped ? ' skipped' : '') + '"><div class="exhead"><div><h3>' + esc(ex.name) + '</h3>' +
            '<div class="target">' + rec.plannedSets + ' × ' + ex.lo + '–' + rec.top + (ex.note ? ' · ' + esc(ex.note) : '') + '</div></div>' +
            '<div class="row" style="margin:0">' +
            (alts.length > 1 ? '<button class="btn sm" data-act="swap" data-ei="' + ei + '">Swap</button>' : '') +
            '<button class="btn sm" data-act="skip" data-ei="' + ei + '">' + (rec.skipped ? 'Undo' : 'Skip') + '</button></div></div>';
    if (rec.pct > 0) h += '<span class="badge warn">Eased back ' + Math.round(rec.pct * 100) + '% after ' + rec.gap + ' days away</span>';
    if (rec.load == null && ex.kind !== 'bw') h += '<span class="badge">First time: enter a comfortable weight</span>';
    if (rec.atMax) h += '<span class="badge good">Top dumbbell weight: add reps instead</span>';
    if (rec.tempo) h += '<span class="badge good">Slow 3-second lowering</span>';
    if (rec.skipped) return h + '</section>';
    h += '<div class="setlabels"><span></span><span>' + esc(P.UNIT[ex.kind]) + '</span><span>reps</span><span></span></div>';
    rec.sets.forEach(function (s, si) {
      h += '<div class="set' + (s.done ? ' done' : '') + '"><span class="n">' + (si + 1) + '</span>' +
           '<input type="number" inputmode="decimal" step="any" value="' + (s.w == null ? '' : s.w) + '" data-f="w" data-ei="' + ei + '" data-si="' + si + '" aria-label="Weight, set ' + (si + 1) + '">' +
           '<input type="number" inputmode="numeric" placeholder="' + rec.top + '" value="' + (s.r == null ? '' : s.r) + '" data-f="r" data-ei="' + ei + '" data-si="' + si + '" aria-label="Reps, set ' + (si + 1) + '">' +
           '<button class="tick" data-act="tick" data-ei="' + ei + '" data-si="' + si + '" aria-label="Mark set ' + (si + 1) + ' done">✓</button></div>';
    });
    return h + '<div class="row"><button class="btn sm" data-act="addset" data-ei="' + ei + '">+ Add set</button></div></section>';
  }

  function renderHistory() {
    var h = '<h1>History</h1>';
    if (!S.sessions.length) return h + '<section class="card"><p class="muted">No workouts yet. Your finished sessions show up here.</p></section>';
    h += '<section class="card">';
    S.sessions.forEach(function (s) {
      var doneSets = 0;
      s.exercises.forEach(function (r) { doneSets += r.sets.filter(function (x) { return x.done; }).length; });
      h += '<details><summary>' + shortDate(s.date) + ' · ' + esc(P.SESSIONS[s.typeIdx].name) +
           ' <span class="muted small">' + esc(P.PROFILES[s.profile]) + ' · ' + doneSets + ' sets</span></summary>';
      s.exercises.forEach(function (r) {
        var ex = P.EX[r.exId];
        var sets = r.sets.filter(function (x) { return x.done; }).map(function (x) {
          return (ex.kind === 'bw' && !(x.w > 0) ? '' : num(Number(x.w)) + '×') + x.r;
        });
        h += '<p class="hex"><b>' + esc(ex.name) + '</b>: ' + (r.skipped || !sets.length ? 'skipped' : sets.join(', ')) +
             (r.note ? '<br>' + esc(r.note) : '') + '</p>';
      });
      h += '</details>';
    });
    return h + '</section>';
  }

  function weightChart(weeks) {
    if (weeks.length < 2) return '<p class="muted">Log your weight in two different weeks to see the trend.</p>';
    var W = 320, H = 132, pad = 26;
    var vals = weeks.map(function (w) { return w.avg; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (max - min < 2) { var mid = (max + min) / 2; min = mid - 1; max = mid + 1; }
    var x = function (i) { return pad + i * (W - 2 * pad) / (weeks.length - 1); };
    var y = function (v) { return H - pad - (v - min) / (max - min) * (H - 2 * pad); };
    var pts = weeks.map(function (w, i) { return x(i).toFixed(1) + ',' + y(w.avg).toFixed(1); }).join(' ');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="Weekly average weight">' +
      '<polyline points="' + pts + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      weeks.map(function (w, i) { return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(w.avg).toFixed(1) + '" r="3.5" fill="var(--accent)"/>'; }).join('') +
      '<text x="' + pad + '" y="' + (H - 6) + '">' + esc(shortDate(weeks[0].week)) + '</text>' +
      '<text x="' + (W - pad) + '" y="' + (H - 6) + '" text-anchor="end">' + esc(shortDate(weeks[weeks.length - 1].week)) + '</text>' +
      '<text x="' + pad + '" y="12">' + max.toFixed(1) + '</text><text x="' + pad + '" y="' + (H - 18) + '">' + min.toFixed(1) + '</text></svg>';
  }

  function spark(vals) {
    if (vals.length < 2) return '';
    var W = 84, H = 26, min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (max === min) { min -= 1; max += 1; }
    var pts = vals.map(function (v, i) {
      return (2 + i * (W - 4) / (vals.length - 1)).toFixed(1) + ',' + (H - 3 - (v - min) / (max - min) * (H - 6)).toFixed(1);
    }).join(' ');
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '"><polyline points="' + pts + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function strengthTrends() {
    var map = {};
    S.sessions.slice().reverse().forEach(function (s) {
      s.exercises.forEach(function (r) {
        var ex = P.EX[r.exId];
        var done = r.sets.filter(function (x) { return x.done && x.r > 0; });
        if (!done.length) return;
        var v;
        if (ex.kind === 'bw') v = Math.max.apply(null, done.map(function (x) { return x.r; }));
        else {
          var ws = done.map(function (x) { return Number(x.w); }).filter(function (w) { return w > 0; });
          if (!ws.length) return;
          v = Math.min.apply(null, ws);
        }
        (map[r.exId] = map[r.exId] || []).push(v);
      });
    });
    var ids = Object.keys(map);
    if (!ids.length) return '<p class="muted">Lift trends appear after your first logged workout.</p>';
    return ids.map(function (id) {
      var ex = P.EX[id], v = map[id];
      var unit = ex.kind === 'bw' ? 'best reps' : P.UNIT[ex.kind];
      return '<div class="wrow"><div><b>' + esc(ex.name) + '</b><br><span class="muted small">' + num(v[0]) + ' → ' +
             num(v[v.length - 1]) + ' ' + esc(unit) + ' · ' + v.length + ' session' + (v.length > 1 ? 's' : '') +
             '</span></div>' + spark(v.slice(-12)) + '</div>';
    }).join('');
  }

  function renderProgress() {
    var weeks = L.weeklyAverages(S.weights);
    var h = '<h1>Progress</h1><section class="card"><h2>Body weight</h2>' +
            '<div class="inline"><input class="field" type="date" id="wDate" value="' + L.today() + '" aria-label="Date">' +
            '<input class="field" type="number" inputmode="decimal" step="0.1" id="wVal" placeholder="lb" aria-label="Weight in pounds">' +
            '<button class="btn primary" data-act="addweight">Add</button></div>';
    if (weeks.length) {
      var cur = weeks[weeks.length - 1], first = weeks[0];
      h += '<p><b>This week: ' + cur.avg.toFixed(1) + ' lb</b> <span class="muted">(' + cur.n + ' weigh-in' + (cur.n > 1 ? 's' : '') + ')</span>';
      if (weeks.length > 1) {
        var prev = weeks[weeks.length - 2], d1 = cur.avg - prev.avg, d0 = cur.avg - first.avg;
        h += '<br><span class="muted">' + (d1 > 0 ? '+' : '') + d1.toFixed(1) + ' lb vs last logged week · ' +
             (d0 > 0 ? '+' : '') + d0.toFixed(1) + ' lb since ' + shortDate(first.week) + '</span>';
      }
      h += '</p>';
    }
    h += weightChart(weeks);
    if (weeks.length) {
      h += '<table><tr><th>Week of</th><th class="r">Average</th><th class="r">Weigh-ins</th></tr>' +
        weeks.slice().reverse().slice(0, 8).map(function (w) {
          return '<tr><td>' + shortDate(w.week) + '</td><td class="r">' + w.avg.toFixed(1) + '</td><td class="r">' + w.n + '</td></tr>';
        }).join('') + '</table>';
      var recent = S.weights.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 5);
      h += '<h2 style="margin-top:14px">Recent entries</h2>' + recent.map(function (e) {
        return '<div class="wrow"><span>' + shortDate(e.date) + ' · ' + num(e.lb) + ' lb</span><button class="btn sm ghost danger" data-act="delweight" data-id="' + esc(e.id) + '">Remove</button></div>';
      }).join('');
    }
    h += '</section><section class="card"><h2>Lifts</h2>' + strengthTrends() + '</section>';
    return h;
  }

  function renderSettings() {
    var ids = Object.keys(P.EX).filter(function (id) { return P.EX[id].kind !== 'bw'; });
    var h = '<h1>Settings</h1><section class="card"><h2>Working weights</h2>' +
            '<p class="muted small">What the plan starts from. Change one here if it is off. Dumbbells are per hand, smith is per side.</p>';
    ids.forEach(function (id) {
      var ex = P.EX[id], p = S.prog[id];
      h += '<div class="wrow"><span>' + esc(ex.name) + '<br><span class="muted small">' + esc(P.UNIT[ex.kind]) + '</span></span>' +
           '<input type="number" inputmode="decimal" step="any" value="' + (p && p.load != null ? p.load : '') + '" data-f="load" data-id="' + id + '" aria-label="' + esc(ex.name) + ' working weight"></div>';
    });
    h += '</section>' + syncCard() + '<section class="card"><h2>Backup</h2>' +
         '<p class="muted small">Your data lives on this phone until cloud sync is added. Download a backup now and then, and before clearing Safari data.</p>' +
         '<div class="stack"><button class="btn block" data-act="download">Download backup</button>' +
         '<button class="btn block" data-act="copy">Copy backup text</button>' +
         '<textarea class="field" id="importBox" placeholder="Paste a backup here to restore it" aria-label="Backup text"></textarea>' +
         '<button class="btn block" data-act="import">Restore from pasted backup</button></div></section>' +
         '<section class="card"><h2>Reset</h2><button class="btn ghost danger block" data-act="reset">Erase all data on this device</button></section>';
    return h;
  }

  // ---------- actions ----------
  function finishSession() {
    var a = S.active;
    var any = a.exercises.some(function (r) { return !r.skipped && r.sets.some(function (s) { return s.done; }); });
    if (!any) {
      if (!confirm('Nothing is marked done. Discard this workout?')) return;
      S.active = null; save(); render(); return;
    }
    var lines = [];
    a.exercises.forEach(function (rec) {
      if (rec.skipped) { rec.result = 'skipped'; rec.note = ''; return; }
      var ex = P.EX[rec.exId];
      var r = L.evaluate(ex, S.prog[rec.exId], rec, a.date);
      if (r.prog && r.prog !== S.prog[rec.exId]) { r.prog.at = Date.now(); S.prog[rec.exId] = r.prog; }
      rec.result = r.result; rec.note = r.note;
      if (r.result !== 'skipped') lines.push({ name: ex.name, result: r.result, note: r.note });
    });
    S.sessions.unshift({ id: a.id, date: a.date, typeIdx: a.typeIdx, profile: a.profile, warm: a.warm,
                         exercises: a.exercises, finishedAt: Date.now() });
    S.cycle = (a.typeIdx + 1) % P.SESSIONS.length;
    S.active = null;
    summary = lines;
    save();
    render();
    scheduleSync(300);
  }

  function act(name, d) {
    d = d || {};
    var a = S.active, rec, ex;
    if (d.ei != null && a) rec = a.exercises[Number(d.ei)];
    switch (name) {
      case 'tab': view = d.v; render(); return;
      case 'signin': case 'signup': doAuth(name); return;
      case 'syncnow': syncNow(true); return;
      case 'signout': FitSync.signOut(); sync.msg = ''; render(true); return;
      case 'dismiss': summary = null; render(); return;
      case 'profile': S.profile = d.p; save(); render(true); return;
      case 'start': startSession(Number(d.idx)); render(); return;
      case 'tick': {
        var s = rec.sets[Number(d.si)];
        ex = P.EX[rec.exId];
        if (!s.done) {
          if (ex.kind !== 'bw' && !(Number(s.w) > 0)) { toast('Enter the weight first'); return; }
          if (s.r == null || s.r === '') s.r = rec.top;
          s.done = true;
        } else { s.done = false; }
        save(); render(true); return;
      }
      case 'addset': {
        var lastSet = rec.sets[rec.sets.length - 1];
        rec.sets.push({ w: lastSet ? lastSet.w : null, r: null, done: false });
        save(); render(true); return;
      }
      case 'skip': rec.skipped = !rec.skipped; save(); render(true); return;
      case 'swap': {
        if (rec.sets.some(function (x) { return x.done; }) && !confirm('Swapping clears the sets you logged for this exercise. Swap anyway?')) return;
        var alts = P.alternatives(slotFor(a, rec), a.profile);
        var next = alts[(alts.indexOf(rec.exId) + 1) % alts.length];
        a.exercises[Number(d.ei)] = makeEx(rec.slot, next);
        save(); render(true); return;
      }
      case 'finish': finishSession(); return;
      case 'cancel':
        if (confirm('Cancel this workout? Nothing will be saved.')) { S.active = null; save(); render(); }
        return;
      case 'addweight': {
        var date = document.getElementById('wDate').value || L.today();
        var lb = parseFloat(document.getElementById('wVal').value);
        if (!(lb > 50 && lb < 600)) { toast('Enter your weight in pounds'); return; }
        S.weights.push({ id: uid(), date: date, lb: lb });
        save(); render(true); toast('Saved'); scheduleSync(300); return;
      }
      case 'delweight':
        S.weights = S.weights.filter(function (w) { return w.id !== d.id; });
        S.tomb = (S.tomb || []).concat([d.id]);
        save(); render(true); scheduleSync(300); return;
      case 'download': {
        try {
          var blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
          var link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = 'fit-backup-' + L.today() + '.json';
          document.body.appendChild(link); link.click(); link.remove();
        } catch (e) { toast('Use Copy backup text instead'); }
        return;
      }
      case 'copy':
        if (navigator.clipboard) {
          navigator.clipboard.writeText(JSON.stringify(S)).then(function () { toast('Backup copied'); },
            function () { toast('Copy failed'); });
        } else toast('Copy not available here');
        return;
      case 'import': {
        var box = document.getElementById('importBox');
        try {
          var parsed = JSON.parse(box.value);
          if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.sessions) || !Array.isArray(parsed.weights)) throw new Error('bad');
          if (!confirm('Replace everything on this device with this backup?')) return;
          S = Object.assign(defaults(), parsed); save(); view = 'today'; render(); toast('Restored');
        } catch (e) { toast('That does not look like a backup'); }
        return;
      }
      case 'reset':
        if (confirm('Erase everything on this device and sign out of cloud sync? Anything already synced stays in the cloud and comes back when you sign in again.')) {
          if (window.FitSync) FitSync.signOut();
          S = defaults(); save(); summary = null; sync.msg = ''; view = 'today'; render();
        }
        return;
    }
  }

  function onInput(el) {
    var f = el.getAttribute('data-f');
    if (!f) return;
    if (f === 'warm') { if (S.active) { S.active.warm = el.checked; save(); } return; }
    if (f === 'load') {
      var id = el.getAttribute('data-id'), v = el.value === '' ? null : Number(el.value);
      if (v == null || isNaN(v) || v <= 0) delete S.prog[id];
      else S.prog[id] = Object.assign({ extra: 0, miss: 0, last: null }, S.prog[id], { load: v, at: Date.now() });
      save(); scheduleSync(1500); return;
    }
    if (f === 'w' || f === 'r') {
      if (!S.active) return;
      var rec = S.active.exercises[Number(el.getAttribute('data-ei'))];
      var set = rec.sets[Number(el.getAttribute('data-si'))];
      set[f] = el.value === '' ? null : Number(el.value);
      save();
    }
  }

  // ---------- cloud sync ----------
  var sync = { busy: false, again: false, msg: '', timer: null, last: 0 };

  function payload() {
    return { v: 1, sessions: S.sessions, weights: S.weights, tomb: S.tomb || [], prog: S.prog };
  }
  function setSyncStatus(msg) {
    sync.msg = msg;
    var e = document.getElementById('syncStatus');
    if (e) e.textContent = msg;
  }
  function typing() {
    var a = document.activeElement;
    return !!(a && /^(INPUT|TEXTAREA)$/.test(a.tagName));
  }
  function scheduleSync(delay) {
    if (!window.FitSync || !FitSync.signedIn()) return;
    clearTimeout(sync.timer);
    sync.timer = setTimeout(function () { syncNow(false); }, delay || 0);
  }
  function syncNow(manual) {
    if (!window.FitSync || !FitSync.configured() || !FitSync.signedIn()) return Promise.resolve();
    if (sync.busy) { sync.again = true; return Promise.resolve(); }
    sync.busy = true;
    if (manual) setSyncStatus('Syncing…');
    var before = FitSync.canon(FitSync.normalize(payload()));
    return FitSync.run(payload()).then(function (res) {
      // Fold in anything that changed on this device while the request was in flight.
      var merged = FitSync.mergeStates(payload(), res.merged);
      S.sessions = merged.sessions; S.weights = merged.weights; S.tomb = merged.tomb;
      S.prog = merged.prog; S.cycle = merged.cycle;
      save();
      sync.last = Date.now();
      setSyncStatus('Synced ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      var now = FitSync.canon(FitSync.normalize(payload()));
      if (now !== FitSync.canon(FitSync.normalize(res.merged))) sync.again = true;
      if (now !== before && !typing()) render(true);
    }).catch(function (e) {
      if (e && e.offline) setSyncStatus('Offline, will sync when you are back online');
      else if (e && e.auth) { setSyncStatus('Signed out. Sign in again to keep syncing.'); if (view === 'settings') render(true); }
      else setSyncStatus('Sync problem: ' + ((e && e.message) || 'unknown error'));
    }).then(function () {
      sync.busy = false;
      if (sync.again) { sync.again = false; scheduleSync(400); }
    });
  }
  function doAuth(kind) {
    var em = document.getElementById('syEmail'), pw = document.getElementById('syPass');
    var email = em ? em.value.trim() : '', pass = pw ? pw.value : '';
    if (!email || !pass) { toast('Enter your email and password'); return; }
    setSyncStatus(kind === 'signup' ? 'Creating account…' : 'Signing in…');
    var p = kind === 'signup' ? FitSync.signUp(email, pass) : FitSync.signIn(email, pass);
    p.then(function (r) {
      if (r && r.needsConfirm) { setSyncStatus('Check your email to confirm the account, then sign in here.'); return; }
      setSyncStatus('Signed in, syncing…');
      render(true);
      scheduleSync(0);
    }).catch(function (e) {
      setSyncStatus(e && e.offline ? 'No connection right now' : ((e && e.message) || 'Could not sign in'));
    });
  }
  function syncCard() {
    var h = '<section class="card"><h2>Cloud sync</h2>';
    if (!window.FitSync || !FitSync.configured()) {
      return h + '<p class="muted small">Cloud sync is not set up in this copy of the app yet.</p></section>';
    }
    if (FitSync.signedIn()) {
      return h + '<p>Signed in as <b>' + esc(FitSync.email()) + '</b></p>' +
        '<p class="muted small" id="syncStatus">' + esc(sync.msg || 'Ready') + '</p>' +
        '<div class="grid2"><button class="btn" data-act="syncnow">Sync now</button>' +
        '<button class="btn ghost" data-act="signout">Sign out</button></div></section>';
    }
    return h + '<p class="muted small">Sign in to keep your phone and computer in step. Your data is private to your login.</p>' +
      '<div class="stack"><input class="field" type="email" id="syEmail" autocomplete="email" autocapitalize="none" placeholder="Email" aria-label="Email">' +
      '<input class="field" type="password" id="syPass" autocomplete="current-password" placeholder="Password (6+ characters)" aria-label="Password">' +
      '<div class="grid2"><button class="btn primary" data-act="signin">Sign in</button>' +
      '<button class="btn" data-act="signup">Create account</button></div>' +
      '<p class="muted small" id="syncStatus">' + esc(sync.msg) + '</p></div></section>';
  }

  // ---------- wiring ----------
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (el) act(el.getAttribute('data-act'), {
      v: el.getAttribute('data-v'), p: el.getAttribute('data-p'), idx: el.getAttribute('data-idx'),
      ei: el.getAttribute('data-ei'), si: el.getAttribute('data-si'), id: el.getAttribute('data-id')
    });
  });
  document.addEventListener('input', function (e) { onInput(e.target); });
  document.addEventListener('change', function (e) { onInput(e.target); });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  window.addEventListener('online', function () { scheduleSync(500); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - sync.last > 60000) scheduleSync(300);
  });

  window.__fit = { act: act, onInput: onInput, render: render, state: function () { return S; },
                   setView: function (v) { view = v; }, syncNow: syncNow };
  render();
  scheduleSync(800);
})();
