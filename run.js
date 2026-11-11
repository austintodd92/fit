/* Run tab: live interval timer with sound cues, GPS distance, treadmill mode, effort check-in.
   Timing uses wall-clock timestamps, so it stays correct even if the phone throttles this page. */
(function () {
  'use strict';
  var RL = window.FitRunLogic, L = window.FitLogic;
  var A = null;                                   // bridge to app.js, set by init()
  var clock = function () { return Date.now(); };  // replaceable in tests

  var run = null;        // the live run, or null
  var fin = null;        // the end-of-run form, or null
  var pick = null;       // level chosen by hand
  var lastSaved = null;  // summary shown after saving
  var timer = null, ac = null, wake = null;
  var gps = { id: null, status: 'off', acc: null };

  function esc(s) { return A.esc(s); }
  function prefs() {
    var S = A.state();
    if (!S.runPrefs) S.runPrefs = { mode: 'outdoor', cue: 'beep' };
    return S.runPrefs;
  }
  function suggestion() { return RL.suggestLevel(A.state().runProg, L.today()); }

  // ---------- sound ----------
  function sessionType() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (e) { /* not supported */ }
  }
  function audio() {
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    if (!ac) ac = new C();
    if (ac.state === 'suspended' && ac.resume) ac.resume();
    return ac;
  }
  function beep(freq, len, delay, vol) {
    var a = audio();
    if (!a) return;
    var t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.6, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g);
    g.connect(a.destination);
    o.start(t);
    o.stop(t + len + 0.03);
  }
  function say(text) {
    try {
      if (window.speechSynthesis) {
        var u = new SpeechSynthesisUtterance(text);
        u.rate = 1.05;
        window.speechSynthesis.speak(u);
      }
    } catch (e) { /* voice not available */ }
  }
  var SAY = { warm: 'Warm up', run: 'Run', walk: 'Walk', cool: 'Cool down' };
  function playCue(c) {
    var mode = prefs().cue;
    if (mode === 'off') return;
    if (c.name === 'tick') {
      beep(880, 0.12, 0, 0.5);
    } else if (c.name === 'go') {
      if (c.type === 'run') { beep(1000, 0.14, 0); beep(1000, 0.14, 0.2); beep(1500, 0.3, 0.4); }
      else { beep(1300, 0.14, 0); beep(900, 0.14, 0.2); beep(600, 0.3, 0.4); }
      if (mode === 'both') say(SAY[c.phase]);
    } else if (c.name === 'finish') {
      beep(900, 0.15, 0); beep(1200, 0.15, 0.2); beep(1600, 0.4, 0.4);
      if (mode === 'both') say('Done. Great work.');
    }
  }
  function testSound() {
    sessionType();
    audio();
    playCue({ name: 'go', type: 'run', phase: 'run' });
    setTimeout(function () { playCue({ name: 'go', type: 'walk', phase: 'walk' }); }, 1100);
    A.toast('Playing test sound');
  }

  // ---------- screen and GPS ----------
  function lockScreen() {
    if (wake) return;
    try {
      if (navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock.request('screen').then(function (l) {
          if (!run) { l.release(); return; }     // the run ended before the lock arrived
          wake = l;
          l.addEventListener('release', function () { wake = null; });
        }).catch(function () { wake = null; });
      }
    } catch (e) { /* not supported */ }
  }
  function unlockScreen() {
    try { if (wake) wake.release(); } catch (e) { /* ignore */ }
    wake = null;
  }
  function startGPS() {
    stopGPS();
    if (!navigator.geolocation) { gps.status = 'unavailable'; return; }
    gps.status = 'searching';
    gps.id = navigator.geolocation.watchPosition(onFix, onGpsErr, { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 });
  }
  function stopGPS() {
    if (gps.id != null && navigator.geolocation) navigator.geolocation.clearWatch(gps.id);
    gps.id = null;
  }
  function onFix(pos) {
    var c = pos.coords;
    gps.acc = c.accuracy;
    if (!run || run.pausedAt || run.mode !== 'outdoor') { gps.status = c.accuracy <= 30 ? 'ok' : 'weak'; return; }
    var r = RL.addFix(run.track, { lat: c.latitude, lon: c.longitude, acc: c.accuracy, t: pos.timestamp || clock() });
    gps.status = r === 'inaccurate' ? 'weak' : 'ok';
  }
  function onGpsErr(e) { gps.status = e && e.code === 1 ? 'denied' : 'searching'; }

  // ---------- run lifecycle ----------
  function elapsed() {
    return Math.max(0, ((run.pausedAt || clock()) - run.startedAt - run.pausedTotal) / 1000);
  }
  function planFor(level, custom) {
    return level ? RL.levelPlan(level) : RL.customPlan(custom.run, custom.walk, custom.reps);
  }

  function startRun(opts) {
    if (run) return;
    var p = prefs();
    run = { startedAt: clock(), pausedTotal: 0, pausedAt: null, mode: p.mode,
            level: opts.level || null, custom: opts.custom || null,
            plan: planFor(opts.level, opts.custom), track: RL.newTrack(), last: null, ck: 0 };
    sessionType(); audio(); lockScreen();
    if (run.mode === 'outdoor') startGPS(); else gps.status = 'off';
    begin();
  }
  function begin() {
    tick();
    if (!timer) timer = setInterval(tick, 250);
    A.rerender();
  }

  function tick() {
    if (!run) return;
    var st = RL.stateAt(run.plan.segs, elapsed());
    if (!run.pausedAt) {
      RL.cues(run.last, st).forEach(playCue);
      run.last = st;
      if (st.done) { finishRun(true); return; }
    } else if (!run.last) {
      run.last = st;
    }
    updateLive(st);
    checkpoint();
  }

  // Save a restore point every few seconds, so a reload mid-run can pick up where it left off.
  function checkpoint() {
    if (!run) return;
    var n = clock();
    if (n - run.ck < 5000) return;
    run.ck = n;
    A.state().activeRun = { startedAt: run.startedAt, pausedTotal: run.pausedTotal, pausedAt: run.pausedAt,
                            mode: run.mode, level: run.level, custom: run.custom, dist: run.track.dist,
                            savedAt: n, elapsedAtSave: elapsed() };
    A.save();
  }

  function haltRun() {
    if (timer) { clearInterval(timer); timer = null; }
    stopGPS();
    unlockScreen();
    run = null;
  }
  function finishRun(completed) {
    var el = Math.min(elapsed(), run.plan.totalSec);
    fin = { run: { mode: run.mode, level: run.level, custom: run.custom, plan: run.plan },
            completed: completed, elapsed: el, meters: run.track.dist, reason: null, rpe: null, tm: '' };
    haltRun();
    A.rerender();
  }

  function togglePause() {
    if (!run) return;
    if (run.pausedAt) {
      run.pausedTotal += clock() - run.pausedAt;
      run.pausedAt = null;
      RL.resetAnchor(run.track);
      lockScreen();
    } else {
      run.pausedAt = clock();
    }
    run.ck = 0;
    checkpoint();
    tick();
  }
  function skip() {
    if (!run || run.pausedAt) return;
    var st = RL.stateAt(run.plan.segs, elapsed());
    if (st.done) return;
    run.startedAt -= st.remaining * 1000;
    tick();
  }

  function resumeFromCheckpoint() {
    var cp = A.state().activeRun;
    if (!cp || run) return;
    run = { startedAt: cp.startedAt, pausedTotal: cp.pausedTotal || 0, pausedAt: cp.pausedAt || null,
            mode: cp.mode, level: cp.level, custom: cp.custom, plan: planFor(cp.level, cp.custom),
            track: { dist: cp.dist || 0, last: null }, last: null, ck: 0 };
    run.last = RL.stateAt(run.plan.segs, elapsed());   // no cue for a moment already in progress
    sessionType(); audio(); lockScreen();
    if (run.mode === 'outdoor') startGPS(); else gps.status = 'off';
    begin();
  }
  function endFromCheckpoint() {
    var cp = A.state().activeRun;
    if (!cp) return;
    var plan = planFor(cp.level, cp.custom), el = Math.min(cp.elapsedAtSave || 0, plan.totalSec);
    fin = { run: { mode: cp.mode, level: cp.level, custom: cp.custom, plan: plan },
            completed: el >= plan.totalSec - 5, elapsed: el, meters: cp.dist || 0, reason: null, rpe: null, tm: '' };
    A.rerender();
  }

  function stashTm() {
    var e = document.getElementById('runTmMi');
    if (e && fin) fin.tm = e.value;
  }
  function saveFinish() {
    var S = A.state(), f = fin, today = L.today();
    stashTm();
    if (f.completed && f.rpe == null) { A.toast('Pick how hard it felt'); return; }
    if (!f.completed && !f.reason) { A.toast('Tell me why you stopped'); return; }
    var miles = null;
    if (f.run.mode === 'outdoor') {
      if (f.meters >= 30) miles = RL.milesOf(f.meters);
    } else {
      var v = parseFloat(f.tm);
      if (v > 0 && v < 60) miles = v;
    }
    var fraction = f.run.plan.totalSec ? Math.min(1, f.elapsed / f.run.plan.totalSec) : 0;
    var ev = RL.evaluateRun(S.runProg, { level: f.run.level, completed: f.completed, fraction: fraction,
                                          reason: f.reason, rpe: f.rpe }, today);
    ev.prog.at = clock();
    S.runProg = ev.prog;
    S.runs.unshift({ id: A.uid(), date: today, mode: f.run.mode, level: f.run.level, custom: f.run.custom,
                     plannedSec: f.run.plan.totalSec, durationSec: Math.round(f.elapsed),
                     distanceMi: miles == null ? null : Math.round(miles * 100) / 100,
                     completed: f.completed, reason: f.reason, rpe: f.rpe, finishedAt: clock() });
    S.activeRun = null;
    fin = null; pick = null;
    lastSaved = { note: ev.note, result: ev.result };
    A.save();
    A.rerender();
    A.sync(300);
  }

  // ---------- rendering ----------
  function seg(cols, items, cur, action) {
    return '<div class="seg" style="grid-template-columns:repeat(' + cols + ',1fr)">' + items.map(function (it) {
      return '<button class="' + (cur === it[0] ? 'on' : '') + '" data-act="' + action + '" data-val="' + it[0] + '">' + esc(it[1]) + '</button>';
    }).join('') + '</div>';
  }

  function weekLine() {
    var S = A.state(), wk = L.weekStart(L.today()), n = 0, sec = 0, mi = 0;
    (S.runs || []).forEach(function (r) {
      if (L.weekStart(r.date) === wk) { n++; sec += r.durationSec || 0; mi += r.distanceMi || 0; }
    });
    if (!n) return '';
    return '<p class="muted small">This week: ' + n + ' run' + (n > 1 ? 's' : '') + ' · ' + Math.round(sec / 60) + ' min' +
           (mi > 0 ? ' · ' + mi.toFixed(1) + ' mi' : '') + '</p>';
  }

  function recentRuns() {
    var S = A.state(), runs = (S.runs || []).slice(0, 8);
    if (!runs.length) return '';
    return '<section class="card"><h2>Recent runs</h2>' + runs.map(function (r) {
      var bits = [RL.fmtTime(r.durationSec)];
      if (r.distanceMi) bits.push(r.distanceMi.toFixed(2) + ' mi');
      if (r.distanceMi && r.durationSec) bits.push(RL.fmtPace(r.durationSec / r.distanceMi) + '/mi');
      if (r.rpe) bits.push('effort ' + r.rpe);
      return '<div class="wrow"><div><b>' + esc(A.shortDate(r.date)) + ' · ' + (r.level ? 'Level ' + r.level : 'Custom') +
             (r.completed ? '' : ' (stopped early)') + '</b><br><span class="muted small">' +
             (r.mode === 'outdoor' ? 'Outdoor' : 'Treadmill') + ' · ' + esc(bits.join(' · ')) + '</span></div></div>';
    }).join('') + '</section>';
  }

  function renderIdle() {
    var S = A.state(), p = prefs(), sug = suggestion();
    var level = pick || sug.level, plan = RL.levelPlan(level), h = '';
    if (lastSaved) {
      h += '<section class="card summary"><div class="eyebrow">Run saved</div><p><b>' + esc(lastSaved.note) + '</b></p>' +
           '<button class="btn block" data-act="runsummary">Done</button></section>';
    }
    if (S.activeRun) {
      var started = new Date(S.activeRun.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      h += '<section class="card"><div class="eyebrow">Run in progress</div><h2>A run from ' + esc(started) + ' is still open</h2>' +
           '<p class="muted small">The clock kept going while the app was closed. Distance covered in that time is not counted.</p>' +
           '<div class="stack"><button class="btn primary block" data-act="runresume">Resume run</button>' +
           '<div class="grid2"><button class="btn" data-act="runresumesave">End and save</button>' +
           '<button class="btn ghost danger" data-act="runresumedrop">Discard</button></div></div></section>';
    }
    h += '<section class="card"><div class="eyebrow">Next run</div><h1>Level ' + level + '</h1>' +
         '<p class="muted">' + esc(plan.desc) + ' · about ' + Math.round(plan.totalSec / 60) + ' min</p>';
    if (!pick && sug.eased) h += '<span class="badge warn">Eased back after ' + sug.gap + ' days away</span>';
    h += '<ul class="plist"><li><span>Warm-up walk</span><span class="meta">' + RL.fmtMin(RL.WARM) + '</span></li>' +
         '<li><span>Intervals</span><span class="meta">' + esc(plan.desc) + '</span></li>' +
         '<li><span>Cool-down walk</span><span class="meta">' + RL.fmtMin(RL.COOL) + '</span></li></ul>' +
         '<div class="grid2"><button class="btn sm" data-act="runlvl" data-d="-1">− Easier</button>' +
         '<button class="btn sm" data-act="runlvl" data-d="1">Harder +</button></div>' +
         seg(2, [['outdoor', 'Outdoor (GPS)'], ['treadmill', 'Treadmill']], p.mode, 'runmode') +
         seg(3, [['beep', 'Beeps'], ['both', 'Beeps + voice'], ['off', 'Silent']], p.cue, 'runcue') +
         '<button class="btn primary block" data-act="runstart">Start run</button>' +
         '<div class="stack" style="margin-top:10px"><button class="btn block" data-act="runtest">Test sound</button>' +
         '<p class="muted small">' + (('audioSession' in navigator)
           ? 'This browser can mix the cues with your music. Start your music first, then test.'
           : 'Mixing with music is not confirmed on this browser. Start your music, tap Test sound, and check that it keeps playing.') +
         '</p></div>' + weekLine() + '</section>';
    h += '<section class="card"><details><summary><b>Custom intervals</b></summary>' +
         '<div class="inline3"><input class="field" id="rcRun" type="number" inputmode="decimal" step="0.25" placeholder="Run min" aria-label="Run minutes">' +
         '<input class="field" id="rcWalk" type="number" inputmode="decimal" step="0.25" placeholder="Walk min" aria-label="Walk minutes">' +
         '<input class="field" id="rcReps" type="number" inputmode="numeric" placeholder="Rounds" aria-label="Rounds"></div>' +
         '<button class="btn block" data-act="runstartcustom">Start custom run</button>' +
         '<p class="muted small">Custom runs are logged but do not change your level.</p></details></section>';
    return h + recentRuns();
  }

  function renderLive() {
    return '<section class="card live"><div class="eyebrow" id="runChip">&nbsp;</div>' +
      '<div class="phase warm" id="runPhase">&nbsp;</div><div class="clock" id="runClock">0:00</div>' +
      '<div class="muted" id="runNext">&nbsp;</div><div class="bar"><span id="runBar"></span></div>' +
      '<div class="stats"><div><span id="runElapsed">0:00</span><small>elapsed</small></div>' +
      '<div><span id="runDist">–</span><small>miles</small></div>' +
      '<div><span id="runPace">–</span><small>avg pace /mi</small></div></div>' +
      '<p class="small muted" id="runStatus"></p>' +
      '<div class="grid2"><button class="btn" id="runPause" data-act="runpause">Pause</button>' +
      '<button class="btn" data-act="runskip">Skip ahead</button></div>' +
      '<button class="btn ghost danger block" style="margin-top:10px" data-act="runend">End run</button></section>';
  }

  function renderFinish() {
    var f = fin, h = '<section class="card"><div class="eyebrow">' + (f.completed ? 'Run complete' : 'Run ended') + '</div>' +
      '<h1>' + RL.fmtTime(f.elapsed) + '</h1>';
    if (f.run.mode === 'outdoor') {
      var mi = RL.milesOf(f.meters);
      h += '<p class="muted">' + (f.meters >= 30 ? mi.toFixed(2) + ' miles · ' + RL.fmtPace(f.elapsed / mi) + ' /mi average'
                                                   : 'No GPS distance recorded') + '</p>';
    } else {
      h += '<input class="field" id="runTmMi" type="number" inputmode="decimal" step="0.01" placeholder="Treadmill distance in miles (optional)" value="' + esc(f.tm || '') + '" aria-label="Treadmill distance">';
    }
    if (!f.completed) {
      h += '<h2 style="margin-top:14px">Why did you stop?</h2>' +
           seg(3, [['hard', 'Too hard'], ['time', 'Out of time'], ['pain', 'Pain']], f.reason, 'runreason');
    }
    h += '<h2 style="margin-top:14px">How hard did it feel?</h2><div class="rpe">';
    for (var i = 1; i <= 10; i++) {
      h += '<button class="' + (f.rpe === i ? 'on' : '') + '" data-act="runrpe" data-val="' + i + '">' + i + '</button>';
    }
    h += '</div><p class="muted small">1 very easy · 5 steady · 8 very hard · 10 all out</p>' +
         '<div class="stack"><button class="btn primary block" data-act="runsave">Save run</button>' +
         '<button class="btn ghost danger block" data-act="rundiscard">Discard</button></div></section>';
    return h;
  }

  function render() {
    if (fin) return renderFinish();
    if (run) return renderLive();
    return renderIdle();
  }

  // ---------- live updates (no re-render, so nothing flickers) ----------
  function set(id, txt) {
    var e = document.getElementById(id);
    if (e && e.textContent !== txt) e.textContent = txt;
  }
  var CHIP = { ok: null, weak: 'GPS weak', searching: 'Finding GPS…', denied: 'Location blocked', unavailable: 'No GPS', off: '' };
  function chip() {
    var bits = [];
    if (run.pausedAt) bits.push('Paused');
    if (run.mode === 'treadmill') bits.push('Treadmill');
    else bits.push(gps.status === 'ok' ? 'GPS ±' + Math.round(gps.acc || 0) + ' m' : CHIP[gps.status]);
    bits.push(wake ? 'Screen stays on' : 'Keep screen on');
    return bits.filter(Boolean).join(' · ');
  }
  function updateLive(st) {
    if (!run) return;
    var s = st.seg || run.plan.segs[run.plan.segs.length - 1];
    var ph = document.getElementById('runPhase');
    if (ph) {
      var label = { warm: 'WARM-UP', run: 'RUN', walk: 'WALK', cool: 'COOL-DOWN' }[s.phase];
      if (ph.textContent !== label) ph.textContent = label;
      ph.className = 'phase ' + s.phase;
    }
    set('runClock', RL.fmtTime(Math.ceil(st.remaining)));
    set('runNext', st.next ? 'Next: ' + { run: 'run', walk: 'walk', cool: 'cool-down', warm: 'warm-up' }[st.next.phase] + ' ' + RL.fmtMin(st.next.sec) : 'Last stretch');
    var bar = document.getElementById('runBar');
    if (bar && bar.style) bar.style.width = Math.min(100, st.elapsed / st.total * 100).toFixed(1) + '%';
    set('runElapsed', RL.fmtTime(st.elapsed));
    if (run.mode === 'outdoor') {
      var mi = RL.milesOf(run.track.dist);
      set('runDist', mi.toFixed(2));
      set('runPace', mi > 0.03 ? RL.fmtPace(st.elapsed / mi) : '–');
    } else { set('runDist', '–'); set('runPace', '–'); }
    set('runChip', chip());
    set('runPause', run.pausedAt ? 'Resume' : 'Pause');
    set('runStatus', gps.status === 'denied' && run.mode === 'outdoor'
      ? 'Location is blocked for this app. Allow it in iPhone Settings, Privacy & Security, Location Services, then start again.'
      : '');
  }

  // ---------- actions ----------
  function startCustom() {
    var r = parseFloat((document.getElementById('rcRun') || {}).value),
        w = parseFloat((document.getElementById('rcWalk') || {}).value),
        n = parseInt((document.getElementById('rcReps') || {}).value, 10);
    if (!(r >= 0.25 && r <= 60) || !(w >= 0 && w <= 30) || !(n >= 1 && n <= 30)) {
      A.toast('Enter run minutes, walk minutes and rounds'); return;
    }
    startRun({ custom: { run: Math.round(r * 60), walk: Math.round(w * 60), reps: n } });
  }

  function act(name, d) {
    var p = prefs();
    switch (name) {
      case 'runlvl':
        pick = Math.max(1, Math.min(RL.MAX_LEVEL, (pick || suggestion().level) + Number(d.d)));
        A.rerender(true); return;
      case 'runmode': p.mode = d.val; A.save(); A.rerender(true); return;
      case 'runcue': p.cue = d.val; A.save(); A.rerender(true); return;
      case 'runtest': testSound(); return;
      case 'runstart': startRun({ level: pick || suggestion().level }); return;
      case 'runstartcustom': startCustom(); return;
      case 'runpause': togglePause(); return;
      case 'runskip': skip(); return;
      case 'runend': if (run && confirm('End this run now?')) finishRun(false); return;
      case 'runreason': stashTm(); fin.reason = d.val; A.rerender(true); return;
      case 'runrpe': stashTm(); fin.rpe = Number(d.val); A.rerender(true); return;
      case 'runsave': saveFinish(); return;
      case 'rundiscard':
        if (confirm('Discard this run? Nothing will be saved.')) {
          fin = null; A.state().activeRun = null; A.save(); A.rerender();
        }
        return;
      case 'runresume': resumeFromCheckpoint(); return;
      case 'runresumesave': endFromCheckpoint(); return;
      case 'runresumedrop': A.state().activeRun = null; A.save(); A.rerender(true); return;
      case 'runsummary': lastSaved = null; A.rerender(true); return;
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && run) {
      if (!wake && !run.pausedAt) lockScreen();
      tick();
    }
  });

  window.FitRunUI = {
    init: function (bridge) { A = bridge; },
    render: render,
    act: act,
    afterRender: function () {
      if (run) { if (!timer) timer = setInterval(tick, 250); updateLive(RL.stateAt(run.plan.segs, elapsed())); }
    },
    // test hooks
    _setClock: function (fn) { clock = fn; },
    _tick: tick,
    _live: function () { return { run: run, fin: fin }; }
  };
})();
