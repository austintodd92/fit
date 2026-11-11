/* Running: interval levels, timer engine, GPS distance, level progression. Pure functions, no DOM. */
(function (root) {
  'use strict';

  var WARM = 300, COOL = 300;           // seconds of easy walking before and after
  var METERS_PER_MILE = 1609.344;

  // Run/walk levels. Level 4 uses 3-minute runs, the length of a West Coast Swing routine.
  var LEVELS = [
    { n: 1,  run: 60,   walk: 120, reps: 8 },
    { n: 2,  run: 90,   walk: 120, reps: 7 },
    { n: 3,  run: 120,  walk: 120, reps: 6 },
    { n: 4,  run: 180,  walk: 120, reps: 5 },
    { n: 5,  run: 300,  walk: 90,  reps: 4 },
    { n: 6,  run: 480,  walk: 120, reps: 3 },
    { n: 7,  run: 720,  walk: 120, reps: 2 },
    { n: 8,  run: 900,  walk: 90,  reps: 2 },
    { n: 9,  run: 1800, walk: 0,   reps: 1 },
    { n: 10, run: 2100, walk: 0,   reps: 1 }
  ];
  var MAX_LEVEL = LEVELS.length;

  // ---------- formatting ----------
  function z(n) { return n < 10 ? '0' + n : String(n); }
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? h + ':' + z(m) + ':' + z(s) : m + ':' + z(s);
  }
  function fmtMin(sec) {   // 90 -> "1:30", 120 -> "2:00"
    return Math.floor(sec / 60) + ':' + z(Math.round(sec % 60));
  }
  function milesOf(meters) { return meters / METERS_PER_MILE; }
  function fmtPace(secPerMile) {
    if (!isFinite(secPerMile) || secPerMile <= 0 || secPerMile > 3600) return '–';
    return fmtTime(secPerMile);
  }

  // ---------- plans ----------
  function buildSegments(run, walk, reps) {
    var segs = [{ type: 'walk', phase: 'warm', sec: WARM, label: 'Warm-up walk' }];
    for (var i = 1; i <= reps; i++) {
      segs.push({ type: 'run', phase: 'run', sec: run, label: reps > 1 ? 'Run ' + i + ' of ' + reps : 'Run' });
      if (i < reps && walk > 0) segs.push({ type: 'walk', phase: 'walk', sec: walk, label: 'Walk' });
    }
    segs.push({ type: 'walk', phase: 'cool', sec: COOL, label: 'Cool-down walk' });
    return segs;
  }
  function totalSec(segs) { return segs.reduce(function (a, s) { return a + s.sec; }, 0); }

  function describe(run, walk, reps) {
    if (reps === 1) return fmtMin(run) + ' continuous run';
    return reps + ' × (' + fmtMin(run) + ' run, ' + fmtMin(walk) + ' walk)';
  }
  function plan(run, walk, reps, title) {
    var segs = buildSegments(run, walk, reps);
    return { title: title, run: run, walk: walk, reps: reps, segs: segs,
             totalSec: totalSec(segs), desc: describe(run, walk, reps) };
  }
  function levelPlan(n) {
    n = Math.max(1, Math.min(MAX_LEVEL, n));
    var L = LEVELS[n - 1];
    return plan(L.run, L.walk, L.reps, 'Level ' + n);
  }
  function customPlan(runSec, walkSec, reps) {
    return plan(runSec, walkSec, reps, 'Custom intervals');
  }

  // ---------- timer engine ----------
  function stateAt(segs, t) {
    var total = totalSec(segs);
    t = Math.max(0, t);
    if (t >= total) {
      return { done: true, i: segs.length, seg: null, into: 0, remaining: 0, remainingCeil: 0,
               next: null, elapsed: total, total: total, left: 0 };
    }
    var acc = 0;
    for (var i = 0; i < segs.length; i++) {
      var end = acc + segs[i].sec;
      if (t < end) {
        var rem = end - t;
        return { done: false, i: i, seg: segs[i], into: t - acc, remaining: rem,
                 remainingCeil: Math.ceil(rem - 1e-9), next: segs[i + 1] || null,
                 elapsed: t, total: total, left: total - t };
      }
      acc = end;
    }
  }

  // Sounds to play when moving from state prev to state cur.
  function cues(prev, cur) {
    var out = [];
    if (!prev) {
      out.push({ name: 'go', type: cur.seg.type, phase: cur.seg.phase });
      return out;
    }
    if (cur.i !== prev.i) {
      if (cur.done) out.push({ name: 'finish' });
      else out.push({ name: 'go', type: cur.seg.type, phase: cur.seg.phase });
      return out;
    }
    if (!cur.done && cur.seg.sec >= 10) {
      [3, 2, 1].forEach(function (n) {
        if (prev.remainingCeil > n && cur.remainingCeil <= n) out.push({ name: 'tick', n: n });
      });
    }
    return out;
  }

  // ---------- GPS distance ----------
  function haversine(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function newTrack() { return { dist: 0, last: null }; }
  function resetAnchor(track) { track.last = null; }

  // fix: { lat, lon, acc (m), t (ms) }. Returns what happened so the UI can show GPS quality.
  function addFix(track, fix, opts) {
    opts = opts || {};
    var maxAcc = opts.maxAcc || 30, minMove = opts.minMove || 4, maxSpeed = opts.maxSpeed || 8; // m, m, m/s
    if (fix.acc > maxAcc) return 'inaccurate';
    if (!track.last) { track.last = fix; return 'anchored'; }
    var d = haversine(track.last, fix);
    var dt = (fix.t - track.last.t) / 1000;
    if (d < minMove) return 'still';
    if (dt > 0 && d / dt > maxSpeed) return 'jump';
    track.dist += d;
    track.last = fix;
    return 'moved';
  }

  // ---------- level progression ----------
  function defaultProg() { return { level: 1, last: null, at: 0 }; }

  function daysBetween(a, b) {
    var p = function (s) { var x = s.split('-').map(Number); return new Date(x[0], x[1] - 1, x[2]); };
    return Math.round((p(b) - p(a)) / 86400000);
  }

  // Which level to offer today. After a long gap, ease back.
  function suggestLevel(prog, todayISO) {
    var p = prog || defaultProg();
    var level = p.level || 1, gap = p.last ? daysBetween(p.last, todayISO) : null, eased = 0;
    if (gap != null && gap >= 14) eased = gap >= 28 ? 2 : 1;
    level = Math.max(1, level - eased);
    return { level: level, gap: gap, eased: eased > 0 && level < (p.level || 1) };
  }

  // run: { level (null for custom), completed, fraction (0..1), reason ('hard'|'time'|'pain'|null), rpe (1..10|null) }
  function evaluateRun(prog, run, todayISO) {
    var p = prog || defaultProg();
    var next = { level: p.level || 1, last: todayISO, at: p.at || 0 };
    if (run.level == null) {
      return { prog: next, result: 'free', note: 'Logged. Your level stays at ' + next.level + '.' };
    }
    var lvl = run.level;
    if (run.completed) {
      if (run.rpe != null && run.rpe >= 8) {
        next.level = lvl;
        return { prog: next, result: 'repeat', note: 'That felt hard, so level ' + lvl + ' again next time.' };
      }
      next.level = Math.min(MAX_LEVEL, lvl + 1);
      return next.level > lvl
        ? { prog: next, result: 'up', note: 'Level ' + next.level + ' next time.' }
        : { prog: next, result: 'repeat', note: 'You are at the top level. Keep building your time.' };
    }
    if (run.reason === 'hard' && run.fraction < 0.5) {
      next.level = Math.max(1, lvl - 1);
      return next.level < lvl
        ? { prog: next, result: 'down', note: 'Stepping back to level ' + next.level + ' next time.' }
        : { prog: next, result: 'repeat', note: 'Level 1 again next time. Take it easy.' };
    }
    next.level = lvl;
    if (run.reason === 'pain') {
      return { prog: next, result: 'repeat', note: 'Level ' + lvl + ' stays. If something keeps hurting, rest and get it checked.' };
    }
    return { prog: next, result: 'repeat', note: 'Level ' + lvl + ' stays, try again next time.' };
  }

  var api = { WARM: WARM, COOL: COOL, LEVELS: LEVELS, MAX_LEVEL: MAX_LEVEL, METERS_PER_MILE: METERS_PER_MILE,
              fmtTime: fmtTime, fmtMin: fmtMin, fmtPace: fmtPace, milesOf: milesOf,
              buildSegments: buildSegments, totalSec: totalSec, levelPlan: levelPlan, customPlan: customPlan,
              stateAt: stateAt, cues: cues, haversine: haversine, newTrack: newTrack, resetAnchor: resetAnchor,
              addFix: addFix, defaultProg: defaultProg, suggestLevel: suggestLevel, evaluateRun: evaluateRun };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FitRunLogic = api;
})(typeof window !== 'undefined' ? window : this);
