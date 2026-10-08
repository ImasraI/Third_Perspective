/**
 * ============================================================================
 *  Goal Tracker API tests
 * ============================================================================
 *  Loads the REAL Code.js inside a sandbox with stubbed Apps Script services and
 *  exercises every endpoint, including the food-library round trip that makes
 *  repeat foods free (no Gemini call).
 *
 *  Run: node tests/test_api.js
 * ==========================================================================*/

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CODE_PATH = path.join(__dirname, '..', 'Code.js');
const source = fs.readFileSync(CODE_PATH, 'utf8');

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; failures.push(name + (detail ? ' -> ' + detail : '')); console.log('  \u2717 ' + name + (detail ? '  -> ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------
function makeSandbox(opts) {
  opts = opts || {};
  // props given explicitly means "this is the exact Script Properties state",
  // so an empty object must really mean no keys at all.
  const store = Object.assign(
    'props' in opts ? {} : { GEMINI_API_KEY: 'test-key' },
    'props' in opts ? opts.props : {}
  );
  const sheets = {};
  const calls = { gemini: 0, sheetReads:0 };
  const cacheStore={};
  const sent = [];

  function makeSheet(name) {
    return {
      name: name,
      rows: [],
      getLastRow() { return this.rows.length; },
      // Sheets reports the last column of the header row, not the data.
      getLastColumn() {
        if (!this.rows.length) return 0;
        return this.rows[0].length;
      },
      getDataRange() { calls.sheetReads++; const s = this; return { getValues: () => s.rows.slice() }; },
      appendRow(row) { this.rows.push(row.slice()); },
      deleteRow(r) { this.rows.splice(r - 1, 1); },
      setFrozenRows() {},
      getRange(r, c, nR, nC) {
        const s = this;
        const api = {
          setValue(v) { if (!s.rows[r - 1]) s.rows[r - 1] = []; s.rows[r - 1][c - 1] = v; return api; },
          getValue() { return s.rows[r - 1] ? s.rows[r - 1][c - 1] : ''; },
          getValues() {
            return Array.from({ length: nR }, (_, i) => {
              const row = s.rows[r - 1 + i] || [];
              return Array.from({ length: nC }, (_, j) => row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
            });
          },
          setValues(rows) { rows.forEach((row, i) => { if (!s.rows[r - 1 + i]) s.rows[r - 1 + i] = []; row.forEach((v, j) => { s.rows[r - 1 + i][c - 1 + j] = v; }); }); return api; },
          setFontWeight() { return api; },
          setBackground() { return api; }
        };
        return api;
      }
    };
  }

  const sandbox = {
    sheets, store, calls, sent,
    console: { log() {}, error() {} },
    Logger: { log() {} },
    JSON, Math, Date, String, Number, Boolean, Array, Object,
    isNaN, parseInt, parseFloat, encodeURIComponent, RegExp,

    SpreadsheetApp: {
      flush() {},
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => { sheets[n] = makeSheet(n); return sheets[n]; }
      })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in store ? store[k] : null),
        getProperties: () => Object.assign({}, store),
        setProperty: (k, v) => { store[k] = String(v); },
        deleteProperty: (k) => { delete store[k]; }
      })
    },
    CacheService: {
      getScriptCache: () => ({ get: k => opts.cache ? cacheStore[k] || null : null, put(k,v) {if(opts.cache)cacheStore[k]=v;}, remove(k){delete cacheStore[k];} })
    },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }),
      getProjectTriggers: () => [],
      newTrigger: () => ({ timeBased: () => ({ atHour: () => ({ everyDays: () => ({ create: () => ({}) }) }) }) }),
      deleteTrigger() {}
    },
    Utilities: {
      formatDate(d, tz, fmt) {
        const p = (n) => String(n).padStart(2, '0');
        if (fmt === 'yyyy-MM-dd') return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
        return String(d);
      }
    },
    UrlFetchApp: {
      fetch(url, o) {
        if (url.includes('generativelanguage')) {
          calls.gemini++;
          calls.parts=JSON.parse(o.payload).contents[0].parts;
          sent.push(url);
          // Google retires model ids (404) and overloads them (503). Let a test
          // name the ids that fail so the fallback chain gets exercised.
          const model = (url.match(/models\/([^:?]+)/) || [])[1] || '';
          const code = (opts.modelStatus || {})[model];
          if (code) {
            return {
              getResponseCode: () => code,
              getContentText: () => JSON.stringify({
                error: {
                  code: code,
                  status: code === 404 ? 'NOT_FOUND' : (code === 429 ? 'RESOURCE_EXHAUSTED' : 'UNAVAILABLE'),
                  message: 'models/' + model + ' is no longer available to new users'
                }
              })
            };
          }
          if (opts.geminiResponse) {
            return { getResponseCode: () => 200, getContentText: () => JSON.stringify({
              candidates: [{ content: { parts: [{ text: JSON.stringify(opts.geminiResponse) }] } }]
            }) };
          }
          if (opts.geminiFail) {
            return { getResponseCode: () => 429, getContentText: () => 'quota exceeded' };
          }
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"ok":"OK"}' }] } }]
          }) };
        }
        return { getResponseCode: () => 200, getContentText: () => '{"ok":true,"result":true}' };
      }
    },
    ContentService: {
      MimeType: { TEXT: 'text/plain', JSON: 'application/json' },
      createTextOutput: (b) => ({ body: b, setMimeType() { return this; } })
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'Code.js' });
  sandbox.setupSheets();
  return sandbox;
}

/** call the API the way the browser does (POST a JSON string to doPost) */
function call(sb, payload) {
  const res = sb.doPost({ postData: { contents: JSON.stringify(payload) } });
  return JSON.parse(res.body);
}

// ---------------------------------------------------------------------------
console.log('=== Goal Tracker API tests ===');

// ===========================================================================
section('[1] setup + state');
{
  const sb = makeSandbox();
  const st = call(sb, { action: 'state' });
  check('state returns ok', st.ok === true, JSON.stringify(st).slice(0, 200));
  check('all 7 sheets created', Object.keys(sb.sheets).length === 7, Object.keys(sb.sheets).join(','));
  check('goals are present', st.goals && st.goals.calories > 0);
  check('muscle status covers all 17 groups',
    Object.keys(st.workouts.muscleStatus).length === 17,
    String(Object.keys(st.workouts.muscleStatus).length));
  check('nothing trained initially', !st.workouts.muscleStatus.chest.trained);
  check('unknown action is rejected', call(sb, { action: 'nope' }).ok === false);
  check('ping works without auth', call(sb, { action: 'ping' }).pong === true);
}

// ===========================================================================
section('[2] nutrition: AI parse -> log -> cache -> reuse without AI');
{
  const sb = makeSandbox({
    geminiResponse: {
      kind: 'food',
      foods: [
        // "2 eggs" -> macros are for BOTH eggs, reference is 1 egg
        { name: 'egg', qty: 2, unit: 'egg', refAmount: 1, refUnit: 'egg', calories: 144, protein: 12.6, carbs: 0.7, fat: 9.5 },
        // "150g chicken" -> macros are for 150 g, reference is 100 g
        { name: 'chicken breast', qty: 150, unit: 'g', refAmount: 100, refUnit: 'g', calories: 247.5, protein: 46.5, carbs: 0, fat: 5.4 }
      ]
    }
  });

  const p = call(sb, { action: 'parse', text: '2 eggs and 150g chicken breast' });
  check('parse routed to gemini', p.source === 'gemini', p.source);
  check('parse returns 2 foods', p.foods.length === 2, String(p.foods && p.foods.length));
  check('serving macros passed through', p.foods[0].calories === 144, String(p.foods[0].calories));
  check('piece reference is 1 egg', p.foods[0].ref.amount === 1 && p.foods[0].ref.unit === 'egg', JSON.stringify(p.foods[0].ref));
  check('per-egg macros derived (144/2)', Math.abs(p.foods[0].ref.calories - 72) < 0.01, String(p.foods[0].ref.calories));
  check('weighed reference is 100 g', p.foods[1].ref.amount === 100 && p.foods[1].ref.unit === 'g', JSON.stringify(p.foods[1].ref));
  check('per-100g macros derived (247.5*100/150)', Math.abs(p.foods[1].ref.calories - 165) < 0.01, String(p.foods[1].ref.calories));

  const logged = call(sb, { action: 'log.food', items: p.foods, source: 'AI' });
  check('log.food succeeds', logged.ok === true, logged.error);
  // The client already scaled to the serving, so the server must NOT scale again.
  check('2 eggs = 144 kcal (as served)', logged.items[0].calories === 144, String(logged.items[0].calories));
  check('150g chicken = 247.5 kcal', logged.items[1].calories === 247.5, String(logged.items[1].calories));
  check('nutrition totals reflected', logged.today.calories === 144 + 247.5, String(logged.today.calories));
  check('protein 12.6 + 46.5 = 59.1', Math.abs(logged.today.protein - 59.1) < 0.11, String(logged.today.protein));

  // cache it
  const before = sb.calls.gemini;
  const cache = call(sb, {
    action: 'food.cache',
    items: p.foods.map(f => ({ name: f.name, refAmount: f.ref.amount, refUnit: f.ref.unit, calories: f.ref.calories, protein: f.ref.protein, carbs: f.ref.carbs, fat: f.ref.fat }))
  });
  check('food.cache saves 2 rows', cache.cached === 2, String(cache.cached));
  check('no extra gemini call for caching', sb.calls.gemini === before, String(sb.calls.gemini));

  const st = call(sb, { action: 'state' });
  check('library now has 2 foods', st.foods.length === 2, String(st.foods.length));
  const egg = st.foods.find(f => f.name === 'egg');
  check('library egg is per-piece (1 egg = 72 kcal)', egg && egg.calories === 72 && egg.refUnit === 'egg' && egg.refAmount === 1, JSON.stringify(egg));
  const chick = st.foods.find(f => f.name === 'chicken breast');
  check('library chicken is per-100g', chick && chick.calories === 165 && chick.refUnit === 'g', JSON.stringify(chick));

  // re-caching the same food bumps the use counter instead of duplicating
  call(sb, { action: 'food.cache', items: [{ name: 'Egg', refAmount: 1, refUnit: 'egg', calories: 72, protein: 6.3, carbs: 0.35, fat: 4.75 }] });
  const st2 = call(sb, { action: 'state' });
  check('re-cached food is merged, not duplicated', st2.foods.length === 2, String(st2.foods.length));
  const egg2 = st2.foods.find(f => f.name.toLowerCase() === 'egg');
  check('name match is case-insensitive', !!egg2, JSON.stringify(st2.foods.map(f => f.name)));
  check('use counter incremented', egg2.uses === 2, String(egg2.uses));

  // search
  const s = call(sb, { action: 'food.search', q: 'chick' });
  check('search finds chicken', s.matches.length === 1 && s.matches[0].name === 'chicken breast', JSON.stringify(s.matches.map(m => m.name)));
  const s2 = call(sb, { action: 'food.search', q: '' });
  check('empty search returns the library', s2.matches.length === 2, String(s2.matches.length));
}

// ===========================================================================
section('[3] the same quantity rule holds for pieces and for weights');
{
  // kcal = perReference * qty / refAmount
  function scale(per, qty, refAmount) { return Math.round(per * qty / refAmount * 10) / 10; }
  const perEgg = 72, per100g = 165;
  check('1 egg = base', scale(perEgg, 1, 1) === 72, String(scale(perEgg, 1, 1)));
  check('3 eggs = 3x', scale(perEgg, 3, 1) === 216, String(scale(perEgg, 3, 1)));
  check('100g = base', scale(per100g, 100, 100) === 165, String(scale(per100g, 100, 100)));
  check('150g = 1.5x', scale(per100g, 150, 100) === 247.5, String(scale(per100g, 150, 100)));
  check('50g = half', scale(per100g, 50, 100) === 82.5, String(scale(per100g, 50, 100)));
}

// ===========================================================================
section('[4] gemini failures degrade gracefully');
{
  const sb = makeSandbox({ geminiFail: true });
  const p = call(sb, { action: 'parse', text: 'chicken and rice' });
  check('fallback still returns ok', p.ok === true);
  check('fallback is labelled', p.source === 'local-fallback', p.source);
  check('fallback produces a food stub', p.kind === 'food' && p.foods.length === 1, JSON.stringify(p.kind));
  check('stub is flagged for manual entry', p.foods[0].estimated === true, JSON.stringify(p.foods[0]));
  check('stub has the full ref shape', p.foods[0].ref && p.foods[0].ref.amount === 1, JSON.stringify(p.foods[0].ref));

  const sb2 = makeSandbox({ props: {} });
  const p2 = call(sb2, { action: 'parse', text: '2 eggs' });
  check('no API key at all still works offline', p2.ok === true && p2.source === 'local', JSON.stringify(p2.source));
  const t = call(sb2, { action: 'gemini.test' });
  check('gemini.test reports the missing key', t.ok === false, JSON.stringify(t));
  check('gemini.test names the exact property', /GEMINI_API_KEY/.test(t.error || ''), t.error);
  check('gemini.test flags needsKey for the UI', t.needsKey === true, JSON.stringify(t));

  // With a key present the ping must really reach Gemini. This is the check
  // that catches a missing geminiTest(): dispatch would swallow the
  // ReferenceError as a generic ok:false, which the assertions above accept.
  const tOk = call(makeSandbox(), { action: 'gemini.test' });
  check('gemini.test succeeds when the key is set', tOk.ok === true && tOk.response === 'OK', JSON.stringify(tOk));
  check('gemini.test reports the model', tOk.model === 'gemini-3.8-flash', String(tOk.model));
  check('gemini.test names the key slot it used',
    /GEMINI_API_KEY/.test(tOk.keySource || ''), String(tOk.keySource));

  const tFail = call(makeSandbox({ geminiFail: true }), { action: 'gemini.test' });
  check('gemini.test surfaces transport errors', tFail.ok === false && /429/.test(tFail.error || ''), JSON.stringify(tFail));

  // A retired model id must not read as a broken key. This is the failure that
  // made the settings button fail with a perfectly valid key: gemini-2.5-flash
  // answered 404 "no longer available to new users".
  const sbRetired = makeSandbox({ modelStatus: { 'gemini-3.8-flash': 404 } });
  const tFallback = call(sbRetired, { action: 'gemini.test' });
  check('gemini.test falls through a retired model',
    tFallback.ok === true && tFallback.model === 'gemini-flash-latest', JSON.stringify(tFallback));
  check('gemini.test tries the preferred model first',
    /gemini-3\.8-flash/.test(sbRetired.sent[0] || ''), String(sbRetired.sent[0]));

  // Every model down is still a clean error, not a crash, and it reports what
  // it tried instead of blaming the key.
  const sbAllDown = makeSandbox({
    modelStatus: { 'gemini-3.8-flash': 503, 'gemini-flash-latest': 503, 'gemini-3.1-flash-lite': 503 }
  });
  const tDown = call(sbAllDown, { action: 'gemini.test' });
  check('all models down reports a real error', tDown.ok === false && /503/.test(tDown.error || ''), JSON.stringify(tDown));
  check('the failure lists every model tried',
    Array.isArray(tDown.modelsTried) && tDown.modelsTried.length === 3, JSON.stringify(tDown.modelsTried));

  // The key pasted into KEYS.GEMINI (a property NAME slot) used to be looked up
  // as a property called "AQ.xxx", which found nothing and reported "not set".
  const sbInline = makeSandbox({ props: {} });
  vm.runInContext("KEYS.GEMINI = 'AQ.test-inline-key-1234567890'", sbInline);
  const tInline = call(sbInline, { action: 'gemini.test' });
  check('a key pasted into KEYS.GEMINI still works', tInline.ok === true, JSON.stringify(tInline));
  check('gemini.test says the key came from code',
    /KEYS\.GEMINI/.test(tInline.keySource || ''), String(tInline.keySource));

  // Same kindness for a key filed under an unexpected property name.
  const sbStray = makeSandbox({ props: { MY_GEMINI_KEY: 'AQ.stray-key-1234567890' } });
  const tStray = call(sbStray, { action: 'gemini.test' });
  check('a key under another property name is found', tStray.ok === true, JSON.stringify(tStray));
  check('gemini.test names the stray property',
    /MY_GEMINI_KEY/.test(tStray.keySource || ''), String(tStray.keySource));
}

// ===========================================================================
section('[5] absurd AI numbers stay bounded by the reference');
{
  const sb = makeSandbox();
  // Model claims 2 eggs contain 40,000 kcal. The reference (1 egg) is derived
  // by dividing, so the serving number itself is passed through untouched.
  const r = sb.serveFood({ name: 'egg', qty: 2, unit: 'egg', refAmount: 1, refUnit: 'egg', calories: 40000, protein: 1200, carbs: 0, fat: 900 });
  check('serving macros untouched', r.calories === 40000, String(r.calories));
  check('reference still scales down (20,000/egg)', Math.abs(r.ref.calories - 20000) < 0.01, String(r.ref.calories));
  check('missing ref fields fall back to the unit', sb.serveFood({ name: 'toast', qty: 2, unit: 'slice', calories: 180 }).ref.unit === 'slice', JSON.stringify(sb.serveFood({ name: 'toast', qty: 2, unit: 'slice', calories: 180 }).ref));
  check('missing ref on a weight unit defaults to 100 g', sb.serveFood({ name: 'rice', qty: 150, unit: 'g', calories: 195 }).ref.amount === 100, JSON.stringify(sb.serveFood({ name: 'rice', qty: 150, unit: 'g', calories: 195 }).ref));
}

// ===========================================================================
section('[6] workouts + muscle recovery map');
{
  const sb = makeSandbox();
  const w1 = call(sb, { action: 'log.workout', name: 'Push', exercises: 'bench 80kg 4x10', durationMin: 60, muscles: ['chest', 'triceps', 'shoulders'] });
  check('workout saved', w1.ok === true, w1.error);
  // The exercise text wins over the picked muscles: "bench 80kg 4x10" now
  // credits chest, triceps AND both front + side delts (it used to credit
  // exactly 3 muscles, which is why the old assertion passed by coincidence).
  check('bench press credits the delt split', w1.muscles.length === 4, w1.muscles.join(','));

  // With no exercise text to derive from, the picked muscles are stored as
  // given — and the legacy "shoulders" alias expands to all three delt heads.
  const w2 = call(sb, { action: 'log.workout', name: 'Legacy', muscles: ['shoulders'] });
  check('legacy shoulders expands to three delt heads',
    w2.ok === true && w2.muscles.length === 3 &&
    w2.muscles.indexOf('front-delts') !== -1 &&
    w2.muscles.indexOf('side-delts') !== -1 &&
    w2.muscles.indexOf('rear-delts') !== -1,
    w2.muscles.join(','));

  const st = call(sb, { action: 'state' });
  check('chest marked trained today', st.workouts.muscleStatus.chest.trained === true);
  check('chest daysAgo = 0', st.workouts.muscleStatus.chest.daysAgo === 0, String(st.workouts.muscleStatus.chest.daysAgo));
  check('back still untrained', st.workouts.muscleStatus.back.trained === false);
  check('1 session this week for chest', st.workouts.muscleStatus.chest.sessions7d === 1, String(st.workouts.muscleStatus.chest.sessions7d));
  check('bad muscle names are dropped', call(sb, { action: 'log.workout', muscles: ['chest', 'wings'] }).muscles.length === 1);
  check('workout with no muscles is rejected', call(sb, { action: 'log.workout', muscles: [] }).ok === false);

  // Drop the extra rows so the ageing below is not masked by them, then
  // backdate the single remaining session.
  sb.sheets.Workouts.rows.length = 2;
  sb.sheets.Workouts.rows[1][1] = new Date(Date.now() - 5 * 86400000);
  const st2 = call(sb, { action: 'state' });
  check('5 days ago => still trained, daysAgo 5', st2.workouts.muscleStatus.chest.trained && st2.workouts.muscleStatus.chest.daysAgo === 5,
    JSON.stringify(st2.workouts.muscleStatus.chest));

  sb.sheets.Workouts.rows[1][1] = new Date(Date.now() - 9 * 86400000);
  const st3 = call(sb, { action: 'state' });
  check('9 days ago => not trained in 7d window', st3.workouts.muscleStatus.chest.trained === false);
  check('9 days ago => overdue but not yet stale', st3.workouts.muscleStatus.chest.stale === false, JSON.stringify(st3.workouts.muscleStatus.chest));

  sb.sheets.Workouts.rows[1][1] = new Date(Date.now() - 20 * 86400000);
  const st4 = call(sb, { action: 'state' });
  check('20 days ago => flagged stale', st4.workouts.muscleStatus.chest.stale === true, JSON.stringify(st4.workouts.muscleStatus.chest));
  check('20 days ago => never trained count is 0', st4.workouts.muscleStatus.chest.sessions7d === 0);
}

// ===========================================================================
section('[6b] deriveRowLoad survives legacy/missing rows (driveRowLoad crash)');
{
  const sb = makeSandbox();
  // The exact crash from the driveRowLoad script:
  //   TypeError: Cannot read properties of undefined (reading 'exercises')
  check('undefined rec returns null instead of throwing',
    sb.deriveRowLoad(undefined, '2026-10-05') === null);
  check('null rec returns null', sb.deriveRowLoad(null, '2026-10-05') === null);
  check('empty rec returns null', sb.deriveRowLoad({}, '2026-10-05') === null);

  // Legacy rows carry only `exercises`, never a `muscles` array.
  const legacy = sb.deriveRowLoad({ rowId: 2, exercises: 'bench 80kg 4x10' }, '2026-10-05');
  check('legacy row with parseable text derives a load',
    legacy !== null && typeof legacy === 'object', JSON.stringify(legacy));

  const garbage = sb.deriveRowLoad({ rowId: 3, exercises: 'zzz not a workout' }, '2026-10-05');
  check('unparseable text with no muscles returns null', garbage === null, JSON.stringify(garbage));

  const stored = sb.deriveRowLoad({ rowId: 4, exercises: 'zzz', muscles: ['chest'] }, '2026-10-05');
  check('unparseable text falls back to a flat muscle bucket',
    stored !== null && stored.chest === 200, JSON.stringify(stored));
}

// ===========================================================================
section('[7] AI muscle detection from free text');
{
  const sb = makeSandbox();
  const m = sb.detectMuscles('squat 5x5 and leg press');
  check('squat trains quads', m.includes('quads'), m.join(','));
  check('squat trains glutes', m.includes('glutes'), m.join(','));
  check('leg press trains quads', m.includes('quads'));
  const m2 = sb.detectMuscles('lat pulldown and barbell row');
  check('pulldown trains back', m2.includes('back'), m2.join(','));
  check('curl trains biceps', sb.detectMuscles('barbell curl 4x8').includes('biceps'));
  check('plank trains abs', sb.detectMuscles('plank 3x60s').includes('abs'));

  const p = call(sb, { action: 'parse', text: 'bench press 80kg 4x10' });
  check('free text recognised as a workout offline', p.kind === 'workout', p.kind);
  check('offline workout carries muscles', p.muscles.includes('chest'), p.muscles.join(','));
}

// ===========================================================================
section('[7b] fencing targets including low contributions');
{
  const sb = makeSandbox({ props: {} });
  const parsed = call(sb, { action: 'parse.workout', text: 'fencing practice 20 minutes' });
  check('fencing is recognised offline', parsed.kind === 'workout' && parsed.matched);
  check('fencing includes legs, grip, arm and core targets', ['quads','calves','glutes','hamstrings','forearms','front-delts','side-delts','triceps','biceps','abs','obliques'].every(m => parsed.muscles.includes(m)));
  check('supporting muscles retain smaller loads', parsed.load.biceps > 0 && parsed.load.biceps < parsed.load.quads);
  const ai = makeSandbox({ geminiResponse: { kind: 'workout', muscles: [], exercises: [{name:'fencing', sets:1, reps:1}] } });
  const answer = call(ai, {action:'parse', text:'fencing'});
  check('empty LLM muscle result is repaired from fencing lookup', answer.muscles.includes('forearms') && answer.muscles.includes('quads'));
  const saved = call(sb, {action:'log.workout', name:'Fencing', exercises:'fencing', muscles:[]});
  check('fencing saves even when AI omitted all targets', saved.ok && saved.muscles.includes('quads'));
  const state = call(sb, {action:'state'});
  check('small fencing contributions remain listed in workout history', state.workouts.recent[0].muscles.includes('biceps'));
}

section('[8] expenses');
{
  const sb = makeSandbox();
  call(sb, { action: 'log.expense', amount: 250000, category: 'Food & Dining', merchant: 'KFC' });
  call(sb, { action: 'log.expense', amount: 1500000, category: 'Transportation', merchant: 'Uber' });
  const st = call(sb, { action: 'state' });
  check('today total = 1,750,000', st.expenses.todayTotal === 1750000, String(st.expenses.todayTotal));
  check('month total matches', st.expenses.monthTotal === 1750000, String(st.expenses.monthTotal));
  check('category breakdown has 2 keys', Object.keys(st.expenses.byCategory).length === 2, JSON.stringify(st.expenses.byCategory));
  check('zero amount rejected', call(sb, { action: 'log.expense', amount: 0 }).ok === false);
  check('category auto-detect works', sb.detectCategory('spent 30 on starbucks') === 'Food & Dining', sb.detectCategory('spent 30 on starbucks'));
}

// ===========================================================================
section('[9] study, tasks, classes');
{
  const sb = makeSandbox();
  const s = call(sb, { action: 'log.study', subject: 'Physics', minutes: 45 });
  check('study logged', s.ok && s.todayMinutes === 45, JSON.stringify(s));
  call(sb, { action: 'log.study', subject: 'Math', minutes: 30 });
  check('study accumulates to 75', call(sb, { action: 'state' }).study.todayMinutes === 75);
  check('zero minutes rejected', call(sb, { action: 'log.study', minutes: 0 }).ok === false);

  const t = call(sb, { action: 'task.add', task: 'Submit report', due: 'Friday', priority: 'High' });
  check('task added', t.ok && t.tasks.length === 1, JSON.stringify(t));
  const rowId = t.tasks[0].rowId;
  const tog = call(sb, { action: 'task.toggle', rowId: rowId });
  check('task toggles to Completed', tog.tasks[0].status === 'Completed', tog.tasks[0].status);
  check('completion date stamped', !!tog.tasks[0].completed, String(tog.tasks[0].completed));
  const tog2 = call(sb, { action: 'task.toggle', rowId: rowId });
  check('task toggles back to Pending', tog2.tasks[0].status === 'Pending');
  check('bad rowId rejected', call(sb, { action: 'task.toggle', rowId: 9999 }).ok === false);
  check('empty task rejected', call(sb, { action: 'task.add', task: '' }).ok === false);

  const c = call(sb, { action: 'class.add', day: 'Saturday', time: '09:00', subject: 'Physics', room: 'Hall 3' });
  check('class added', c.ok && c.classes.length === 1);
  check('empty subject rejected', call(sb, { action: 'class.add', day: 'Monday' }).ok === false);
}

// ===========================================================================
section('[10] delete + protection');
{
  const sb = makeSandbox();
  call(sb, { action: 'log.food', items: [{ name: 'x', qty: 1, unit: 'serving', calories: 10, protein: 1, carbs: 1, fat: 1 }] });
  check('delete works', call(sb, { action: 'entry.delete', sheet: 'Nutrition', rowId: 2 }).ok === true);
  check('Nutrition back to header only', sb.sheets.Nutrition.rows.length === 1, String(sb.sheets.Nutrition.rows.length));
  check('header row cannot be deleted', call(sb, { action: 'entry.delete', sheet: 'Nutrition', rowId: 1 }).ok === false);
  check('Foods sheet is not deletable via the API', call(sb, { action: 'entry.delete', sheet: 'Foods', rowId: 2 }).ok === false);
  check('unknown sheet rejected', call(sb, { action: 'entry.delete', sheet: 'Hackers', rowId: 2 }).ok === false);
}

// ===========================================================================
section('[11] goals persist to script properties');
{
  const sb = makeSandbox();
  const g = call(sb, { action: 'goals.save', calories: 2400, protein: 160, carbs: 260, fat: 75, studyMinutes: 180, monthBudget: 40000000, currency: 'toman' });
  check('goals saved', g.goals.calories === 2400 && g.goals.protein === 160);
  check('goals persisted to store', !!sb.store.tracker_goals);
  const st = call(sb, { action: 'state' });
  check('state returns the new goals', st.goals.calories === 2400 && st.goals.currency === 'toman');
  check('partial save keeps other goals', (function () {
    sb.store.tracker_goals = JSON.stringify({ calories: 1000 });
    return call(sb, { action: 'state' }).goals.protein === 140;
  })());
}

// ===========================================================================
section('[11b] edit food + edit workout');
{
  const sb = makeSandbox();
  // Seed a nutrition row (rowId 2) exactly like log.food does.
  const today = sb.Utilities.formatDate(new Date(), 'Asia/Tehran', 'yyyy-MM-dd');
  const row = [new Date(), today, 'egg', 2, 'egg', 144, 12.6, 0.7, 9.5, 'AI'];
  sb.sheets.Nutrition.appendRow(row);
  const editFood = call(sb, { action: 'edit.food', rowId: 2, food: 'egg', qty: 3, unit: 'egg', calories: 216, protein: 18.9, carbs: 1.05, fat: 14.25 });
  check('edit.food succeeds', editFood.ok === true, editFood.error);
  check('food totals updated after edit', Math.abs(editFood.today.calories - 216) < 0.01, String(editFood.today.calories));
  // Empty name is rejected (required).
  const keep = call(sb, { action: 'edit.food', rowId: 2, food: '' });
  check('edit.food rejects empty name', keep.ok === false, keep.error);
  check('food name unchanged after rejected edit', sb.sheets.Nutrition.rows[1][2] === 'egg', String(sb.sheets.Nutrition.rows[1][2]));

  // Seed a workout row (rowId 2).
  const wdate = sb.Utilities.formatDate(new Date(), 'Asia/Tehran', 'yyyy-MM-dd');
  const wrow = [new Date(), wdate, 'Push', 'bench 80kg 4x10', 60, 'chest,triceps,front-delts,side-delts', '', '{}'];
  sb.sheets.Workouts.appendRow(wrow);
  const editWork = call(sb, { action: 'edit.workout', rowId: 2, name: 'Push Day', durationMin: 70, exercises: 'bench 80kg 4x10 and overhead press', muscles: ['chest', 'triceps', 'shoulders'] });
  check('edit.workout succeeds', editWork.ok === true, editWork.error);
  check('workout renamed', editWork.ok === true && sb.sheets.Workouts.rows[1][2] === 'Push Day', String(sb.sheets.Workouts.rows[1][2]));
  check('duration updated', editWork.ok === true && sb.sheets.Workouts.rows[1][4] === 70, String(sb.sheets.Workouts.rows[1][4]));
  check('muscles stored', editWork.ok === true && sb.sheets.Workouts.rows[1][5] === 'chest,triceps,front-delts,side-delts,rear-delts', String(sb.sheets.Workouts.rows[1][5]));
  const previousLoad = sb.sheets.Workouts.rows[1][7];
  check('workout edit regenerates stored muscle load', previousLoad !== '{}' && !!JSON.parse(previousLoad).chest);
  const changed = call(sb, { action: 'edit.workout', rowId: 2, exercises: 'squat 40kg 3x10', muscles: ['quads', 'glutes'] });
  const changedLoad = JSON.parse(sb.sheets.Workouts.rows[1][7]);
  check('changing exercises replaces old muscle load', changed.ok && changedLoad.quads > 0 && !changedLoad.chest);
  check('fractional workout row is rejected', call(sb, { action: 'edit.workout', rowId: 2.5, name: 'Invalid' }).ok === false);
  check('negative workout duration is rejected', call(sb, { action: 'edit.workout', rowId: 2, durationMin: -10 }).ok === false);
  check('invalid workout muscle list is rejected', call(sb, { action: 'edit.workout', rowId: 2, muscles: ['invalid'] }).ok === false);
  check('legacy workout with no exercise text still has effort', (() => {
    sb.sheets.Workouts.appendRow([new Date(), wdate, 'Manual session', '', 15, 'biceps', '']);
    return call(sb, { action: 'state' }).workouts.muscleStatus.biceps.load7d > 0;
  })());
  // Bad rowId rejected.
  check('edit.food rejects bad rowId', call(sb, { action: 'edit.food', rowId: 9999 }).ok === false);
  check('edit.workout rejects bad rowId', call(sb, { action: 'edit.workout', rowId: 9999 }).ok === false);
  // Nothing to edit rejected.
  check('edit.food rejects nothing to edit', call(sb, { action: 'edit.food', rowId: 2 }).ok === false);
}

// ===========================================================================
section('[11c] class metadata');
{
  const sb = makeSandbox();
  call(sb, {action: 'state'});
  call(sb, {action: 'class.add', day: 'Wednesday', time: '09:00', subject: 'Physics', notes: JSON.stringify({date: '2026-10-07', repeat: 'never', endTime: '10:00', color: 'purple'})});
  const cls = call(sb, {action: 'state'}).classes[0];
  check('class date and repeat survive the Sheet round trip', cls.date === '2026-10-07' && cls.repeat === 'never');
  check('class end time and color survive the Sheet round trip', cls.endTime === '10:00' && cls.color === 'purple');
  call(sb, {action: 'class.add', subject: 'Legacy', notes: 'ordinary notes'});
  check('legacy class notes default to weekly recurrence', call(sb, {action: 'state'}).classes[0].repeat === 'weekly');
}

section('[12] app key auth');
{
  const open = makeSandbox({ props: {} });
  check('open when APP_KEY is unset', call(open, { action: 'state' }).ok === true);

  const locked = makeSandbox({ props: { APP_KEY: 's3cret' } });
  check('rejects request with no key', call(locked, { action: 'state' }).ok === false);
  check('rejects wrong key', call(locked, { action: 'state', appKey: 'nope' }).ok === false);
  check('accepts correct key', call(locked, { action: 'state', appKey: 's3cret' }).ok === true);
  check('ping stays open for troubleshooting', call(locked, { action: 'ping' }).ok === true);
}

// ===========================================================================
section('[13] doGet health check + JSON safety');
{
  const sb = makeSandbox();
  const res = sb.doGet({ parameter: { action: 'ping' } });
  const body = JSON.parse(res.body);
  check('doGet answers JSON', body.ok === true, JSON.stringify(body));
  const bad = sb.doPost({ postData: { contents: 'not json' } });
  check('garbage body returns a clean error', JSON.parse(bad.body).ok === false);
}

// ===========================================================================

section('[14] daily assistant and persistent undo');
{
  const sb=makeSandbox({geminiResponse:{reply:'Recorded your day.',understood:true,actions:[
    {action:'log.food',items:[{name:'egg',qty:2,unit:'egg',calories:144,protein:12,carbs:1,fat:10}]},
    {action:'log.workout',name:'Fencing',exercises:'fencing 45 minutes',durationMin:45,muscles:['quads','forearms']},
    {action:'log.expense',amount:12,category:'Food',merchant:'Lunch'},
    {action:'log.study',subject:'Math',minutes:60}
  ]}});
  const result=call(sb,{action:'chat',message:'My day: eggs, fencing, lunch and maths.'});
  check('daily report writes all four categories',result.applied.length===4 && result.failed.length===0,JSON.stringify(result));
  let state=call(sb,{action:'state'});
  check('each assistant change has persistent undo',state.changes.length===4);
  check('food summary includes calories',result.applied[0].includes('144 kcal'));
  check('workout summary includes supporting muscles',result.applied[1].includes('forearms'));
  const food=state.changes.find(c=>c.panel==='Nutrition');
  call(sb,{action:'log.expense',amount:5});
  check('undo unrelated later changes is safe',call(sb,{action:'changes.undo',id:food.id}).ok);
  check('nutrition totals revert',call(sb,{action:'state'}).nutrition.today.calories===0);
  check('repeat undo is refused',call(sb,{action:'changes.undo',id:food.id}).ok===false);
  const ex=call(sb,{action:'state'}).changes.find(c=>c.panel==='Expenses');
  call(sb,{action:'entry.edit',sheet:'Expenses',rowId:3,fields:{amount:7}});
  check('undo detects later edits',call(sb,{action:'changes.undo',id:ex.id}).ok===false);
  const edit=call(sb,{action:'state'}).changes[0];
  check('edit itself is undoable',call(sb,{action:'changes.undo',id:edit.id}).ok);
  check('restored entry can be undone',call(sb,{action:'changes.undo',id:ex.id}).ok);
  const goal=call(sb,{action:'goals.save',calories:2300});
  check('goal change journaled',!!goal.changeId);
  check('goals revert',call(sb,{action:'changes.undo',id:goal.changeId}).ok && call(sb,{action:'state'}).goals.calories!==2300);
  const deleted=call(sb,{action:'entry.delete',sheet:'Expenses',rowId:2});
  check('deletion restores original row',call(sb,{action:'changes.undo',id:deleted.changeId}).ok && call(sb,{action:'state'}).expenses.monthTotal===12);
  check('history records undone state',call(sb,{action:'state'}).changes.find(c=>c.id===food.id).undone);
  check('invalid edits are rejected before writing',!call(sb,{action:'entry.edit',sheet:'Study',rowId:2,fields:{minutes:-2}}).ok);
  const ask=makeSandbox({geminiResponse:{reply:'How long?',understood:true,question:'How long?',pending:'workout',actions:[{action:'log.expense',amount:99}]}});
  check('clarification performs no writes',call(ask,{action:'chat',message:'I fenced'}).applied.length===0 && call(ask,{action:'state'}).expenses.monthTotal===0);
  const bad=makeSandbox({geminiResponse:{reply:'Done',understood:true,actions:[{action:'log.expense',amount:-4}]}});
  check('invalid AI amounts fail visibly',call(bad,{action:'chat',message:'expense'}).failed.length===1);
  const photo=makeSandbox({geminiResponse:{reply:'Photo read',understood:true,actions:[]}});
  check('photo-only conversation accepted',call(photo,{action:'chat',image:'data:image/jpeg;base64,YWJj'}).ok);
  check('photo is passed to the model as image data',photo.calls.parts[1].inlineData.data==='YWJj');
  check('invalid images rejected',!call(photo,{action:'chat',image:'not an image'}).ok);

  const shifted=makeSandbox({geminiResponse:{reply:'Removed both.',understood:true,actions:[{action:'delete',sheet:'Expenses',rowId:2},{action:'delete',sheet:'Expenses',rowId:3}]}});
  call(shifted,{action:'log.expense',amount:10});call(shifted,{action:'log.expense',amount:20});call(shifted,{action:'log.expense',amount:30});
  const batch=call(shifted,{action:'chat',message:'Delete the first two expenses'});
  check('multiple deletes follow entries despite shifting row numbers',batch.applied.length===2 && call(shifted,{action:'state'}).expenses.monthTotal===30);
  const many=makeSandbox();
  for(let i=0;i<103;i++)call(many,{action:'log.study',subject:'Subject '+i,minutes:1});
  check('old changes remain accessible through history pagination',call(many,{action:'changes.list',offset:100}).changes.length===3);
  const old=call(many,{action:'changes.list',offset:100}).changes[0];
  check('old additions undo without disturbing newer entries',call(many,{action:'changes.undo',id:old.id}).ok && call(many,{action:'state'}).study.todayMinutes===102);
  const locked=makeSandbox({props:{APP_KEY:'private'}});
  check('undo requires backend authorization',!call(locked,{action:'changes.undo',id:'anything'}).ok);
}


section('[15] energy balance and fast reads');
{
  const sb=makeSandbox({cache:true});
  call(sb,{action:'state'});const reads=sb.calls.sheetReads;call(sb,{action:'state'});
  check('dashboard repeat read uses cache',sb.calls.sheetReads===reads);
  const logged=call(sb,{action:'log.workout',name:'Fencing',exercises:'fencing',durationMin:30,muscles:['quads']});
  const state=call(sb,{action:'state'});
  check('30 minute fencing active calories exclude resting energy',state.workouts.todayBurned===184,JSON.stringify(state.workouts.today));
  check('logged and dashboard energy estimates agree',logged.kcal===state.workouts.todayBurned);
  check('writes invalidate cached dashboard',sb.calls.sheetReads>reads && state.workouts.today.length===1);
  check('workout history includes burned calories',state.workouts.recent[0].kcal===184);
  const edited=call(sb,{action:'edit.workout',rowId:2,durationMin:60});
  check('duration edit recalculates energy',call(sb,{action:'state'}).workouts.todayBurned===368);
  call(sb,{action:'changes.undo',id:edited.changeId});
  check('undo restores energy and invalidates cached totals',call(sb,{action:'state'}).workouts.todayBurned===184);
  call(sb,{action:'goals.save',bodyWeightKg:80});
  check('bodyweight changes energy estimate',call(sb,{action:'state'}).workouts.todayBurned===210);
  const fast=makeSandbox();call(fast,{action:'parse',text:'bench press 4x10'});
  check('known workouts skip Gemini',fast.calls.gemini===0);
  const food=makeSandbox({cache:true,geminiResponse:{kind:'food',foods:[{name:'egg',qty:1,unit:'egg',calories:72,protein:6,carbs:1,fat:5,refAmount:1,refUnit:'egg'}]}});
  call(food,{action:'parse',text:'1 egg'});call(food,{action:'parse',text:'1 egg'});
  check('repeated food text reuses Gemini response',food.calls.gemini===1);
}

console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
if (fail) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
