/* Progression, step-back and weight-average logic. Pure functions, no DOM. */
(function (root) {
  'use strict';

  var CAP = 4; // max extra reps added once a lift is at its weight ceiling

  function parseDate(s) {
    var p = s.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function fmtDate(d) {
    var z = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }
  function today() { return fmtDate(new Date()); }
  function daysBetween(a, b) {
    return Math.round((parseDate(b) - parseDate(a)) / 86400000);
  }
  function roundTo(x, step) { return step > 0 ? Math.round(x / step) * step : x; }

  // Gap since the exercise was last trained -> how far to step back.
  function stepBackPct(days) {
    if (days == null || days < 8) return 0;
    if (days <= 14) return 0.10;
    if (days <= 28) return 0.15;
    return 0.20;
  }

  // What to do next time for one exercise.
  // ex: plan definition, prog: stored progress (or undefined), todayISO: 'YYYY-MM-DD'
  function suggest(ex, prog, todayISO) {
    var out = { load: ex.kind === 'bw' ? 0 : null, sets: ex.sets, top: ex.hi, extra: 0,
                pct: 0, gap: null, tempo: false, atMax: false };
    if (!prog) return out;
    var load = ex.kind === 'bw' ? 0 : prog.load;
    var extra = prog.extra || 0;
    var gap = prog.last ? daysBetween(prog.last, todayISO) : null;
    var pct = stepBackPct(gap);
    out.gap = gap;
    if (pct > 0) {
      out.pct = pct;
      if (ex.kind === 'bw') {
        extra = Math.max(0, extra - 2);
      } else if (load != null) {
        load = Math.max(ex.step, roundTo(load * (1 - pct), ex.step));
        extra = 0;
      }
      out.sets = Math.max(2, Math.min(ex.sets, 3));
    }
    out.load = load;
    out.extra = extra;
    out.top = ex.hi + extra;
    out.atMax = ex.kind !== 'bw' && ex.max != null && load != null && load >= ex.max;
    out.tempo = extra >= CAP && (out.atMax || ex.kind === 'bw');
    return out;
  }

  // Score a finished exercise and return the updated progress.
  // rec: { load, top, lo, extra, plannedSets, sets:[{w,r,done}] }
  function evaluate(ex, prog, rec, dateISO) {
    var done = rec.sets.filter(function (s) { return s.done && s.r > 0; });
    if (!done.length) return { prog: prog, result: 'skipped', note: '' };

    var used = 0;
    if (ex.kind !== 'bw') {
      var ws = done.map(function (s) { return Number(s.w); }).filter(function (w) { return w > 0; });
      if (!ws.length) return { prog: prog, result: 'skipped', note: 'No weight entered' };
      used = Math.min.apply(null, ws);
      // Lighter than planned (e.g. lighter hotel dumbbells): log it, change nothing.
      if (rec.load != null && used < rec.load - 1e-9) {
        return { prog: prog, result: 'off-plan', note: 'Lighter than planned, plan unchanged' };
      }
    }

    var prev = prog || { load: used, extra: 0, miss: 0, last: null };
    var success = done.length >= rec.plannedSets &&
                  done.every(function (s) { return s.r >= rec.top; });
    var miss = done.some(function (s) { return s.r < rec.lo; });
    var atCeiling = ex.kind === 'bw' || (ex.max != null && used >= ex.max);

    var next = { load: used, extra: rec.extra, miss: 0, last: dateISO };
    var result = 'hold', note = '';

    if (success) {
      if (atCeiling) {
        next.extra = Math.min(rec.extra + 1, CAP);
        result = 'reps';
        note = rec.extra + 1 > CAP
          ? 'Add a slow 3-second lowering next time'
          : 'Aim for ' + (ex.hi + next.extra) + ' reps next time';
      } else {
        next.load = used + ex.step;
        next.extra = 0;
        result = 'up';
        note = 'Up to ' + next.load;
      }
    } else if (miss) {
      next.miss = (prev.miss || 0) + 1;
      if (next.miss >= 2) {
        next.miss = 0;
        if (ex.kind === 'bw') {
          next.extra = Math.max(0, rec.extra - 1);
          result = 'down';
          note = 'Easing the rep target';
        } else {
          next.load = Math.max(ex.step, roundTo(used * 0.9, ex.step));
          next.extra = 0;
          result = 'down';
          note = 'Two tough sessions in a row, dropping to ' + next.load;
        }
      } else {
        note = 'Hold, missed reps (1 of 2)';
      }
    } else {
      note = 'Hold, keep building reps';
    }
    return { prog: next, result: result, note: note, used: used };
  }

  function weekStart(dateISO) {
    var d = parseDate(dateISO);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
    return fmtDate(d);
  }

  function weeklyAverages(entries) {
    var m = {};
    entries.forEach(function (e) {
      var k = weekStart(e.date);
      (m[k] = m[k] || []).push(Number(e.lb));
    });
    return Object.keys(m).sort().map(function (k) {
      var sum = m[k].reduce(function (a, b) { return a + b; }, 0);
      return { week: k, avg: sum / m[k].length, n: m[k].length };
    });
  }

  var api = { CAP: CAP, parseDate: parseDate, fmtDate: fmtDate, today: today,
              daysBetween: daysBetween, roundTo: roundTo, stepBackPct: stepBackPct,
              suggest: suggest, evaluate: evaluate, weekStart: weekStart,
              weeklyAverages: weeklyAverages };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FitLogic = api;
})(typeof window !== 'undefined' ? window : this);
