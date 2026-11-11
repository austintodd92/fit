/* Exercise library and the 4-session rotation. */
(function (root) {
  'use strict';

  var UNIT = { db: 'lb each', cable: 'lb', smith: 'lb / side', bw: '+ lb' };
  var PROFILES = { home: 'Apartment gym', hotel: 'Hotel gym', bw: 'Bodyweight only' };
  var WARMUP = 'Did my active shoulder warm-up';

  var EX = {};
  function def(id, name, kind, sets, lo, hi, step, max, note) {
    EX[id] = { id: id, name: name, kind: kind, sets: sets, lo: lo, hi: hi,
               step: step, max: max || null, note: note || '' };
  }

  // Push
  def('db_bench', 'Dumbbell bench press', 'db', 4, 8, 12, 5, 50);
  def('smith_bench', 'Smith machine bench press', 'smith', 4, 8, 12, 5);
  def('pushup', 'Push-ups', 'bw', 4, 8, 20, 0);
  def('wide_pushup', 'Wide push-ups', 'bw', 3, 8, 20, 0);
  def('db_shoulder_press', 'Dumbbell shoulder press', 'db', 3, 8, 12, 5, 50);
  def('pike_pushup', 'Pike push-ups', 'bw', 3, 6, 15, 0);
  def('cable_fly', 'Cable fly', 'cable', 3, 10, 15, 5);
  def('db_fly', 'Dumbbell fly', 'db', 3, 10, 15, 5, 50);
  def('cable_pushdown', 'Cable triceps pushdown', 'cable', 3, 10, 15, 5);
  def('db_oh_tri', 'Dumbbell overhead triceps extension', 'db', 3, 10, 15, 5, 50);
  def('bench_dip', 'Bench dips', 'bw', 3, 8, 15, 0);
  def('lat_raise', 'Dumbbell lateral raise', 'db', 3, 12, 20, 5, 50);
  def('plank_taps', 'Plank shoulder taps', 'bw', 3, 20, 40, 0, null, 'Count total taps');

  // Lower (kept short and low-fatigue)
  def('smith_squat', 'Smith machine squat', 'smith', 3, 10, 12, 5);
  def('goblet_squat', 'Dumbbell goblet squat', 'db', 3, 10, 15, 5, 50);
  def('bw_squat', 'Bodyweight squat', 'bw', 3, 15, 30, 0);
  def('db_rdl', 'Dumbbell Romanian deadlift', 'db', 3, 10, 12, 5, 50);
  def('bw_hinge', 'Single-leg hip hinge', 'bw', 3, 8, 12, 0, null, 'Per leg');
  def('smith_hip_thrust', 'Smith machine hip thrust', 'smith', 3, 10, 12, 5);
  def('db_hip_thrust', 'Dumbbell hip thrust (on bench)', 'db', 3, 10, 15, 5, 50);
  def('glute_bridge', 'Glute bridge', 'bw', 3, 12, 20, 0);
  def('calf_raise', 'Dumbbell calf raise', 'db', 3, 12, 20, 5, 50);
  def('calf_raise_bw', 'Single-leg calf raise', 'bw', 3, 12, 20, 0, null, 'Per leg');

  // Pull
  def('cable_row', 'Seated cable row', 'cable', 4, 8, 12, 5);
  def('db_row', 'One-arm dumbbell row', 'db', 4, 8, 12, 5, 50, 'Per arm');
  def('bw_prone_y', 'Prone Y raise', 'bw', 3, 12, 20, 0);
  def('lat_pulldown', 'Cable lat pulldown', 'cable', 3, 8, 12, 5);
  def('db_pullover', 'Dumbbell pullover', 'db', 3, 10, 15, 5, 50);
  def('bw_superman', 'Superman hold-and-lift', 'bw', 3, 10, 20, 0);
  def('face_pull', 'Cable face pull', 'cable', 3, 12, 20, 5);
  def('db_rear_fly', 'Dumbbell rear-delt fly', 'db', 3, 12, 20, 5, 50);
  def('bw_prone_t', 'Prone T raise', 'bw', 3, 12, 20, 0);
  def('db_curl', 'Dumbbell curl', 'db', 3, 10, 15, 5, 50);
  def('bw_backpack_curl', 'Backpack curl', 'bw', 3, 10, 20, 0, null, 'Log pack weight in + lb if used');

  // Full body
  def('db_split_squat', 'Dumbbell split squat', 'db', 3, 8, 12, 5, 50, 'Per leg, weight in each hand');
  def('bw_split_squat', 'Bodyweight split squat', 'bw', 3, 8, 15, 0, null, 'Per leg');
  def('reverse_crunch', 'Reverse crunch', 'bw', 3, 10, 20, 0);

  var SESSIONS = [
    { id: 'push', name: 'Upper push', blurb: 'Chest, shoulders, triceps.', slots: [
      { key: 'press', opts: { home: 'db_bench', hotel: 'db_bench', bw: 'pushup' }, extra: ['smith_bench'] },
      { key: 'shoulder', opts: { home: 'db_shoulder_press', hotel: 'db_shoulder_press', bw: 'pike_pushup' } },
      { key: 'fly', opts: { home: 'cable_fly', hotel: 'db_fly', bw: 'wide_pushup' } },
      { key: 'triceps', opts: { home: 'cable_pushdown', hotel: 'db_oh_tri', bw: 'bench_dip' } },
      { key: 'lateral', opts: { home: 'lat_raise', hotel: 'lat_raise', bw: 'plank_taps' } }
    ] },
    { id: 'lower', name: 'Lower (short and easy)', blurb: 'Four low-fatigue leg and glute moves.', slots: [
      { key: 'squat', opts: { home: 'smith_squat', hotel: 'goblet_squat', bw: 'bw_squat' }, extra: ['goblet_squat'] },
      { key: 'hinge', opts: { home: 'db_rdl', hotel: 'db_rdl', bw: 'bw_hinge' } },
      { key: 'glute', opts: { home: 'smith_hip_thrust', hotel: 'db_hip_thrust', bw: 'glute_bridge' } },
      { key: 'calves', opts: { home: 'calf_raise', hotel: 'calf_raise', bw: 'calf_raise_bw' } }
    ] },
    { id: 'pull', name: 'Upper pull', blurb: 'Back, rear delts, biceps.', slots: [
      { key: 'row', opts: { home: 'cable_row', hotel: 'db_row', bw: 'bw_prone_y' }, extra: ['db_row'] },
      { key: 'vertical', opts: { home: 'lat_pulldown', hotel: 'db_pullover', bw: 'bw_superman' } },
      { key: 'rear', opts: { home: 'face_pull', hotel: 'db_rear_fly', bw: 'bw_prone_t' } },
      { key: 'biceps', opts: { home: 'db_curl', hotel: 'db_curl', bw: 'bw_backpack_curl' } }
    ] },
    { id: 'full', name: 'Full body', blurb: 'A bit of everything, light on the legs.', slots: [
      { key: 'split', opts: { home: 'db_split_squat', hotel: 'db_split_squat', bw: 'bw_split_squat' } },
      { key: 'press2', opts: { home: 'db_shoulder_press', hotel: 'db_shoulder_press', bw: 'pike_pushup' } },
      { key: 'row2', opts: { home: 'db_row', hotel: 'db_row', bw: 'bw_prone_t' } },
      { key: 'core', opts: { home: 'reverse_crunch', hotel: 'reverse_crunch', bw: 'reverse_crunch' } }
    ] }
  ];

  // Your known starting points (per-side for smith, lb each for dumbbells).
  var SEED = {
    db_bench: { load: 45, extra: 0, miss: 0, last: null },
    smith_squat: { load: 45, extra: 0, miss: 0, last: null },
    cable_row: { load: 125, extra: 0, miss: 0, last: null }
  };

  // Every distinct exercise a slot can be swapped between, profile choice first.
  function alternatives(slot, profile) {
    var seen = {}, out = [];
    [slot.opts[profile]].concat(Object.keys(slot.opts).map(function (k) { return slot.opts[k]; }),
                                slot.extra || []).forEach(function (id) {
      if (!seen[id]) { seen[id] = 1; out.push(id); }
    });
    return out;
  }

  var api = { UNIT: UNIT, PROFILES: PROFILES, WARMUP: WARMUP, EX: EX, SESSIONS: SESSIONS,
              SEED: SEED, alternatives: alternatives };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FitPlan = api;
})(typeof window !== 'undefined' ? window : this);
