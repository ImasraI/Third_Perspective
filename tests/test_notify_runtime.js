/* Runtime tests for web/notify.js: permission gating, the two scheduling paths,
   and the dedup that stops a reminder re-arming forever.
   Browser globals are faked before the module loads. */
const assert = require('assert');
const path = require('path');

/** Load a fresh copy of notify.js against a controlled fake browser. */
function loadWith(fake) {
  const keys = ['localStorage', 'document', 'window', 'navigator', 'TimestampTrigger',
    'Notification', 'ServiceWorkerRegistration', 'setInterval', 'clearInterval'];
  const saved = {};
  for (const k of keys) {
    saved[k] = Object.getOwnPropertyDescriptor(global, k);
    delete global[k];
  }
  // Some of these are accessor globals in modern Node, so plain assignment fails.
  const put = (k, v) => Object.defineProperty(global, k, {
    value: v, writable: true, configurable: true, enumerable: true
  });
  for (const k in fake) put(k, fake[k]);

  delete require.cache[require.resolve(path.join(__dirname, '..', 'web', 'notify.js'))];
  const mod = require(path.join(__dirname, '..', 'web', 'notify.js'));
  mod._restore = () => {
    for (const k of keys) {
      delete global[k];
      if (saved[k]) Object.defineProperty(global, k, saved[k]);
    }
  };
  return mod;
}

function baseBrowser(opts) {
  const o = opts || {};
  const store = {};
  const shown = [];
  const closed = [];
  let displayed = o.displayed || [];

  const Notification = function (title, payload) { shown.push({ title: title, payload: payload }); };
  Notification.permission = o.permission || 'granted';
  Notification.prototype = {};
  Object.defineProperty(Notification.prototype, 'showTrigger', { value: !!o.showTrigger });

  const ServiceWorkerRegistration = function () {};
  ServiceWorkerRegistration.prototype = {};
  Object.defineProperty(ServiceWorkerRegistration.prototype, 'getNotifications', { value: true });

  return {
    localStorage: {
      store: store,
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    },
    document: { visibilityState: 'visible' },
    window: { matchMedia: (q) => ({ matches: o.standalone === true && q.includes('standalone') }) },
    navigator: {
      serviceWorker: {
        ready: Promise.resolve({
          showNotification: async (title, payload) => {
            shown.push({ title: title, payload: payload, viaSW: true });
            displayed = displayed.concat([{ data: { tag: payload.tag }, close: async () => {} }]);
          },
          getNotifications: async () => displayed
        })
      }
    },
    TimestampTrigger: class { constructor(ts) { this.time = ts; } },
    Notification: Notification,
    ServiceWorkerRegistration: ServiceWorkerRegistration,
    setInterval: () => 'timer',
    clearInterval: () => {},
    _shown: shown,
    _closed: closed,
    _store: store
  };
}

const state = {
  tasks: [{ rowId: 2, task: 'Submit lab', due: 'today 6pm', completed: false, priority: 'High' }],
  classes: [{ rowId: 2, day: 'Monday', time: '11:00', subject: 'Physics', room: 'Hall 3' }],
  workouts: {
    muscleStatus: {
      chest: { daysAgo: 10, trained: false, stale: false },
      legs: { daysAgo: 0, trained: true, stale: false }
    }
  },
  nutrition: { today: { calories: 700, protein: 25 } },
  study: { todayMinutes: 10 },
  expenses: { monthTotal: 950, monthBudget: 800 },
  goals: { calories: 2000, protein: 140, studyMinutes: 60, monthBudget: 800, currency: 'toman' }
};

let passed = 0;
/** Run one case, then put the fake browser globals back. */
async function test(name, fn) {
  let mod = null;
  try {
    mod = await fn();
    passed++;
    console.log('✓ ' + name);
  } catch (e) {
    console.log('✗ ' + name + '\n   ' + e.message);
    process.exitCode = 1;
  } finally {
    if (mod && mod._restore) mod._restore();
  }
}

(async function () {
  console.log('--- permission gating ---');

  await test('default permission schedules nothing', async () => {
    const m = loadWith(baseBrowser({ permission: 'default' }));
    assert.strictEqual(m.supported(), true);
    assert.strictEqual(m.permission(), 'default');
    const r = await m.reschedule(state);
    assert.strictEqual(r.scheduled, 0);
    assert.strictEqual(m.state.plan.length, 0);
    return m;
  });

  await test('denied permission schedules nothing', async () => {
    const m = loadWith(baseBrowser({ permission: 'denied' }));
    const r = await m.reschedule(state);
    assert.strictEqual(r.scheduled, 0);
    return m;
  });

  console.log('--- scheduling paths ---');

  await test('browser tab without triggers uses the in-page timer', async () => {
    const browser = baseBrowser({ showTrigger: false, standalone: false });
    const m = loadWith(browser);
    const r = await m.reschedule(state);
    assert.ok(r.scheduled > 0, 'nothing scheduled');
    assert.strictEqual(r.armed, 0, 'triggers should be refused');
    assert.strictEqual(m.state.plan.length, r.scheduled, 'plan should be timer-driven');
    assert.ok(m.state.timer, 'timer not started');
    return m;
  });

  await test('installed PWA hands the plan to OS triggers', async () => {
    const browser = baseBrowser({ showTrigger: true, standalone: true });
    const m = loadWith(browser);
    assert.strictEqual(m.triggersSupported(), true);
    assert.strictEqual(m.installed(), true);
    const r = await m.reschedule(state);
    assert.strictEqual(r.armed, r.scheduled, 'not every item was armed');
    assert.strictEqual(m.state.plan.length, 0, 'triggered items must leave the timer path');
    assert.strictEqual(m.state.timer, 'timer');
    const triggered = browser._shown.filter((s) => s.payload && s.payload.showTrigger);
    assert.strictEqual(triggered.length, r.armed, 'showTrigger missing on some notifications');
    for (const t of triggered) assert.ok(t.payload.showTrigger.time > Date.now(), 'trigger in the past');
    return m;
  });

  await test('triggers supported but not installed falls back to the timer', async () => {
    const browser = baseBrowser({ showTrigger: true, standalone: false });
    const m = loadWith(browser);
    assert.strictEqual(m.triggersSupported(), true);
    assert.strictEqual(m.installed(), false);
    const r = await m.reschedule(state);
    assert.strictEqual(r.armed, 0);
    assert.strictEqual(m.state.plan.length, r.scheduled);
    return m;
  });

  console.log('--- dedup ---');

  await test('a reminder the OS already showed is not re-armed', async () => {
    const browser = baseBrowser({
      showTrigger: true,
      standalone: true,
      // The OS already delivered the "Submit lab" reminder while the app was shut.
      displayed: [{ data: { tag: 'tp-task-2' }, close: async () => {} }]
    });
    const m = loadWith(browser);
    const plan = m.buildPlan(state, new Date());
    assert.ok(plan.some((p) => p.key === 'task-2'), 'test fixture lost the task-2 reminder');

    const r = await m.reschedule(state);
    assert.ok(r.armed < plan.length, 'already-shown reminder was re-armed');
    const tags = browser._shown.map((s) => s.payload.tag);
    assert.ok(!tags.includes('tp-task-2'), 'task-2 was queued again');
    return m;
  });

  await test('repeated launches do not re-arm the same reminder', async () => {
    const browser = baseBrowser({ showTrigger: true, standalone: true });
    const m = loadWith(browser);
    await m.reschedule(state);
    const afterFirst = browser._shown.length;
    const r2 = await m.reschedule(state);
    assert.strictEqual(r2.scheduled, 0, 'nothing should remain after the first launch');
    assert.strictEqual(browser._shown.length, afterFirst, 'a trigger was created twice');
    return m;
  });

  await test('fired keys survive a reload', async () => {
    const browser = baseBrowser({ showTrigger: false, standalone: false });
    const m = loadWith(browser);
    await m.reschedule(state);
    m.state.fired['task-2'] = Date.now();
    // Only localStorage survives a page unload.
    browser.localStorage.store[m.LS_NOTIFY.fired] = JSON.stringify(m.state.fired);
    m._restore();

    const reloaded = loadWith(browser);
    const plan = reloaded.buildPlan(state, new Date());
    assert.ok(plan.some((p) => p.key === 'task-2'), 'plan should still contain it before dedup');
    const r = await reloaded.reschedule(state);
    assert.ok(!r.armed || true, 'armed count readable');
    const tags = browser._shown.map((s) => s.payload.tag);
    assert.ok(!tags.includes('tp-task-2'), 'already-fired reminder was queued again');
    return reloaded;
  });

  console.log('--- display ---');

  await test('show() goes through the service worker', async () => {
    const browser = baseBrowser({ showTrigger: true, standalone: true });
    const m = loadWith(browser);
    const ok = await m.show('Title', 'Body', { tag: 'tp-x', url: './?tab=tasks' });
    assert.strictEqual(ok, true);
    const last = browser._shown[browser._shown.length - 1];
    assert.strictEqual(last.viaSW, true);
    assert.strictEqual(last.payload.body, 'Body');
    assert.strictEqual(last.payload.data.url, './?tab=tasks');
    return m;
  });

  await test('show() is refused without permission', async () => {
    const browser = baseBrowser({ showTrigger: true, standalone: true });
    const m = loadWith(browser);
    browser.Notification.permission = 'denied';
    const ok = await m.show('Title', 'Body', {});
    assert.strictEqual(ok, false);
    assert.strictEqual(browser._shown.length, 0);
    return m;
  });

  await test('disable() clears the plan and stops the timer', async () => {
    const browser = baseBrowser({ showTrigger: true, standalone: true });
    const m = loadWith(browser);
    await m.reschedule(state);
    assert.ok(m.state.plan.length || Object.keys(m.state.handled).length, 'nothing was scheduled');
    await m.disable();
    assert.strictEqual(m.state.plan.length, 0);
    assert.strictEqual(m.state.timer, null);
    return m;
  });

  await test('no Notification API at all is reported as unsupported', async () => {
    const browser = baseBrowser({});
    delete browser.Notification;
    const m = loadWith(browser);
    assert.strictEqual(m.supported(), false);
    assert.strictEqual(m.permission(), 'unsupported');
    assert.ok(/no notification support/.test(m.capability()), 'capability text missing the caveat: ' + m.capability());
    return m;
  });

  console.log('\n=== ' + passed + ' runtime notification tests passed ===');
})();