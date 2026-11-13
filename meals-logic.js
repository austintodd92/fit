/* Meals: macro math, recipes, daily targets, target calibration, simple meal ideas. Pure functions. */
(function (root) {
  'use strict';
  var Lg = root.FitLogic || (typeof require !== 'undefined' ? require('./logic.js') : null);

  var SLOTS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snacks']];
  var MIN_LOGGED_KCAL = 800;   // a day under this counts as "not really logged"
  var KCAL_FLOOR = 1800;       // calibration never suggests going below this
  var MAX_STEP = 250;          // calibration moves the target at most this much at a time

  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
  function r0(x) { return Math.round(x); }
  function r1(x) { return Math.round(x * 10) / 10; }
  function r5(x) { return Math.round(x / 5) * 5; }
  function r25(x) { return Math.round(x / 25) * 25; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function fmtQty(q) { return String(Math.round(q * 100) / 100); }

  // ---------- starter data (generic, editable; label values win) ----------
  function F(id, name, serving, kcal, p, c, f) { return { id: id, name: name, serving: serving, kcal: kcal, p: p, c: c, f: f, at: 0, seed: true }; }
  var SEED_FOODS = [
    F('sf_egg', 'Egg, large', '1 egg', 70, 6, 0, 5),
    F('sf_chicken', 'Chicken breast, cooked', '4 oz', 187, 35, 0, 4),
    F('sf_rice', 'White rice, cooked', '1 cup', 205, 4, 45, 0.5),
    F('sf_oats', 'Rolled oats, dry', '1/2 cup', 150, 5, 27, 3),
    F('sf_yogurt', 'Greek yogurt, nonfat plain', '3/4 cup', 100, 17, 6, 0.5),
    F('sf_sweetpotato', 'Sweet potato, baked', '1 medium', 110, 2, 26, 0),
    F('sf_broccoli', 'Broccoli, cooked', '1 cup', 55, 4, 11, 0.6),
    F('sf_oil', 'Olive oil', '1 tbsp', 120, 0, 0, 14),
    F('sf_bread', 'Whole wheat bread', '1 slice', 80, 4, 14, 1),
    F('sf_pb', 'Peanut butter', '2 tbsp', 190, 7, 7, 16),
    F('sf_beans', 'Black beans, canned', '1/2 cup', 110, 7, 20, 0.5),
    F('sf_milk', 'Whole milk', '1 cup', 150, 8, 12, 8),
    F('sf_apple', 'Apple', '1 medium', 95, 0.5, 25, 0.3),
    F('sf_whey', 'Protein powder (check your label)', '1 scoop', 120, 24, 3, 1),
    F('sf_beer', 'Beer, regular', '12 oz', 150, 1.5, 13, 0),
    F('sf_beerlight', 'Beer, light', '12 oz', 100, 1, 6, 0),
    F('sf_wine', 'Wine', '5 oz', 125, 0, 4, 0),
    F('sf_liquor', 'Liquor (vodka, whiskey, etc.)', '1.5 oz', 97, 0, 0, 0)
  ];
  function R(id, name, items) {
    return { id: id, name: name, servings: 1, mode: 'items', at: 0, seed: true,
             items: items.map(function (i) { return { foodId: i[0], qty: i[1] }; }) };
  }
  var SEED_RECIPES = [
    R('sr_bowl', 'Chicken, rice and broccoli bowl', [['sf_chicken', 1.5], ['sf_rice', 1], ['sf_broccoli', 1], ['sf_oil', 0.5]]),
    R('sr_sweet', 'Chicken and sweet potato plate', [['sf_chicken', 1.5], ['sf_sweetpotato', 2], ['sf_broccoli', 1]]),
    R('sr_burrito', 'Chicken burrito bowl', [['sf_chicken', 1.5], ['sf_rice', 1], ['sf_beans', 1]]),
    R('sr_eggrice', 'Egg and rice bowl', [['sf_egg', 3], ['sf_rice', 1], ['sf_broccoli', 1]]),
    R('sr_scramble', 'Egg scramble with toast', [['sf_egg', 3], ['sf_bread', 2]]),
    R('sr_yogoat', 'Greek yogurt oat bowl', [['sf_yogurt', 1], ['sf_oats', 1], ['sf_apple', 1], ['sf_pb', 0.5]]),
    R('sr_overnight', 'Protein overnight oats', [['sf_oats', 1.5], ['sf_milk', 1], ['sf_whey', 1]]),
    R('sr_pbtoast', 'Peanut butter toast and yogurt', [['sf_bread', 2], ['sf_pb', 1], ['sf_yogurt', 1]])
  ];

  // ---------- macro math ----------
  function sumMacros(list) {
    var t = { kcal: 0, p: 0, c: 0, f: 0 };
    list.forEach(function (m) { t.kcal += num(m.kcal); t.p += num(m.p); t.c += num(m.c); t.f += num(m.f); });
    return { kcal: r0(t.kcal), p: r1(t.p), c: r1(t.c), f: r1(t.f) };
  }
  function totals(entries) { return sumMacros(entries); }
  function remaining(target, tot) {
    return { kcal: r0(num(target.kcal) - tot.kcal), p: r1(num(target.p) - tot.p), c: r1(num(target.c) - tot.c), f: r1(num(target.f) - tot.f) };
  }
  function byId(list) { var m = {}; (list || []).forEach(function (x) { m[x.id] = x; }); return m; }

  // Per-serving numbers for a recipe, from its ingredients or from numbers typed in directly.
  function recipeRaw(recipe, foods) {   // unrounded per-serving numbers
    if (recipe.mode === 'per' && recipe.per) {
      return { kcal: num(recipe.per.kcal), p: num(recipe.per.p), c: num(recipe.per.c), f: num(recipe.per.f), missing: 0 };
    }
    var fm = byId(foods), t = { kcal: 0, p: 0, c: 0, f: 0 }, missing = 0;
    (recipe.items || []).forEach(function (it) {
      var fd = fm[it.foodId];
      if (!fd) { missing++; return; }
      var q = num(it.qty);
      t.kcal += num(fd.kcal) * q; t.p += num(fd.p) * q; t.c += num(fd.c) * q; t.f += num(fd.f) * q;
    });
    var n = num(recipe.servings) > 0 ? num(recipe.servings) : 1;
    return { kcal: t.kcal / n, p: t.p / n, c: t.c / n, f: t.f / n, missing: missing };
  }
  function recipePer(recipe, foods) {
    var x = recipeRaw(recipe, foods);
    return { kcal: r0(x.kcal), p: r1(x.p), c: r1(x.c), f: r1(x.f), missing: x.missing };
  }

  // A log entry from a food or recipe times a quantity of servings.
  function makeEntry(kind, item, qty, foods) {
    var base, label;
    if (kind === 'recipe') { base = recipeRaw(item, foods); label = item.name; }
    else { base = item; label = item.name + (item.serving ? ' (' + item.serving + ')' : ''); }
    var q = num(qty) > 0 ? num(qty) : 1;
    return { name: label + (q !== 1 ? ' × ' + fmtQty(q) : ''),
             kcal: r0(num(base.kcal) * q), p: r1(num(base.p) * q), c: r1(num(base.c) * q), f: r1(num(base.f) * q) };
  }

  function recents(meals, n) {
    var seen = {}, out = [];
    meals.slice().sort(function (a, b) { return num(b.at) - num(a.at); }).forEach(function (m) {
      var k = m.name + '|' + m.kcal;
      if (!seen[k] && out.length < n) { seen[k] = 1; out.push(m); }
    });
    return out;
  }
  function copyDay(meals, from, to, idFn, now) {
    return meals.filter(function (m) { return m.date === from; }).map(function (m) {
      return { id: idFn(), date: to, slot: m.slot, name: m.name, kcal: m.kcal, p: m.p, c: m.c, f: m.f, at: now };
    });
  }

  // ---------- targets ----------
  function splitMacros(kcal, protein) {
    var f = r5(kcal * 0.28 / 9);
    var c = Math.max(0, r5((kcal - 4 * protein - 9 * f) / 4));
    return { kcal: kcal, p: protein, c: c, f: f };
  }

  function addDays(iso, n) { var d = Lg.parseDate(iso); d.setDate(d.getDate() + n); return Lg.fmtDate(d); }

  // Looks at the last four weeks of eating and weigh-ins to estimate what you actually burn,
  // then suggests a target for about 1 lb a week. Returns { ok:false, reason } until there is enough data.
  function calibrate(o) {
    var rate = o.rate || 1, cur = num(o.target.kcal), today = o.today;
    var from = addDays(today, -28), to = addDays(today, -1);
    var byDay = {};
    o.meals.forEach(function (m) { if (m.date >= from && m.date <= to) byDay[m.date] = (byDay[m.date] || 0) + num(m.kcal); });
    var days = Object.keys(byDay).filter(function (d) { return byDay[d] >= MIN_LOGGED_KCAL; });
    if (days.length < 12) {
      return { ok: false, loggedDays: days.length, reason: 'Needs 12 logged days in the last 4 weeks (you have ' + days.length + ').' };
    }
    var avgIn = days.reduce(function (a, d) { return a + byDay[d]; }, 0) / days.length;

    var wk = {};
    o.weights.forEach(function (w) {
      if (w.date >= from && w.date <= today) { var k = Lg.weekStart(w.date); (wk[k] = wk[k] || []).push(num(w.lb)); }
    });
    var pts = Object.keys(wk).sort().filter(function (k) { return wk[k].length >= 2; }).map(function (k) {
      return { week: k, avg: wk[k].reduce(function (a, b) { return a + b; }, 0) / wk[k].length };
    });
    if (pts.length < 3) {
      return { ok: false, loggedDays: days.length, reason: 'Needs 2 or more weigh-ins in each of 3 different weeks (you have ' + pts.length + ' such week' + (pts.length === 1 ? '' : 's') + ').' };
    }
    var x0 = pts[0].week, xs = pts.map(function (p) { return Lg.daysBetween(x0, p.week) / 7; });
    var mx = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
    var my = pts.reduce(function (a, p) { return a + p.avg; }, 0) / pts.length;
    var sxy = 0, sxx = 0;
    pts.forEach(function (p, i) { sxy += (xs[i] - mx) * (p.avg - my); sxx += (xs[i] - mx) * (xs[i] - mx); });
    var slope = sxy / sxx;                                // lb per week
    var tdee = avgIn - slope * 500;                       // 1 lb a week is about 500 kcal a day
    if (tdee < 1500 || tdee > 5000) {
      return { ok: false, loggedDays: days.length, reason: 'The numbers do not add up yet (likely missed logging), so I will not adjust.' };
    }
    var raw = tdee - 500 * rate;
    var sug = Math.max(KCAL_FLOOR, r25(clamp(raw, cur - MAX_STEP, cur + MAX_STEP)));
    return { ok: true, loggedDays: days.length, avgIntake: r0(avgIn), slope: Math.round(slope * 100) / 100,
             tdee: r0(tdee), suggested: sug, change: sug - cur, onTrack: Math.abs(sug - cur) < 25 };
  }

  // ---------- weekly numbers ----------
  function weeklyIntake(meals) {
    var day = {};
    meals.forEach(function (m) { day[m.date] = (day[m.date] || 0) + num(m.kcal); });
    var wk = {};
    Object.keys(day).forEach(function (d) {
      if (day[d] >= MIN_LOGGED_KCAL) { var k = Lg.weekStart(d); (wk[k] = wk[k] || []).push(day[d]); }
    });
    return Object.keys(wk).sort().map(function (k) {
      return { week: k, avg: r0(wk[k].reduce(function (a, b) { return a + b; }, 0) / wk[k].length), days: wk[k].length };
    });
  }
  // Body fat if all of your fat-free mass is kept. The true value is usually a little higher.
  function estBodyFat(ffm, weight) {
    if (!(ffm > 0) || !(weight > ffm)) return null;
    return r1((1 - ffm / weight) * 100);
  }

  // ---------- meal ideas ----------
  function hasAvoided(text, avoid) {
    var words = String(avoid || '').split(/[,;\n]/).map(function (w) { return w.trim().toLowerCase(); }).filter(Boolean);
    var t = String(text).toLowerCase();
    return words.some(function (w) { return t.indexOf(w) !== -1; });
  }
  function suggest(recipes, foods, rem, avoid) {
    if (rem.kcal < 150) return [];
    var fm = byId(foods);
    return recipes.map(function (r) {
      var per = recipePer(r, foods);
      var names = [r.name].concat((r.items || []).map(function (i) { return fm[i.foodId] ? fm[i.foodId].name : ''; })).join(' ');
      return { recipe: r, per: per, blocked: hasAvoided(names, avoid) };
    }).filter(function (x) {
      return !x.blocked && x.per.missing === 0 && x.per.kcal >= 150 && x.per.kcal <= rem.kcal + 75;
    }).sort(function (a, b) {
      return (b.per.p / Math.max(1, b.per.kcal)) - (a.per.p / Math.max(1, a.per.kcal));
    }).slice(0, 3);
  }

  var api = { SLOTS: SLOTS, MIN_LOGGED_KCAL: MIN_LOGGED_KCAL, KCAL_FLOOR: KCAL_FLOOR, MAX_STEP: MAX_STEP,
              SEED_FOODS: SEED_FOODS, SEED_RECIPES: SEED_RECIPES, sumMacros: sumMacros, totals: totals,
              remaining: remaining, recipePer: recipePer, makeEntry: makeEntry, recents: recents, copyDay: copyDay,
              splitMacros: splitMacros, calibrate: calibrate, weeklyIntake: weeklyIntake, estBodyFat: estBodyFat,
              suggest: suggest, hasAvoided: hasAvoided, fmtQty: fmtQty };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FitMealsLogic = api;
})(typeof window !== 'undefined' ? window : this);
