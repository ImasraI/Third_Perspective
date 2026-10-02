/* Tests for the notification scheduler (web/notify.js).
   Everything here is pure date/planning logic, so no browser APIs are needed. */
const assert = require('assert');
const N = require('../web/notify.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('✓ ' + name); }
  catch (e) { console.log('✗ ' + name + '\n   ' + e.message); process.exitCode = 1; }
}

const now = new Date(2026, 9, 5, 10, 0, 0); // Mon 5 Oct 2026, 10:00 local

console.log('--- parseClock ---');

test('parses 5pm as 17:00', () => {
  assert.deepStrictEqual(N.parseClock('5pm'), { hours: 17, minutes: 0 });
});
test('parses "5 pm" with space', () => {
  assert.deepStrictEqual(N.parseClock('5 pm'), { hours: 17, minutes: 0 });
});
test('parses 5:30pm', () => {
  assert.deepStrictEqual(N.parseClock('5:30pm'), { hours: 17, minutes: 30 });
});
test('parses 17:00 24h', () => {
  assert.deepStrictEqual(N.parseClock('17:00'), { hours: 17, minutes: 0 });
});
test('parses 9am as 09:00 (not 21:00)', () => {
  assert.deepStrictEqual(N.parseClock('9am'), { hours: 9, minutes: 0 });
});
test('parses 12am as midnight', () => {
  assert.deepStrictEqual(N.parseClock('12am'), { hours: 0, minutes: 0 });
});
test('parses noon and midnight words', () => {
  assert.deepStrictEqual(N.parseClock('noon'), { hours: 12, minutes: 0 });
  assert.deepStrictEqual(N.parseClock('midnight'), { hours: 0, minutes: 0 });
});
test('returns null with no digits', () => {
  assert.strictEqual(N.parseClock('sometime'), null);
});
test('rejects out-of-range hour', () => {
  assert.strictEqual(N.parseClock('99pm'), null);
});

console.log('--- parseWhen: keywords ---');

test('"today 5pm" lands today 17:00', () => {
  const d = N.parseWhen('today 5pm', now);
  assert.strictEqual(d.getDate(), 5);
  assert.strictEqual(d.getHours(), 17);
});
test('"tonight" is 20:00 today', () => {
  const d = N.parseWhen('tonight', now);
  assert.strictEqual(d.getDate(), 5);
  assert.strictEqual(d.getHours(), 20);
});
test('"tomorrow 9am" is next day 09:00', () => {
  const d = N.parseWhen('tomorrow 9am', now);
  assert.strictEqual(d.getDate(), 6);
  assert.strictEqual(d.getHours(), 9);
});
test('"tomorrow morning" is 09:00', () => {
  assert.strictEqual(N.parseWhen('tomorrow morning', now).getHours(), 9);
});
test('weekday resolves to next occurrence', () => {
  const d = N.parseWhen('friday 5pm', now); // now is Monday
  assert.strictEqual(d.getDay(), 5);
  assert.strictEqual(d.getDate(), 9);
});
test('weekday said on that same day means next week', () => {
  const monday = new Date(2026, 9, 5, 9, 0);
  const d = N.parseWhen('monday 9am', monday);
  assert.strictEqual(d.getDate(), 12);
});
test('short weekday names work', () => {
  assert.strictEqual(N.parseWhen('wed 10am', now).getDay(), 3);
});
test('"oct 12 5pm" resolves this year', () => {
  const d = N.parseWhen('oct 12 5pm', now);
  assert.strictEqual(d.getMonth(), 9);
  assert.strictEqual(d.getDate(), 12);
  assert.strictEqual(d.getHours(), 17);
});
test('"12 oct" day-first form works', () => {
  assert.strictEqual(N.parseWhen('12 oct', now).getDate(), 12);
});
test('month already past rolls to next year', () => {
  const d = N.parseWhen('jan 5', now);
  assert.strictEqual(d.getFullYear(), 2027);
});
test('bare ISO date defaults to 20:00', () => {
  const d = N.parseWhen('2026-10-09', now);
  assert.strictEqual(d.getDate(), 9);
  assert.strictEqual(d.getHours(), 20);
});
test('ISO datetime keeps the clock', () => {
  const d = N.parseWhen('2026-10-09 14:30', now);
  assert.strictEqual(d.getHours(), 14);
  assert.strictEqual(d.getMinutes(), 30);
});
test('"in 30 minutes" is relative', () => {
  assert.strictEqual(N.parseWhen('in 30 minutes', now).getTime(), now.getTime() + 30 * 60000);
});
test('"in 2 hours" is relative', () => {
  assert.strictEqual(N.parseWhen('in 2 hours', now).getTime(), now.getTime() + 2 * 3600000);
});
test('"in 3 days" is relative', () => {
  assert.strictEqual(N.parseWhen('in 3 days', now).getTime(), now.getTime() + 3 * 86400000);
});
test('time-only later today stays today', () => {
  const d = N.parseWhen('5pm', now);
  assert.strictEqual(d.getDate(), 5);
});
test('time-only already past rolls to tomorrow', () => {
  const d = N.parseWhen('8am', now);
  assert.strictEqual(d.getDate(), 6);
});
test('unparseable text returns null', () => {
  assert.strictEqual(N.parseWhen('sometime soon', now), null);
});
test('empty / dash / null returns null', () => {
  assert.strictEqual(N.parseWhen('', now), null);
  assert.strictEqual(N.parseWhen('-', now), null);
  assert.strictEqual(N.parseWhen(null, now), null);
  assert.strictEqual(N.parseWhen(undefined, now), null);
});

console.log('--- untilNextWeekly ---');

test('next Monday 09:00 from a Monday 10:00', () => {
  const d = N.untilNextWeekly('Monday', '09:00', now);
  assert.strictEqual(d.getDay(), 1);
  assert.strictEqual(d.getDate(), 12);
  assert.strictEqual(d.getHours(), 9);
});
test('time still ahead today stays today', () => {
  const d = N.untilNextWeekly('Monday', '18:00', now);
  assert.strictEqual(d.getDate(), 5);
  assert.strictEqual(d.getHours(), 18);
});
test('defaults to 09:00 with no time', () => {
  assert.strictEqual(N.untilNextWeekly('Friday', '', now).getHours(), 9);
});
test('unknown day returns null', () => {
  assert.strictEqual(N.untilNextWeekly('Blursday', '09:00', now), null);
});

console.log('--- respectQuietHours ---');

test('23:00 is pushed to 08:00 next day', () => {
  const when = new Date(2026, 9, 5, 23, 0);
  const d = N.respectQuietHours(when, now);
  assert.strictEqual(d.getDate(), 6);
  assert.strictEqual(d.getHours(), 8);
});
test('03:00 is pushed to 08:00 same day', () => {
  const when = new Date(2026, 9, 7, 3, 0);
  const d = N.respectQuietHours(when, now);
  assert.strictEqual(d.getDate(), 7);
  assert.strictEqual(d.getHours(), 8);
});
test('12:00 is left alone', () => {
  const when = new Date(2026, 9, 7, 12, 0);
  assert.strictEqual(N.respectQuietHours(when, now).getTime(), when.getTime());
});
test('already-past times are not moved', () => {
  const when = new Date(2026, 9, 5, 3, 0);
  assert.strictEqual(N.respectQuietHours(when, now).getTime(), when.getTime());
});

console.log('--- buildPlan ---');

const baseState = {
  tasks: [
    { rowId: 2, task: 'Submit lab', due: 'friday 5pm', completed: false, priority: 'High' },
    { rowId: 3, task: 'Buy groceries', due: 'tomorrow 9am', completed: false, priority: 'Normal' },
    { rowId: 4, task: 'Done thing', due: 'today 5pm', completed: 'yes', priority: 'Normal' },
    { rowId: 5, task: 'No due date', due: '', completed: false, priority: 'Normal' }
  ],
  classes: [{ rowId: 2, day: 'Wednesday', time: '10:00', subject: 'Physics', room: 'Hall 3' }],
  workouts: {
    muscleStatus: {
      chest: { daysAgo: 9, trained: false, stale: false },
      legs: { daysAgo: 0, trained: true, stale: false },
      arms: { daysAgo: null, trained: false, stale: false }
    }
  },
  nutrition: { today: { calories: 800, protein: 30, carbs: 90, fat: 20 } },
  study: { todayMinutes: 20 },
  expenses: { monthTotal: 900, monthBudget: 800 },
  goals: { calories: 2000, protein: 140, studyMinutes: 120, monthBudget: 800, currency: 'toman' }
};

test('null state yields an empty plan', () => {
  assert.deepStrictEqual(N.buildPlan(null, now), []);
});

test('completed tasks are never scheduled', () => {
  const plan = N.buildPlan(baseState, now);
  assert.ok(!plan.some((p) => p.key === 'task-4'), 'completed task was scheduled');
});
test('tasks with no due date are skipped', () => {
  const plan = N.buildPlan(baseState, now);
  assert.ok(!plan.some((p) => p.key === 'task-5'), 'undated task was scheduled');
});
test('High priority task gets a 24h heads-up', () => {
  const plan = N.buildPlan(baseState, now);
  const lead = plan.find((p) => p.key === 'task-lead-2');
  assert.ok(lead, 'no lead reminder');
  assert.strictEqual(lead.priority, 'high');
  const due = plan.find((p) => p.key === 'task-2');
  assert.strictEqual(lead.at.getTime() + 24 * 3600000, due.at.getTime());
});
test('Normal priority task gets no heads-up', () => {
  const plan = N.buildPlan(baseState, now);
  assert.ok(!plan.some((p) => p.key === 'task-lead-3'), 'unexpected lead for normal task');
});
test('class reminder fires 15 min before', () => {
  const plan = N.buildPlan(baseState, now);
  const c = plan.find((p) => p.key === 'class-2');
  assert.ok(c, 'class not scheduled');
  const at = N.untilNextWeekly('Wednesday', '10:00', now);
  assert.strictEqual(c.at.getTime(), at.getTime() - 15 * 60000);
});
test('overdue muscles are reported', () => {
  const plan = N.buildPlan(baseState, now);
  const m = plan.find((p) => p.key.startsWith('muscles-'));
  assert.ok(m, 'no muscle reminder');
  assert.ok(/1 overdue/.test(m.body), 'overdue count missing: ' + m.body);
  assert.strictEqual(m.priority, 'high');
});
test('muscle trained today is not counted', () => {
  const plan = N.buildPlan(baseState, now);
  const m = plan.find((p) => p.key.startsWith('muscles-'));
  assert.ok(!/legs/.test(m.body), 'legs trained today should be excluded');
});
test('never-trained muscle is not counted as overdue', () => {
  const plan = N.buildPlan(baseState, now);
  const m = plan.find((p) => p.key.startsWith('muscles-'));
  assert.ok(!/arms/.test(m.body), 'never-trained arms should not be overdue');
});
test('nutrition gap is reported at 20:00', () => {
  const plan = N.buildPlan(baseState, now);
  const n = plan.find((p) => p.key.startsWith('nutrition-'));
  assert.ok(n, 'no nutrition reminder');
  assert.strictEqual(n.at.getHours(), 20);
  assert.ok(/kcal short/.test(n.body), 'kcal gap missing: ' + n.body);
  assert.ok(/protein short/.test(n.body), 'protein gap missing: ' + n.body);
});
test('met nutrition goals raise nothing', () => {
  const s = JSON.parse(JSON.stringify(baseState));
  s.nutrition.today = { calories: 2000, protein: 140, carbs: 200, fat: 70 };
  const plan = N.buildPlan(s, now);
  assert.ok(!plan.some((p) => p.key.startsWith('nutrition-')));
});
test('study shortfall is reported', () => {
  const plan = N.buildPlan(baseState, now);
  const s = plan.find((p) => p.key.startsWith('study-'));
  assert.ok(s, 'no study reminder');
  assert.ok(/20 \/ 120 min/.test(s.body), 'unexpected body: ' + s.body);
});
test('budget overrun is reported as high priority', () => {
  const plan = N.buildPlan(baseState, now);
  const b = plan.find((p) => p.key.startsWith('budget-'));
  assert.ok(b, 'no budget reminder');
  assert.strictEqual(b.priority, 'high');
  assert.ok(/900 of 800/.test(b.body), 'unexpected body: ' + b.body);
});
test('under budget raises nothing', () => {
  const s = JSON.parse(JSON.stringify(baseState));
  s.expenses.monthTotal = 100;
  assert.ok(!N.buildPlan(s, now).some((p) => p.key.startsWith('budget-')));
});
test('overdue tasks get a nudge shortly after load', () => {
  const s = JSON.parse(JSON.stringify(baseState));
  s.tasks.push({ rowId: 6, task: 'Old thing', due: 'today 8am', completed: false, priority: 'Normal' });
  const plan = N.buildPlan(s, now);
  const o = plan.find((p) => p.key.startsWith('task-overdue-'));
  assert.ok(o, 'no overdue nudge');
  // Anchored to now, so it still fires when the app is opened late in the day.
  assert.strictEqual(o.at.getTime(), now.getTime() + 5 * 60000);
  assert.strictEqual(o.priority, 'high');
  assert.ok(/Old thing/.test(o.body), 'unexpected body: ' + o.body);
});
test('a task due later today is not counted as overdue', () => {
  const s = JSON.parse(JSON.stringify(baseState));
  s.tasks.push({ rowId: 7, task: 'Later', due: 'today 6pm', completed: false, priority: 'Normal' });
  assert.ok(!N.buildPlan(s, now).some((p) => p.key.startsWith('task-overdue-')));
});
test('plan is sorted by time', () => {
  const plan = N.buildPlan(baseState, now);
  for (let i = 1; i < plan.length; i++) {
    assert.ok(plan[i - 1].at.getTime() <= plan[i].at.getTime(), 'plan not sorted at ' + i);
  }
});
test('nothing in the past is scheduled', () => {
  const plan = N.buildPlan(baseState, now);
  for (const p of plan) assert.ok(p.at.getTime() > now.getTime(), p.key + ' is in the past');
});
test('every entry carries a unique key and tag', () => {
  const plan = N.buildPlan(baseState, now);
  const keys = plan.map((p) => p.key);
  assert.strictEqual(new Set(keys).size, keys.length, 'duplicate keys');
  for (const p of plan) assert.strictEqual(p.tag, 'tp-' + p.key);
});
test('plan stays inside quiet hours', () => {
  const s = JSON.parse(JSON.stringify(baseState));
  s.tasks.push({ rowId: 7, task: 'Late', due: 'today 11pm', completed: false, priority: 'Normal' });
  for (const p of N.buildPlan(s, now)) {
    const h = p.at.getHours();
    assert.ok(h >= 8 && h < 22, p.key + ' fires at ' + h + ':00, inside quiet hours');
  }
});
test('an empty tracker produces no reminders', () => {
  const plan = N.buildPlan({
    tasks: [], classes: [], goals: {},
    nutrition: { today: { calories: 0, protein: 0 } },
    study: { todayMinutes: 0 }, expenses: {}, workouts: { muscleStatus: {} }
  }, now);
  assert.deepStrictEqual(plan, []);
});

console.log('\n=== ' + passed + ' notification tests passed ===');