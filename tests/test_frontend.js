const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const web = path.join(__dirname, '..', 'web');
const dom = new JSDOM(fs.readFileSync(path.join(web, 'index.html'), 'utf8'), {
  url: 'http://localhost/', runScripts: 'outside-only'
});
const w = dom.window;
const requests = [];
w.lucide = { createIcons() {} };
w.Chart = class { destroy() {} };
w.AbortSignal = AbortSignal;
w.fetch = async (url, options) => {
  requests.push(JSON.parse(options.body));
  return { ok: true, json: async () => ({ ok: true }) };
};
const context = dom.getInternalVMContext();
vm.runInContext(fs.readFileSync(path.join(web, 'bodymap.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(web, 'app.js'), 'utf8'), context);
const run = code => vm.runInContext(code, context);
const get = id => w.document.getElementById(id);
const click = id => get(id).click();
let count = 0;
function test(name, fn) { fn(); count++; console.log('✓ ' + name); }

async function main() {
  async function boot(savedUrl, blockedStorage, bootOptions = {}) {
    const page = new JSDOM(fs.readFileSync(path.join(web, 'index.html'), 'utf8'), {
      url: 'http://localhost/', runScripts: 'outside-only'
    });
    const window = page.window;
    if (savedUrl) window.localStorage.setItem('gt.apiUrl', savedUrl);
    if (bootOptions.snapshot) window.localStorage.setItem('gt.dashboard.v1', JSON.stringify(bootOptions.snapshot));
    if (blockedStorage) Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } });
    const calls = [];
    let release;
    const responseGate = new Promise(resolve => { release = resolve; });
    window.lucide = { createIcons() {} };
    window.fetch = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      await responseGate;
      if (bootOptions.fail) throw new Error('Network unavailable');
      return { ok: true, json: async () => ({ ok: true, goals: { currency: 'toman' } }) };
    };
    const ctx = page.getInternalVMContext();
    vm.runInContext(fs.readFileSync(path.join(web, 'bodymap.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(path.join(web, 'app.js'), 'utf8'), ctx);
    // Isolate connection boot from chart rendering, which other tests cover.
    vm.runInContext('render = () => { document.getElementById("wk-log").textContent = S.data.goals.currency; };', ctx);
    await new Promise(resolve => window.setTimeout(resolve, 0));
    const initial = {
      history: window.document.getElementById('wk-log').textContent,
      status: window.document.getElementById('live-indicator').textContent
    };
    release();
    await new Promise(resolve => window.setTimeout(resolve, 0));
    const result = {
      calls,
      initial,
      modalHidden: window.document.getElementById('settings-modal').classList.contains('hidden'),
      status: window.document.getElementById('live-indicator').textContent,
      saved: blockedStorage ? null : window.localStorage.getItem('gt.apiUrl')
    };
    window.close();
    return result;
  }
  const freshBoot = await boot();
  test('fresh browser automatically connects and remembers the default endpoint', () => {
    assert.equal(freshBoot.calls[0].body.action, 'state');
    assert.equal(freshBoot.calls[0].url, run('DEFAULT_API_URL'));
    assert.equal(freshBoot.saved, freshBoot.calls[0].url);
    assert.equal(freshBoot.modalHidden, true);
    assert.equal(freshBoot.status, 'Connected');
  });
  const refreshed = await boot(freshBoot.saved);
  test('refresh reconnects to the remembered endpoint without opening Settings', () => {
    assert.equal(refreshed.calls[0].url, freshBoot.saved);
    assert.equal(refreshed.modalHidden, true);
    assert.equal(refreshed.status, 'Connected');
  });
  const custom = await boot('https://script.google.com/macros/s/custom/exec');
  test('user-saved endpoint overrides the site default', () => {
    assert.equal(custom.calls[0].url, 'https://script.google.com/macros/s/custom/exec');
  });
  const blocked = await boot(null, true);
  test('unavailable browser storage still permits automatic connection', () => {
    assert.equal(blocked.calls[0].url, run('DEFAULT_API_URL'));
    assert.equal(blocked.status, 'Connected');
    assert.equal(blocked.modalHidden, true);
  });
  const snapshot = {
    url: run('DEFAULT_API_URL'), key: '', savedAt: Date.now(),
    data: { goals: { currency: 'cached workout history' }, nutrition: {}, workouts: {}, expenses: {}, study: {}, tasks: [], classes: [], foods: [] }
  };
  const cached = await boot(null, false, { snapshot });
  test('refresh paints saved dashboard before a delayed network response', () => {
    assert.equal(cached.initial.history, 'cached workout history');
    assert.equal(cached.initial.status, 'Saved data');
    assert.equal(cached.status, 'Connected');
  });
  const wrongAccount = await boot(null, false, { snapshot: { ...snapshot, key: 'different-key' } });
  test('saved dashboard is not restored for different credentials', () => {
    assert.notEqual(wrongAccount.initial.history, 'cached workout history');
    assert.equal(wrongAccount.initial.status, 'Syncing…');
  });
  const offline = await boot(null, false, { snapshot, fail: true });
  test('failed background refresh keeps the saved dashboard visible', () => {
    assert.equal(offline.initial.history, 'cached workout history');
    assert.equal(offline.status, 'Saved data · offline');
  });
  const wrongBackend = await boot(null, false, { snapshot: { ...snapshot, url: 'https://other.example/exec' } });
  test('saved dashboard is not restored from another backend', () => {
    assert.notEqual(wrongBackend.initial.history, 'cached workout history');
  });
  // Let the real DOMContentLoaded handler wire all controls.
  await new Promise(resolve => w.setTimeout(resolve, 0));
  run(`S.data = {
    goals: { calories: 2000, protein: 140, carbs: 250, fat: 70, studyMinutes: 120, monthBudget: 30000000, currency: 'toman' },
    nutrition: { recent: [{ rowId: 2, date: '2026-10-07', food: 'Egg', qty: 2, unit: 'piece', calories: 144, protein: 12, carbs: 1, fat: 10 }] },
    workouts: { recent: [{ rowId: 2, date: '2026-10-07', name: 'Push day', exercises: 'bench press', durationMin: 30, muscles: ['chest', 'triceps'] }], muscleStatus: { shoulders: { level: 3, daysAgo: 1 } } },
    expenses: { byCategory: {} }, study: { week: {} }, classes: []
  }; S.workouts = S.data.workouts.recent.slice();`);
  test('food history edit opens the saved row', () => {
    run('renderFoodLog(S.data)');
    get('food-log').querySelector('[data-edit-sheet]').click();
    assert.equal(get('food-edit-food').value, 'Egg');
    assert.equal(get('food-edit-panel').classList.contains('hidden'), false);
  });
  test('workout edit retains muscles and exposes every group', () => {
    run('renderWorkoutLog(S.data)');
    get('wk-log').querySelector('[data-edit-sheet]').click();
    assert.equal(get('workout-edit-name').value, 'Push day');
    assert.equal(get('workout-edit-muscles').querySelectorAll('.on').length, 2);
    assert.equal(get('workout-edit-muscles').querySelectorAll('[data-mus]').length, 17);
    get('workout-edit-muscles').querySelector('[data-mus="biceps"]').click();
    assert.equal(run('S.workoutEditMuscles.has("biceps")'), true);
    assert.equal(run('S.muscles.has("biceps")'), false);
  });
  test('workout photo estimate updates the save selection', () => {
    run(`renderWkEstimate({ muscles: ['quads', 'glutes'], effort: [{ muscle: 'quads', level: 3 }, { muscle: 'glutes', level: 2 }] })`);
    assert.equal(run('S.muscles.has("quads") && S.muscles.has("glutes")'), true);
    assert.equal(get('wk-muscles').querySelectorAll('.on').length, 2);
  });
  test('zero-effort targeted muscles remain visible and selectable', () => {
    run(`renderWkEstimate({muscles:['quads','forearms'], effort:[{muscle:'quads',level:1},{muscle:'forearms',level:0}]})`);
    assert.equal(get('wk-estimated-box').querySelectorAll('.chip.hidden').length, 0);
    assert.match(get('wk-estimated-box').textContent, /Forearms/);
    assert.match(get('wk-estimated-box').textContent, /low or unscored/);
    assert.equal(run('S.muscles.has("forearms")'), true);
  });
  test('fencing fallback repairs empty or incomplete model targets', () => {
    run('applyDetectedWorkout({muscles:[]}, "fencing 20 minutes")');
    assert.equal(run('S.muscles.has("quads") && S.muscles.has("forearms") && S.muscles.has("obliques")'), true);
    run('applyDetectedWorkout({muscles:["quads"]}, "fencing")');
    assert.equal(run('S.muscles.has("biceps")'), true);
    assert.equal(run('activityMuscleTargets("ordinary unknown activity").length'), 0);
  });
  test('legacy shoulders become three deltoid regions', () => {
    run('normaliseWorkoutState(S.data); renderBodyMap(document.getElementById("bodymap"), S.data.workouts.muscleStatus)');
    assert.equal(run('Object.keys(S.data.workouts.muscleStatus).length'), 17);
    assert.equal(get('bodymap').querySelectorAll('[data-muscle="rear-delts"].bm-effort-3').length, 1);
    assert.equal(get('bodymap').querySelectorAll('svg').length, 2);
    assert.equal(/undefined|NaN/.test(get('bodymap').innerHTML), false);
  });
  test('every month renders complete Monday-based rows', () => {
    for (let month = 0; month < 12; month++) {
      run(`renderMonthGrid(new Date(2026, ${month}, 7), new Date(2026, ${month}, 15))`);
      const cells = get('cal-grid-body').querySelectorAll('[data-date]');
      assert.equal(cells.length % 7, 0);
      assert.ok(cells.length >= 28 && cells.length <= 42);
      assert.equal(new Date(cells[0].dataset.date + 'T12:00:00').getDay(), 1);
    }
  });
  test('month navigation from the 31st does not skip a month', () => {
    run('S.calendar.view = "month"; S.calendar.start = new Date(2026, 0, 31)');
    click('cal-next');
    assert.equal(run('S.calendar.start.getMonth()'), 1);
    assert.equal(run('S.calendar.start.getDate()'), 1);
  });
  test('week view names days correctly and spans seven days', () => {
    run('renderWeekList(new Date(2026, 9, 7), new Date(2026, 9, 7), null)');
    assert.equal(get('cal-list').querySelectorAll('[data-date]').length, 7);
    assert.match(get('cal-list').textContent, /Monday/);
  });
  test('class recurrence respects one-off, daily, and monthly dates', () => {
    run(`S.data.classes = [{rowId: 2, day: 'Wednesday', date: '2026-10-07', repeat: 'never'}]`);
    assert.equal(run('classesForDate(new Date(2026, 9, 7)).length'), 1);
    assert.equal(run('classesForDate(new Date(2026, 9, 14)).length'), 0);
    run('S.data.classes[0].repeat = "daily"');
    assert.equal(run('classesForDate(new Date(2026, 9, 8)).length'), 1);
    assert.equal(run('classesForDate(new Date(2026, 9, 6)).length'), 0);
    run('S.data.classes[0].repeat = "monthly"');
    assert.equal(run('classesForDate(new Date(2026, 10, 7)).length'), 1);
    assert.equal(run('classesForDate(new Date(2026, 10, 8)).length'), 0);
    run('S.data.classes = []');
  });
  test('class form opens and cancels without a missing element error', () => {
    click('cal-add');
    assert.equal(get('cal-add-sheet').classList.contains('hidden'), false);
    click('cl-add-cancel');
    assert.equal(get('cal-add-sheet').classList.contains('hidden'), true);
  });
  test('invalid stored tab falls back to Today', () => {
    run('switchTab("does-not-exist")');
    assert.equal(get('panel-today').classList.contains('hidden'), false);
  });
  test('goal refresh preserves edits to any individual field', () => {
    get('g-pro').value = '170'; get('g-pro').dataset.touched = '1';
    run('renderGoals(S.data)');
    assert.equal(get('g-pro').value, '170');
    assert.equal(get('g-cal').value, '2000');
  });
  run('load = async () => {}; S.url = "https://script.google.com/macros/s/test/exec"');
  get('food-edit-qty').value = '3';
  await run('saveFoodEdit()');
  assert.equal(requests.at(-1).action, 'edit.food');
  assert.equal(requests.at(-1).qty, 3);
  assert.equal(requests.at(-1).rowId, 2);
  count++; console.log('✓ food edit submits the saved row and changed quantity');
  await run('saveWorkoutEdit()');
  assert.equal(requests.at(-1).action, 'edit.workout');
  assert.deepEqual(requests.at(-1).muscles, ['chest', 'triceps', 'biceps']);
  count++; console.log('✓ workout edit submits its own muscle selection');
  await assert.rejects(run('S.url = "https://script.google.com/macros/s/test/exec"; fetch = async () => ({ok: true, json: async () => { throw new Error() }}); api("state")'), /did not return JSON/);
  count++; console.log('✓ non-JSON backend responses have an actionable error');


  test('assistant panel opens and undo histories exist in every panel', () => {
    run('switchTab("chat")');
    assert.equal(get('panel-chat').classList.contains('hidden'),false);
    for(const tab of ['today','food','body','money','study','tasks','more'])assert.ok(get('panel-'+tab).querySelector('[data-change-panel]'));
  });
  run('S.data.changes=[{id:"change-1",time:new Date().toISOString(),panel:"Nutrition",summary:"Logged <img src=x onerror=alert(1)>",undone:false}]; renderChanges()');
  test('history escapes stored content and offers panel undo', () => {
    const history=get('panel-food').querySelector('[data-change-panel]');
    assert.equal(history.querySelector('img'),null);
    assert.equal(history.querySelector('[data-undo-change]').dataset.undoChange,'change-1');
  });
  get('chat-input').value='My report';
  await run('sendChat()');
  test('chat requires the undo-capable backend before writing', () => {
    assert.match(get('chat-status').textContent,/redeploy Code.js/);
    assert.equal(get('chat-input').value,'My report');
  });
  run('S.data.capabilities={assistantUndo:true,assistantImages:true}');

  let resolveDetection; let detectionCalls=0;
  w.fetch=async()=>{detectionCalls++;return {ok:true,json:()=>new Promise(resolve=>{resolveDetection=resolve;})};};
  get('wk-input').value='fencing 20 minutes';
  const detecting=run('autoDetectWorkout()');
  await new Promise(resolve=>w.setTimeout(resolve,0));
  await run('autoDetectWorkout()');
  test('unchanged workout shares one request and displays loading beside input', () => {
    assert.equal(detectionCalls,1);assert.equal(get('wk-detect-status').dataset.state,'loading');
    assert.ok(get('wk-detect-status').querySelector('.ai-spinner'));
  });
  resolveDetection({ok:true,kind:'workout',muscles:['quads'],durationMin:20});await detecting;
  await run('autoDetectWorkout()');
  test('completed unsaved workout is not detected again', () => {
    assert.equal(detectionCalls,1);assert.equal(get('wk-detect-status').dataset.state,'ready');
    assert.equal(get('wk-detect-status').querySelector('.ai-spinner'),null);
  });
  w.fetch=async()=>{detectionCalls++;throw new Error('Model unavailable');};
  get('wk-input').value='new workout';await run('autoDetectWorkout()');await run('autoDetectWorkout()');
  test('failed detection stays failed without automatic repeated scans', () => {
    assert.equal(detectionCalls,2);assert.equal(get('wk-detect-status').dataset.state,'error');
    assert.match(get('wk-detect-status').textContent,/Model unavailable/);
  });
  await run('autoDetectWorkout(true)');
  test('explicit retry starts one new detection', () => {assert.equal(detectionCalls,3);});
  w.fetch=async()=>({ok:true,json:async()=>({ok:true,kind:'workout',muscles:[]})});
  get('wk-input').value='unknown exercise';await run('autoDetectWorkout()');
  test('empty detection has an explicit no-targets status', () => {assert.equal(get('wk-detect-status').dataset.state,'empty');});
  w.fetch=async()=>({ok:true,json:()=>new Promise(resolve=>{resolveDetection=resolve;})});
  get('wk-input').value='bench press';const stale=run('autoDetectWorkout()');
  await new Promise(resolve=>w.setTimeout(resolve,0));
  get('wk-input').value='squats';run('workoutInputChanged()');
  resolveDetection({ok:true,kind:'workout',muscles:['chest']});await stale;
  test('old response cannot overwrite status for newer workout text', () => {
    assert.equal(get('wk-detect-status').dataset.state,'queued');
    assert.doesNotMatch(get('wk-detect-status').textContent,/Chest/);
  });
  w.fetch=async()=>new Promise(()=>{});
  await assert.rejects(run('aiRequest("parse",{text:"test"},5)'),/timed out/);
  count++;console.log('✓ stalled AI request times out');
  w.fetch=async()=>({ok:true,json:async()=>({ok:true,recognised:false,muscles:[],effort:[]})});
  await run('estimateWorkoutMuscles()');
  test('photo with no targets remains visibly empty after completion', () => {
    assert.equal(get('wk-ai-status').dataset.state,'empty');assert.equal(get('wk-estimate').disabled,false);
  });

  const chatCalls=[];
  w.fetch=async (url,options)=>{chatCalls.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true,reply:'Saved your day',changes:['144 kcal food','45 min fencing'],failed:['Expense needs amount']})};};
  get('chat-input').value='I ate eggs and fenced';
  await run('sendChat()');
  test('chat sends text and renders saved changes and failures', () => {
    assert.equal(chatCalls[0].action,'chat');assert.equal(chatCalls[0].message,'I ate eggs and fenced');
    assert.match(get('chat-messages').textContent,/144 kcal/);assert.match(get('chat-messages').textContent,/Expense needs amount/);
    assert.equal(get('chat-input').value,'');assert.equal(get('chat-send').disabled,false);
  });
  test('chat photo accompanies text and clears after successful send', () => {
    run('CHAT.image="data:image/jpeg;base64,YWJj"');
  });
  await run('sendChat()');
  assert.equal(chatCalls.at(-1).image,'data:image/jpeg;base64,YWJj');assert.equal(run('CHAT.image'),null);
  w.fetch=async()=>{throw new Error('Network down');};get('chat-input').value='Keep this report';
  await run('sendChat()');
  test('failed chat retains draft and explains retry review', () => {
    assert.equal(get('chat-input').value,'Keep this report');assert.match(get('chat-status').textContent,/review history before retrying/);
  });
  class Recognition {
    start(){this.started=true;}stop(){this.stopped=true;}
  }
  w.SpeechRecognition=Recognition;
  run('startDictation(); CHAT.recognition.onresult({resultIndex:0,results:[Object.assign([{transcript:"fencing for 45 minutes"}],{isFinal:true})]}); stopDictation();');
  test('voice dictation appends transcript without automatically saving', () => {
    assert.match(get('chat-input').value,/fencing for 45 minutes/);
    assert.equal(run('CHAT.recording'),false);assert.equal(get('chat-mic').getAttribute('aria-pressed'),'false');
  });


  run('S.parsed=[makeItem("egg",1,"egg",{calories:72,protein:6,carbs:1,fat:5},1,"egg")];renderParsed()');
  const qty=get('parsed-box').querySelector('input[data-qty]');qty.focus();
  qty.value='12';qty.dispatchEvent(new w.Event('input',{bubbles:true}));
  qty.value='123';qty.dispatchEvent(new w.Event('input',{bubbles:true}));
  test('typing quantity keeps the same input and keyboard focus',()=>{
    assert.equal(w.document.activeElement,qty);assert.equal(get('parsed-box').querySelector('input[data-qty]'),qty);
    assert.equal(run('S.parsed[0].qty'),123);assert.equal(get('parsed-box').querySelector('input[data-mac="calories"]').value,'8856');
  });
  test('food editor visibly labels every quantity and macro field',()=>{
    const labels=Array.from(get('parsed-box').querySelectorAll('.food-value-label')).map(el=>el.textContent);
    assert.deepEqual(labels,['Amount (egg)','Calories (kcal)','Protein (g)','Carbs (g)','Fat (g)']);
  });
  run('renderRings({nutrition:{today:{calories:1500,protein:60,carbs:120,fat:40}},goals:{calories:2000,protein:140},workouts:{todayBurned:300,today:[]},expenses:{monthTotal:0,monthBudget:100,todayTotal:0}})');
  test('calorie balance shows food minus exercise and blue offset',()=>{
    assert.equal(get('center-cal').textContent,'800');assert.equal(get('bar-cal').style.width,'60%');
    assert.equal(get('bar-cal-burn').style.width,'15%');assert.equal(get('bar-cal-burn').style.left,'60%');
    assert.match(get('calorie-balance').textContent,/1,500 food − 300 exercise = 1,200 net/);
    assert.equal(get('ring-calorie-burn').style.opacity,'1');
  });
  run('renderRings({nutrition:{today:{calories:100,protein:0,carbs:0,fat:0}},goals:{calories:2000,protein:140},workouts:{todayBurned:300,today:[]},expenses:{monthTotal:0,monthBudget:100,todayTotal:0}})');
  test('exercise exceeding intake keeps valid ring and negative net',()=>{
    assert.equal(get('bar-cal').style.width,'0%');assert.equal(get('center-cal').textContent,'2,200');assert.match(get('calorie-balance').textContent,/-200 net/);
  });

  const events = {};
  const sw = { URL, Promise, self: { location: { origin: 'https://example.com' }, addEventListener: (type, fn) => events[type] = fn } };
  vm.runInNewContext(fs.readFileSync(path.join(web, 'sw.js'), 'utf8'), sw);
  test('service worker leaves backend and third-party requests alone', () => {
    for (const url of ['https://script.google.com/macros/s/test/exec', 'https://script.googleusercontent.com/test', 'https://cdn.example.com/lib.js']) {
      events.fetch({ request: { method: 'GET', url }, respondWith: () => assert.fail('external request was intercepted') });
    }
  });
  test('service worker intercepts same-origin assets without throwing', () => {
    let intercepted = false;
    sw.fetch = async () => ({ ok: false });
    events.fetch({ request: { method: 'GET', url: 'https://example.com/app.js' }, respondWith: () => intercepted = true });
    assert.equal(intercepted, true);
  });
  console.log(`\n${count} frontend/runtime regression checks passed`);
  dom.window.close();
}
main().catch(error => { console.error(error); dom.window.close(); process.exitCode = 1; });
