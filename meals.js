/* Meals tab: daily log, foods, recipes, meal ideas, targets and target check. */
(function () {
  'use strict';
  var ML = window.FitMealsLogic, L = window.FitLogic, A = null;

  var st = { sub: 'log', date: null, adding: null, tab: 'find', q: '', picked: null, qty: '1',
             quick: { name: '', kcal: '', p: '', c: '', f: '' }, food: null, rec: null };

  function S() { return A.state(); }
  function esc(x) { return A.esc(x); }
  function now() { return Date.now(); }
  function curDate() { if (!st.date) st.date = L.today(); return st.date; }
  function f1(x) { return String(Math.round(x * 10) / 10); }
  function k0(x) { return String(Math.round(x)); }
  function numOrNull(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function macroLine(m) { return k0(m.kcal) + ' kcal · P ' + f1(m.p) + ' · C ' + f1(m.c) + ' · F ' + f1(m.f); }
  function tomb(id) { S().tomb = (S().tomb || []).concat([id]); }
  function changed(delay) { A.save(); A.sync(delay == null ? 400 : delay); }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function slotName(k) { for (var i = 0; i < ML.SLOTS.length; i++) if (ML.SLOTS[i][0] === k) return ML.SLOTS[i][1]; return 'Snacks'; }

  // ---------- shared pieces ----------
  function subSeg() {
    var items = [['log', 'Log'], ['foods', 'Foods'], ['recipes', 'Recipes'], ['ideas', 'Ideas'], ['targets', 'Targets']];
    return '<div class="seg seg5" role="group" aria-label="Meals sections">' + items.map(function (it) {
      return '<button class="' + (st.sub === it[0] ? 'on' : '') + '" data-act="mealsub" data-val="' + it[0] + '">' + it[1] + '</button>';
    }).join('') + '</div>';
  }
  function bar(label, cur, tgt, unit) {
    var pct = tgt > 0 ? Math.min(100, Math.max(0, cur / tgt * 100)) : 0;
    return '<div class="mrow"><span>' + label + '</span><span class="muted">' + f1(cur) + ' / ' + f1(tgt) + unit + '</span></div>' +
           '<div class="bar thin"><span style="width:' + pct.toFixed(0) + '%"></span></div>';
  }

  // ---------- log ----------
  function renderLog() {
    var s = S(), d = curDate(), tg = s.target, ent = s.meals.filter(function (m) { return m.date === d; });
    var tot = ML.totals(ent), left = Math.round(tg.kcal - tot.kcal), isToday = d >= L.today();
    var h = '<section class="card"><div class="datenav"><button class="btn sm" data-act="mealday" data-d="-1" aria-label="Previous day">‹</button>' +
            '<b>' + (d === L.today() ? 'Today' : esc(A.shortDate(d))) + '</b>' +
            '<button class="btn sm" data-act="mealday" data-d="1" aria-label="Next day"' + (isToday ? ' disabled' : '') + '>›</button></div>' +
            '<div class="big">' + Math.abs(left) + ' <small>' + (left >= 0 ? 'kcal left' : 'kcal over') + '</small></div>' +
            '<p class="muted small">' + k0(tot.kcal) + ' eaten of ' + k0(tg.kcal) + '</p>' +
            bar('Protein', tot.p, tg.p, ' g') + bar('Carbs', tot.c, tg.c, ' g') + bar('Fat', tot.f, tg.f, ' g') + '</section>';
    ML.SLOTS.forEach(function (sl) {
      var key = sl[0];
      var list = ent.filter(function (m) { return (m.slot || 'snack') === key || (key === 'snack' && !byId(ML.SLOTS.map(function (x) { return { id: x[0] }; }), m.slot)); });
      var sum = ML.totals(list);
      h += '<section class="card"><div class="exhead"><h3>' + sl[1] + '</h3><span class="muted small">' + k0(sum.kcal) + ' kcal</span></div>';
      list.forEach(function (m) {
        h += '<div class="wrow"><div><b>' + esc(m.name) + '</b><br><span class="muted small">' + esc(macroLine(m)) + '</span></div>' +
             '<button class="btn sm ghost danger" data-act="mealdel" data-id="' + esc(m.id) + '" aria-label="Remove">Remove</button></div>';
      });
      h += st.adding === key ? addPanel() : '<button class="btn block" style="margin-top:8px" data-act="mealadd" data-slot="' + key + '">+ Add food</button>';
      h += '</section>';
    });
    var prev = L.fmtDate(new Date(L.parseDate(d).getTime() - 86400000));
    if (s.meals.some(function (m) { return m.date === prev; })) {
      h += '<button class="btn ghost block" data-act="mealcopyprev">Copy the day before into this day</button>';
    }
    return h;
  }

  function addPanel() {
    var h = '<div class="addpanel"><div class="seg" style="grid-template-columns:1fr 1fr">' +
      '<button class="' + (st.tab === 'find' ? 'on' : '') + '" data-act="mealtab" data-val="find">Find</button>' +
      '<button class="' + (st.tab === 'quick' ? 'on' : '') + '" data-act="mealtab" data-val="quick">Quick add</button></div>';
    if (st.tab === 'find') {
      h += '<input class="field" id="mealQ" data-mf="q" placeholder="Search foods and recipes" value="' + esc(st.q) + '" autocomplete="off" aria-label="Search foods and recipes">' +
           '<div id="mealResults">' + resultsHtml() + '</div>';
    } else {
      var q = st.quick;
      h += '<div class="stack"><input class="field" data-mf="qa-name" placeholder="Name (optional)" value="' + esc(q.name) + '" aria-label="Name">' +
           '<div class="inline4">' +
           '<input class="field" data-mf="qa-kcal" inputmode="decimal" placeholder="kcal" value="' + esc(q.kcal) + '" aria-label="Calories">' +
           '<input class="field" data-mf="qa-p" inputmode="decimal" placeholder="P g" value="' + esc(q.p) + '" aria-label="Protein grams">' +
           '<input class="field" data-mf="qa-c" inputmode="decimal" placeholder="C g" value="' + esc(q.c) + '" aria-label="Carb grams">' +
           '<input class="field" data-mf="qa-f" inputmode="decimal" placeholder="F g" value="' + esc(q.f) + '" aria-label="Fat grams"></div>' +
           '<button class="btn primary block" data-act="mealquick">Add to ' + esc(slotName(st.adding)) + '</button></div>';
    }
    return h + '<button class="btn ghost block" style="margin-top:6px" data-act="mealaddclose">Close</button></div>';
  }

  function itemFor(kind, id) { var s = S(); return byId(kind === 'recipe' ? s.recipes : s.foods, id); }
  function pickedHtml() {
    var s = S(), p = st.picked, it = itemFor(p.kind, p.id);
    if (!it) { st.picked = null; return ''; }
    var base = p.kind === 'recipe' ? ML.recipePer(it, s.foods) : it;
    return '<div class="pick"><b>' + esc(it.name) + '</b><div class="muted small">' +
           (p.kind === 'recipe' ? 'Per serving: ' : esc(it.serving || 'Per serving') + ': ') + esc(macroLine(base)) + '</div>' +
           '<label class="small muted" for="mealQty">Servings</label>' +
           '<input class="field" id="mealQty" data-mf="qty" inputmode="decimal" value="' + esc(st.qty) + '" aria-label="Servings">' +
           '<p id="mealPreview" class="small"><b>' + esc(previewText()) + '</b></p>' +
           '<div class="grid2"><button class="btn primary" data-act="mealconfirm">Add to ' + esc(slotName(st.adding)) + '</button>' +
           '<button class="btn" data-act="mealunpick">Back</button></div></div>';
  }
  function previewText() {
    var s = S(), p = st.picked, it = p && itemFor(p.kind, p.id);
    if (!it) return '';
    return macroLine(ML.makeEntry(p.kind, it, parseFloat(st.qty), s.foods));
  }
  function resultRow(act, attrs, name, meta) {
    return '<button class="btnrow" data-act="' + act + '" ' + attrs + '><span>' + esc(name) + '</span><span class="meta">' + esc(meta) + '</span></button>';
  }
  function resultsHtml() {
    if (st.picked) return pickedHtml();
    var s = S(), q = st.q.trim().toLowerCase(), h = '';
    if (!q) {
      var rc = ML.recents(s.meals, 6);
      if (rc.length) {
        h += '<div class="eyebrow" style="margin:12px 0 4px">Recent</div>' + rc.map(function (m) {
          return resultRow('mealrecent', 'data-id="' + esc(m.id) + '"', m.name, k0(m.kcal) + ' kcal');
        }).join('');
      }
      return h + '<p class="muted small" style="margin-top:10px">Search ' + s.foods.length + ' foods and ' + s.recipes.length + ' recipes, or use Quick add.</p>';
    }
    var rr = s.recipes.filter(function (r) { return r.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 8);
    var ff = s.foods.filter(function (f) { return f.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 12);
    rr.forEach(function (r) { h += resultRow('mealpick', 'data-kind="recipe" data-id="' + esc(r.id) + '"', r.name, 'recipe · ' + k0(ML.recipePer(r, s.foods).kcal) + ' kcal'); });
    ff.forEach(function (f) { h += resultRow('mealpick', 'data-kind="food" data-id="' + esc(f.id) + '"', f.name, (f.serving ? f.serving + ' · ' : '') + k0(f.kcal) + ' kcal'); });
    return h || '<p class="muted small" style="margin-top:10px">Nothing found. Try Quick add, or add it under Foods.</p>';
  }
  function refreshResults() {
    var e = document.getElementById('mealResults');
    if (e) e.innerHTML = resultsHtml();
  }

  // ---------- foods ----------
  function renderFoods() {
    var s = S(), h = '';
    if (st.food) return h + foodForm();
    h += '<button class="btn primary block" data-act="foodnew" style="margin-bottom:12px">+ New food</button><section class="card">';
    s.foods.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (f) {
      h += '<div class="wrow"><div><b>' + esc(f.name) + '</b><br><span class="muted small">' + esc((f.serving ? f.serving + ' · ' : '') + macroLine(f)) +
           '</span></div><button class="btn sm" data-act="foodedit" data-id="' + esc(f.id) + '">Edit</button></div>';
    });
    return h + '</section><p class="muted small">Starter values are typical. Package labels win, so edit anything that differs.</p>';
  }
  function foodForm() {
    var f = st.food;
    return '<section class="card"><h2>' + (f.id ? 'Edit food' : 'New food') + '</h2><div class="stack">' +
      '<input class="field" data-mf="food-name" placeholder="Name" value="' + esc(f.name) + '" aria-label="Name">' +
      '<input class="field" data-mf="food-serving" placeholder="Serving, such as 1 cup or 4 oz" value="' + esc(f.serving) + '" aria-label="Serving size">' +
      '<div class="inline4"><input class="field" data-mf="food-kcal" inputmode="decimal" placeholder="kcal" value="' + esc(f.kcal) + '" aria-label="Calories per serving">' +
      '<input class="field" data-mf="food-p" inputmode="decimal" placeholder="P g" value="' + esc(f.p) + '" aria-label="Protein">' +
      '<input class="field" data-mf="food-c" inputmode="decimal" placeholder="C g" value="' + esc(f.c) + '" aria-label="Carbs">' +
      '<input class="field" data-mf="food-f" inputmode="decimal" placeholder="F g" value="' + esc(f.f) + '" aria-label="Fat"></div>' +
      '<p class="muted small">Numbers are for one serving as written above.</p>' +
      '<button class="btn primary block" data-act="foodsave">Save</button>' +
      '<button class="btn block" data-act="foodcancel">Cancel</button>' +
      (f.id ? '<button class="btn ghost danger block" data-act="fooddel">Delete food</button>' : '') + '</div></section>';
  }

  // ---------- recipes ----------
  function renderRecipes() {
    var s = S(), h = '';
    if (st.rec) return recipeForm();
    h += '<button class="btn primary block" data-act="recnew" style="margin-bottom:12px">+ New recipe</button><section class="card">';
    s.recipes.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (r) {
      var per = ML.recipePer(r, s.foods);
      h += '<div class="wrow"><div><b>' + esc(r.name) + '</b><br><span class="muted small">Per serving: ' + esc(macroLine(per)) +
           (per.missing ? ' · ' + per.missing + ' ingredient missing' : '') + '</span></div>' +
           '<button class="btn sm" data-act="recedit" data-id="' + esc(r.id) + '">Edit</button></div>';
    });
    return h + '</section>';
  }
  function recDraftPer() {
    var r = st.rec, s = S();
    if (r.mode === 'per') return ML.recipePer({ mode: 'per', per: { kcal: r.per.kcal, p: r.per.p, c: r.per.c, f: r.per.f } }, s.foods);
    return ML.recipePer({ mode: 'items', servings: parseFloat(r.servings) || 1,
      items: r.items.map(function (i) { return { foodId: i.foodId, qty: parseFloat(i.qty) || 0 }; }) }, s.foods);
  }
  function recipeForm() {
    var r = st.rec, s = S();
    var h = '<section class="card"><h2>' + (r.id ? 'Edit recipe' : 'New recipe') + '</h2><div class="stack">' +
      '<input class="field" data-mf="rec-name" placeholder="Recipe name" value="' + esc(r.name) + '" aria-label="Recipe name">' +
      '<label class="small muted" for="recServ">Servings this recipe makes</label>' +
      '<input class="field" id="recServ" data-mf="rec-servings" inputmode="decimal" value="' + esc(r.servings) + '" aria-label="Servings">' +
      '<div class="seg" style="grid-template-columns:1fr 1fr">' +
      '<button class="' + (r.mode === 'items' ? 'on' : '') + '" data-act="recmode" data-val="items">From ingredients</button>' +
      '<button class="' + (r.mode === 'per' ? 'on' : '') + '" data-act="recmode" data-val="per">I know the numbers</button></div>';
    if (r.mode === 'items') {
      r.items.forEach(function (it, i) {
        h += '<div class="irow"><select class="field" data-mf="rec-food" data-i="' + i + '" aria-label="Ingredient">' +
          s.foods.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (f) {
            return '<option value="' + esc(f.id) + '"' + (f.id === it.foodId ? ' selected' : '') + '>' + esc(f.name + (f.serving ? ' (' + f.serving + ')' : '')) + '</option>';
          }).join('') + '</select>' +
          '<input class="field" data-mf="rec-qty" data-i="' + i + '" inputmode="decimal" value="' + esc(it.qty) + '" aria-label="Servings of this ingredient">' +
          '<button class="btn sm ghost danger" data-act="recdelrow" data-i="' + i + '" aria-label="Remove ingredient">✕</button></div>';
      });
      h += '<button class="btn sm" data-act="recaddrow">+ Add ingredient</button>' +
           '<p class="muted small">The number beside each ingredient is how many of its listed servings you use in the whole recipe, for example 1.5 for a serving and a half.</p>';
    } else {
      h += '<p class="muted small">Per serving, for example from an app or label:</p><div class="inline4">' +
        '<input class="field" data-mf="rec-per-kcal" inputmode="decimal" placeholder="kcal" value="' + esc(r.per.kcal) + '" aria-label="Calories per serving">' +
        '<input class="field" data-mf="rec-per-p" inputmode="decimal" placeholder="P g" value="' + esc(r.per.p) + '" aria-label="Protein per serving">' +
        '<input class="field" data-mf="rec-per-c" inputmode="decimal" placeholder="C g" value="' + esc(r.per.c) + '" aria-label="Carbs per serving">' +
        '<input class="field" data-mf="rec-per-f" inputmode="decimal" placeholder="F g" value="' + esc(r.per.f) + '" aria-label="Fat per serving"></div>';
    }
    h += '<p id="recPreview"><b>Per serving: ' + esc(macroLine(recDraftPer())) + '</b></p>' +
         '<button class="btn primary block" data-act="recsave">Save recipe</button>' +
         '<button class="btn block" data-act="reccancel">Cancel</button>' +
         (r.id ? '<button class="btn ghost danger block" data-act="recdel">Delete recipe</button>' : '') + '</div></section>';
    return h;
  }
  function refreshRecPreview() {
    var e = document.getElementById('recPreview');
    if (e && st.rec) e.innerHTML = '<b>Per serving: ' + esc(macroLine(recDraftPer())) + '</b>';
  }

  // ---------- ideas ----------
  function ideasListHtml() {
    var s = S(), tot = ML.totals(s.meals.filter(function (m) { return m.date === L.today(); }));
    var rem = ML.remaining(s.target, tot);
    var list = ML.suggest(s.recipes, s.foods, rem, (s.prefs || {}).avoid);
    if (!list.length) {
      return '<p class="muted">' + (rem.kcal < 150 ? 'You are about at your target for today.' : 'Nothing in your recipes fits what is left today. Add a recipe, or loosen the hide list.') + '</p>';
    }
    return list.map(function (x) {
      return '<div class="card inner"><b>' + esc(x.recipe.name) + '</b><div class="muted small">' + esc(macroLine(x.per)) + '</div>' +
        '<div class="small muted" style="margin:8px 0 4px">Log as</div><div class="grid4">' + ML.SLOTS.map(function (sl) {
          return '<button class="btn sm" data-act="mealidea" data-id="' + esc(x.recipe.id) + '" data-slot="' + sl[0] + '">' + sl[1] + '</button>';
        }).join('') + '</div></div>';
    }).join('');
  }
  function renderIdeas() {
    var s = S(), tot = ML.totals(s.meals.filter(function (m) { return m.date === L.today(); })), rem = ML.remaining(s.target, tot);
    return '<section class="card"><h2>What should I eat?</h2><p class="muted">Left today: <b>' + k0(Math.max(0, rem.kcal)) + ' kcal</b>, <b>' +
      f1(Math.max(0, rem.p)) + ' g protein</b>. These are picked from your recipes and favor protein.</p>' +
      '<label class="small muted" for="avoidBox">Hide ideas containing (comma separated)</label>' +
      '<input class="field" id="avoidBox" data-mf="avoid" placeholder="Words to hide, such as foods you skip" value="' + esc((s.prefs || {}).avoid || '') + '" aria-label="Words to hide from ideas"></section>' +
      '<div id="ideaList">' + ideasListHtml() + '</div>';
  }

  // ---------- targets ----------
  function renderTargets() {
    var s = S(), tg = s.target, body = s.body || {}, h = '';
    h += '<section class="card"><h2>Daily targets</h2><div class="stack">' +
      tgField('Calories', 'kcal', tg.kcal) + tgField('Protein (g)', 'p', tg.p) + tgField('Carbs (g)', 'c', tg.c) + tgField('Fat (g)', 'f', tg.f) +
      '<button class="btn" data-act="tgsplit">Recalculate macros for these calories</button>';
    if (body.rmr > 0 && tg.kcal < body.rmr) {
      h += '<p class="small" style="color:var(--danger)">This is below your measured resting burn of ' + k0(body.rmr) + ' kcal. That is a steep cut, so make sure it is on purpose.</p>';
    }
    h += '<p class="muted small">Keeps protein fixed and puts about 28% of calories in fat. Carbs fill the rest.</p></div></section>';
    h += '<section class="card"><h2>Target check</h2>' + calibHtml() + '</section>';
    return h;
  }
  function tgField(label, k, v) {
    return '<label class="small muted" for="tg-' + k + '">' + label + '</label><input class="field" id="tg-' + k + '" data-mf="tg-' + k +
           '" inputmode="decimal" value="' + esc(v) + '" aria-label="' + esc(label) + '">';
  }
  function calibHtml() {
    var s = S(), c = ML.calibrate({ weights: s.weights, meals: s.meals, target: s.target, today: L.today() });
    if (!c.ok) {
      return '<p class="muted">After a few weeks of logging, I compare what you ate with how your weekly average weight moved, work out what you really burn, and suggest a target aimed at about 1 lb a week.</p>' +
             '<p><b>' + esc(c.reason) + '</b></p>';
    }
    var dir = c.slope < 0 ? 'down' : c.slope > 0 ? 'up' : 'flat';
    var h = '<p class="muted">Over the last 4 weeks you logged about <b>' + k0(c.avgIntake) + ' kcal</b> a day and your weekly average weight went ' + dir +
            (c.slope === 0 ? '' : ' ' + Math.abs(c.slope).toFixed(2) + ' lb') + ' per week. That suggests you burn about <b>' + k0(c.tdee) + ' kcal</b> a day.</p>';
    if (c.onTrack) return h + '<p><b>Your target is on track. No change needed.</b></p>';
    return h + '<p><b>Suggested target: ' + k0(c.suggested) + ' kcal (' + (c.change > 0 ? '+' : '') + c.change + ')</b></p>' +
           '<button class="btn primary block" data-act="tgapply" data-val="' + c.suggested + '">Apply ' + k0(c.suggested) + ' kcal</button>';
  }

  // ---------- render dispatch ----------
  function render() {
    var h = subSeg();
    if (st.sub === 'foods') h += renderFoods();
    else if (st.sub === 'recipes') h += renderRecipes();
    else if (st.sub === 'ideas') h += renderIdeas();
    else if (st.sub === 'targets') h += renderTargets();
    else h += renderLog();
    return h;
  }

  // ---------- actions ----------
  function addEntry(entry, slot, date) {
    var s = S();
    s.meals.push({ id: A.uid(), date: date || curDate(), slot: slot, name: entry.name, kcal: entry.kcal, p: entry.p, c: entry.c, f: entry.f, at: now() });
  }
  function newRecDraft(r) {
    var per = r && r.per ? r.per : {};
    return { id: r ? r.id : null, name: r ? r.name : '', servings: r ? String(r.servings || 1) : '1',
             mode: r && r.mode === 'per' ? 'per' : 'items',
             items: r && r.items ? r.items.map(function (i) { return { foodId: i.foodId, qty: String(i.qty) }; }) : [],
             per: { kcal: per.kcal != null ? String(per.kcal) : '', p: per.p != null ? String(per.p) : '', c: per.c != null ? String(per.c) : '', f: per.f != null ? String(per.f) : '' } };
  }

  function act(name, d) {
    var s = S();
    switch (name) {
      case 'mealsub': st.sub = d.val; st.adding = null; st.picked = null; A.rerender(); return;
      case 'mealday': {
        var cd = curDate(), nd = L.fmtDate(new Date(L.parseDate(cd).getTime() + Number(d.d) * 86400000));
        if (nd > L.today()) return;
        st.date = nd; st.adding = null; st.picked = null; A.rerender(true); return;
      }
      case 'mealadd': st.adding = d.slot; st.tab = 'find'; st.q = ''; st.picked = null; A.rerender(true); return;
      case 'mealaddclose': st.adding = null; st.picked = null; A.rerender(true); return;
      case 'mealtab': st.tab = d.val; st.picked = null; A.rerender(true); return;
      case 'mealpick': st.picked = { kind: d.kind, id: d.id }; st.qty = '1'; refreshResults(); return;
      case 'mealunpick': st.picked = null; refreshResults(); return;
      case 'mealconfirm': {
        var p = st.picked, it = p && itemFor(p.kind, p.id);
        if (!it) return;
        var q = parseFloat(st.qty);
        if (!(q > 0 && q <= 50)) { A.toast('Enter how many servings'); return; }
        addEntry(ML.makeEntry(p.kind, it, q, s.foods), st.adding);
        st.picked = null; st.q = '';
        changed(); A.rerender(true); A.toast('Added'); return;
      }
      case 'mealrecent': {
        var src = byId(s.meals, d.id);
        if (!src) return;
        addEntry(src, st.adding);
        changed(); A.rerender(true); A.toast('Added'); return;
      }
      case 'mealquick': {
        var qa = st.quick, kc = numOrNull(qa.kcal), p2 = numOrNull(qa.p) || 0, c2 = numOrNull(qa.c) || 0, f2 = numOrNull(qa.f) || 0;
        if (kc == null && (p2 || c2 || f2)) kc = 4 * p2 + 4 * c2 + 9 * f2;
        if (!(kc > 0)) { A.toast('Enter the calories'); return; }
        addEntry({ name: qa.name.trim() || 'Quick add', kcal: Math.round(kc), p: p2, c: c2, f: f2 }, st.adding);
        st.quick = { name: '', kcal: '', p: '', c: '', f: '' };
        changed(); A.rerender(true); A.toast('Added'); return;
      }
      case 'mealdel':
        s.meals = s.meals.filter(function (m) { return m.id !== d.id; });
        tomb(d.id); changed(); A.rerender(true); return;
      case 'mealcopyprev': {
        var cdate = curDate(), prev = L.fmtDate(new Date(L.parseDate(cdate).getTime() - 86400000));
        var copies = ML.copyDay(s.meals, prev, cdate, A.uid, now());
        copies.forEach(function (c) { s.meals.push(c); });
        changed(); A.rerender(true); A.toast('Copied ' + copies.length + ' item' + (copies.length === 1 ? '' : 's')); return;
      }
      case 'mealidea': {
        var rcp = byId(s.recipes, d.id);
        if (!rcp) return;
        addEntry(ML.makeEntry('recipe', rcp, 1, s.foods), d.slot, L.today());
        changed(); A.rerender(true); A.toast('Added to ' + slotName(d.slot)); return;
      }
      // foods
      case 'foodnew': st.food = { id: null, name: '', serving: '', kcal: '', p: '', c: '', f: '' }; A.rerender(); return;
      case 'foodedit': {
        var fd = byId(s.foods, d.id);
        if (fd) st.food = { id: fd.id, name: fd.name, serving: fd.serving || '', kcal: String(fd.kcal), p: String(fd.p), c: String(fd.c), f: String(fd.f) };
        A.rerender(); return;
      }
      case 'foodcancel': st.food = null; A.rerender(); return;
      case 'foodsave': {
        var f = st.food, kcal = numOrNull(f.kcal);
        if (!f.name.trim()) { A.toast('Give it a name'); return; }
        if (!(kcal >= 0)) { A.toast('Enter the calories'); return; }
        var rec = { id: f.id || A.uid(), name: f.name.trim(), serving: f.serving.trim(), kcal: kcal,
                    p: numOrNull(f.p) || 0, c: numOrNull(f.c) || 0, f: numOrNull(f.f) || 0, at: now() };
        var ex = byId(s.foods, rec.id);
        if (ex) s.foods[s.foods.indexOf(ex)] = rec; else s.foods.push(rec);
        st.food = null; changed(); A.rerender(); A.toast('Saved'); return;
      }
      case 'fooddel': {
        var fid = st.food && st.food.id;
        if (!fid) return;
        var used = s.recipes.filter(function (r) { return (r.items || []).some(function (i) { return i.foodId === fid; }); }).length;
        if (!confirm(used ? 'This food is in ' + used + ' recipe' + (used > 1 ? 's' : '') + '. Those recipes will show a missing ingredient. Delete anyway?' : 'Delete this food?')) return;
        s.foods = s.foods.filter(function (x) { return x.id !== fid; });
        tomb(fid); st.food = null; changed(); A.rerender(); return;
      }
      // recipes
      case 'recnew': st.rec = newRecDraft(null); st.rec.items.push({ foodId: s.foods.length ? s.foods[0].id : '', qty: '1' }); A.rerender(); return;
      case 'recedit': { var rc = byId(s.recipes, d.id); if (rc) st.rec = newRecDraft(rc); A.rerender(); return; }
      case 'reccancel': st.rec = null; A.rerender(); return;
      case 'recmode': st.rec.mode = d.val; A.rerender(true); return;
      case 'recaddrow': st.rec.items.push({ foodId: s.foods.length ? s.foods[0].id : '', qty: '1' }); A.rerender(true); return;
      case 'recdelrow': st.rec.items.splice(Number(d.i), 1); A.rerender(true); return;
      case 'recsave': {
        var r = st.rec, sv = parseFloat(r.servings);
        if (!r.name.trim()) { A.toast('Give the recipe a name'); return; }
        if (!(sv > 0)) { A.toast('Enter how many servings it makes'); return; }
        var out = { id: r.id || A.uid(), name: r.name.trim(), servings: sv, mode: r.mode, at: now() };
        if (r.mode === 'per') {
          if (!(numOrNull(r.per.kcal) > 0)) { A.toast('Enter the calories per serving'); return; }
          out.per = { kcal: numOrNull(r.per.kcal), p: numOrNull(r.per.p) || 0, c: numOrNull(r.per.c) || 0, f: numOrNull(r.per.f) || 0 };
          out.items = [];
        } else {
          var items = r.items.filter(function (i) { return i.foodId && parseFloat(i.qty) > 0; }).map(function (i) { return { foodId: i.foodId, qty: parseFloat(i.qty) }; });
          if (!items.length) { A.toast('Add at least one ingredient'); return; }
          out.items = items;
        }
        var er = byId(s.recipes, out.id);
        if (er) s.recipes[s.recipes.indexOf(er)] = out; else s.recipes.push(out);
        st.rec = null; changed(); A.rerender(); A.toast('Saved'); return;
      }
      case 'recdel': {
        var rid = st.rec && st.rec.id;
        if (!rid || !confirm('Delete this recipe? Meals you already logged stay.')) return;
        s.recipes = s.recipes.filter(function (x) { return x.id !== rid; });
        tomb(rid); st.rec = null; changed(); A.rerender(); return;
      }
      // targets
      case 'tgsplit': {
        var sp = ML.splitMacros(Math.round(s.target.kcal), Math.round(s.target.p));
        s.target = { kcal: sp.kcal, p: sp.p, c: sp.c, f: sp.f, at: now() };
        changed(); A.rerender(true); return;
      }
      case 'tgapply': {
        var kk = Number(d.val), sp2 = ML.splitMacros(kk, Math.round(s.target.p));
        s.target = { kcal: sp2.kcal, p: sp2.p, c: sp2.c, f: sp2.f, at: now() };
        changed(); A.rerender(true); A.toast('Target updated'); return;
      }
    }
  }

  // ---------- inputs ----------
  function onField(el) {
    var k = el.getAttribute && el.getAttribute('data-mf');
    if (!k) return;
    var s = S(), v = el.value;
    if (k === 'q') { st.q = v; refreshResults(); return; }
    if (k === 'qty') { st.qty = v; var pv = document.getElementById('mealPreview'); if (pv) pv.innerHTML = '<b>' + esc(previewText()) + '</b>'; return; }
    if (k.indexOf('qa-') === 0) { st.quick[k.slice(3)] = v; return; }
    if (k.indexOf('food-') === 0 && st.food) { st.food[k.slice(5)] = v; return; }
    if (k === 'rec-name' && st.rec) { st.rec.name = v; return; }
    if (k === 'rec-servings' && st.rec) { st.rec.servings = v; refreshRecPreview(); return; }
    if (k === 'rec-food' && st.rec) { st.rec.items[Number(el.getAttribute('data-i'))].foodId = v; refreshRecPreview(); return; }
    if (k === 'rec-qty' && st.rec) { st.rec.items[Number(el.getAttribute('data-i'))].qty = v; refreshRecPreview(); return; }
    if (k.indexOf('rec-per-') === 0 && st.rec) { st.rec.per[k.slice(8)] = v; refreshRecPreview(); return; }
    if (k.indexOf('tg-') === 0) {
      var n = parseFloat(v);
      if (isFinite(n) && n >= 0) { s.target[k.slice(3)] = n; s.target.at = now(); A.save(); A.sync(1500); }
      return;
    }
    if (k === 'avoid') {
      s.prefs = s.prefs || {}; s.prefs.avoid = v; s.prefs.at = now(); A.save(); A.sync(1500);
      var il = document.getElementById('ideaList'); if (il) il.innerHTML = ideasListHtml();
    }
  }
  // Typing is handled on 'input'. A text box also fires 'change' when it loses focus, which would redraw
  // the list under your finger mid-tap and swallow the tap, so only dropdowns listen for 'change'.
  document.addEventListener('input', function (e) { onField(e.target); });
  document.addEventListener('change', function (e) { if (e.target && e.target.tagName === 'SELECT') onField(e.target); });

  window.FitMealsUI = {
    init: function (bridge) { A = bridge; },
    render: render,
    act: act,
    _field: onField,
    _state: function () { return st; }
  };
})();
