/* ============================================================================
   ThirdPerspective - notifications
   ----------------------------------------------------------------------------
   A static PWA has no server to push from, so reminders are driven from two
   cooperating mechanisms:

     1. Notification Triggers (Chrome, installed PWA). TimestampTrigger lets the
        OS fire the notification even when the app is closed. This is the only
        mechanism that works with the app shut.
     2. An in-page timer. Covers every other browser, but only while the page is
        open (including backgrounded tabs, which browsers keep running).

   The plan is recomputed from app state on every load/refresh, so editing a task
   or a goal reschedules everything. Every alert carries a stable `key`, and a
   fired/already-queued key is remembered in localStorage so the same reminder
   never nags twice.
   ========================================================================== */

const LS_NOTIFY = {
  on: 'tp.notify.on',
  fired: 'tp.notify.fired',
  quiet: 'tp.notify.quiet',
  daily: 'tp.notify.daily'
};

/* Quiet hours: notifications raised in here are held back to 08:00 local. */
const QUIET_START = 22; // 22:00
const QUIET_END = 8;     // 08:00
const DAILY_SUMMARY_HOUR = 20; // end-of-day target review

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/* ============================================================================
   Pure helpers (no DOM, no Notification API) — exported for tests
   ========================================================================== */

const WEEKDAYS = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6
};

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11
};

function pad(n) { return String(n).padStart(2, '0'); }

/** Local-midnight Date `offset` days from `base`. */
function startOfDay(base, offset) {
  const d = new Date(base.getTime());
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + (offset || 0));
  return d;
}

/** Combine a calendar day with a wall-clock time, allowing overflow to +1 day. */
function atTime(day, hours, minutes) {
  const d = startOfDay(day, 0);
  d.setHours(hours, minutes || 0, 0, 0);
  return d;
}

/** Minutes past local midnight for a Date. */
function minutesOfDay(d) { return d.getHours() * 60 + d.getMinutes(); }

/**
 * Read a wall-clock time out of free text.
 * Accepts 5pm, 5 pm, 5:30pm, 17:00, noon, midnight. Returns null if absent.
 */
function parseClock(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();

  if (/\bmidnight\b/.test(t)) return { hours: 0, minutes: 0 };
  if (/\bnoon\b/.test(t)) return { hours: 12, minutes: 0 };

  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!m) return null;

  let hours = parseInt(m[1], 10);
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3];

  if (meridiem === 'pm' && hours < 12) hours += 12;
  else if (meridiem === 'am' && hours === 12) hours = 0;
  else if (!meridiem && !m[2]) {
    // A bare hour in a due string reads as afternoon, not as military time:
    // "due 5" means 17:00, while "17:00" and "9am" stay untouched.
    if (hours >= 1 && hours <= 7) hours += 12;
  }

  if (hours > 23 || minutes > 59) return null;
  return { hours: hours, minutes: minutes };
}

/**
 * Turn a free-text due value into a Date.
 * Handles: ISO date-times, "today"/"tonight"/"tomorrow", weekday names,
 * "oct 5", "5 oct", "in 20 minutes", "in 2 hours", "in 3 days", and any of
 * those combined with a clock time. Returns null when nothing is parseable.
 *
 * `now` is injectable so tests are deterministic.
 */
function parseWhen(text, now) {
  if (text === null || text === undefined) return null;
  if (text instanceof Date) return Number.isNaN(text.getTime()) ? null : text;

  if (typeof text === 'number' && Number.isFinite(text)) return new Date(text);

  const raw = String(text).trim().toLowerCase();
  if (!raw || raw === '-' || raw === 'none' || raw === 'anytime') return null;

  const base = now instanceof Date ? now : new Date();
  if (Number.isNaN(base.getTime())) return null;

  // in N minutes / hours / days
  const rel = raw.match(/\bin\s+(\d+)\s*(minute|min|hour|hr|day)s?\b/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2];
    if (unit.startsWith('min')) return new Date(base.getTime() + n * MINUTE);
    if (unit.startsWith('h')) return new Date(base.getTime() + n * 60 * MINUTE);
    return new Date(base.getTime() + n * DAY);
  }

  // Whatever date fragment gets consumed is removed before reading the clock,
  // otherwise "oct 12 5pm" parses the clock as 12 and "2026-10-09" as 10:00.
  let rest = raw;
  let day = null;

  const eat = (m) => { if (m) rest = rest.replace(m[0], ' '); };

  // Explicit ISO-ish timestamp: 2026-10-05 14:30 / 2026-10-05T14:30
  const iso = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[t ](\d{1,2}):(\d{2}))?/);
  if (iso) {
    eat(iso);
    const d = new Date(base.getTime());
    d.setFullYear(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10));
    d.setHours(0, 0, 0, 0);
    if (iso[4] !== undefined) {
      d.setHours(parseInt(iso[4], 10), parseInt(iso[5], 10), 0, 0);
      return d;
    }
    day = d;
  }

  if (!day) {
    // "tomorrow morning" must be tried before the bare "tomorrow".
    const relDay = raw.match(/\b(today|tonight|tomorrow morning|tomorrow afternoon|tonight|tomorrow|tmrw|yesterday)\b/);
    if (relDay) {
      eat(relDay);
      const word = relDay[1];
      const offset = word === 'yesterday' ? -1
        : (word.indexOf('tomorrow') === 0 || word === 'tmrw' ? 1 : 0);
      day = startOfDay(base, offset);
      if (word === 'tonight') return atTime(day, 20, 0);
      if (word === 'tomorrow morning') return atTime(day, 9, 0);
      if (word === 'tomorrow afternoon') return atTime(day, 14, 0);
    }
  }

  if (!day) {
    // weekday name -> next occurrence
    const wd = raw.match(/\b(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/);
    if (wd) {
      eat(wd);
      const current = base.getDay();
      let ahead = (WEEKDAYS[wd[1]] - current + 7) % 7;
      if (ahead === 0) ahead = 7; // "monday" said on a Monday means next Monday
      day = startOfDay(base, ahead);
    }
  }

  if (!day) {
    // "oct 12" (month first) or "12 oct" (day first)
    const mdFirst = rest.match(/\b([a-z]{3,9})\.?\s+(\d{1,2})\b/);
    const dayFirst = rest.match(/\b(\d{1,2})\s+([a-z]{3,9})\b/);
    const monthOf = (name) => MONTHS[String(name).replace(/\.$/, '')];
    let mo = null, da = null;
    // January is month 0, so presence must be tested with `!== undefined`
    // rather than truthiness.
    if (mdFirst && monthOf(mdFirst[1]) !== undefined) {
      mo = monthOf(mdFirst[1]);
      da = parseInt(mdFirst[2], 10);
      eat(mdFirst);
    } else if (dayFirst && monthOf(dayFirst[2]) !== undefined) {
      mo = monthOf(dayFirst[2]);
      da = parseInt(dayFirst[1], 10);
      eat(dayFirst);
    }
    if (mo !== null && da >= 1 && da <= 31) {
      day = new Date(base.getFullYear(), mo, da, 0, 0, 0, 0);
      if (day.getTime() < startOfDay(base, 0).getTime()) {
        day = new Date(base.getFullYear() + 1, mo, da, 0, 0, 0, 0);
      }
    }
  }

  const clock = parseClock(rest);
  if (day) {
    if (clock) return atTime(day, clock.hours, clock.minutes);
    // No time given: a bare date means late afternoon, so "due oct 5" alerts
    // that evening rather than at midnight.
    return atTime(day, 20, 0);
  }

  // Time only, no date -> today if still ahead, otherwise tomorrow.
  if (clock) {
    const todayAt = atTime(base, clock.hours, clock.minutes);
    if (todayAt.getTime() >= base.getTime()) return todayAt;
    return new Date(todayAt.getTime() + DAY);
  }

  return null;
}

/** Minutes from now until a weekday/time pair recurs next. Returns null if unparseable. */
function untilNextWeekly(dayName, timeText, now) {
  const base = now instanceof Date ? now : new Date();
  if (!dayName) return null;
  const key = String(dayName).trim().toLowerCase();
  if (!(key in WEEKDAYS)) return null;

  const clock = parseClock(timeText) || { hours: 9, minutes: 0 };
  const target = WEEKDAYS[key];
  let ahead = (target - base.getDay() + 7) % 7;
  let when = atTime(startOfDay(base, ahead), clock.hours, clock.minutes);
  if (when.getTime() <= base.getTime()) {
    when = new Date(when.getTime() + 7 * DAY);
  }
  return when;
}

/** Move `when` past quiet hours so nothing wakes the user at 3am. */
function respectQuietHours(when, now) {
  const base = now instanceof Date ? now : new Date();
  if (!(when instanceof Date) || Number.isNaN(when.getTime())) return null;
  if (when.getTime() <= base.getTime()) return when;

  const mins = minutesOfDay(when);
  if (mins >= QUIET_START * 60) {
    // lands in the evening quiet window -> push to 08:00 the next morning
    return atTime(startOfDay(when, 1), QUIET_END, 0);
  }
  if (mins < QUIET_END * 60) {
    return atTime(startOfDay(when, 0), QUIET_END, 0);
  }
  return when;
}

/**
 * Build the full set of reminders for the current app state.
 * Returns [{ key, at, title, body, tag, url, priority }], sorted by time.
 * Pure: takes `now` so it is testable, and touches no browser APIs.
 */
function buildPlan(state, now, opts) {
  const base = now instanceof Date ? now : new Date();
  const options = opts || {};
  const leadMs = (options.classLeadMin || 15) * MINUTE;
  const out = [];
  if (!state) return out;

  /* Class reminders can be narrowed to the blocks the user ticked in the
     calendar. `marked` accepts an array or a Set of rowIds; nothing is filtered
     until `onlyMarked` is set, so callers that never pass it keep every class. */
  const markedClasses = options.marked instanceof Set
    ? options.marked
    : new Set((options.marked || []).map(Number));
  const onlyMarked = !!options.onlyMarked;

  const add = (key, at, title, body, extra) => {
    if (!(at instanceof Date) || Number.isNaN(at.getTime())) return;
    const when = respectQuietHours(at, base);
    if (!when || when.getTime() <= base.getTime()) return;
    out.push(Object.assign({
      key: key,
      at: when,
      title: title,
      body: body,
      tag: 'tp-' + key,
      url: './?tab=tasks'
    }, extra || {}));
  };

  /* --- Tasks: fires at the due moment, plus a day-before heads-up for High. */
  const tasks = (state.tasks || []).filter((t) => !t.completed);
  for (const t of tasks) {
    const when = parseWhen(t.due, base);
    if (!when) continue;
    const label = String(t.task || 'Task');
    const hi = String(t.priority || '').toLowerCase() === 'high';

    if (hi) {
      const lead = new Date(when.getTime() - 24 * 60 * MINUTE);
      if (lead.getTime() > base.getTime()) {
        add('task-lead-' + t.rowId, lead, 'Due tomorrow · ' + label,
          'High priority — due ' + describeDue(t.due),
          { url: './?tab=tasks', priority: 'high' });
      }
    }
    add('task-' + t.rowId, when, hi ? 'High priority · ' + label : 'Task due',
      label + ' — due ' + describeDue(t.due),
      { url: './?tab=tasks', priority: hi ? 'high' : 'normal' });
  }

  /* --- Classes: weekly recurrence, N minutes before the bell. */
  for (const c of state.classes || []) {
    if (onlyMarked && !markedClasses.has(Number(c.rowId))) continue;
    let when;
    if (c.repeat && c.repeat !== 'weekly') {
      const clock = parseClock(c.time);
      if (clock == null) continue;
      for (let offset = 0; offset < 63; offset++) {
        const candidate = new Date(base);
        candidate.setDate(candidate.getDate() + offset);
        candidate.setHours(clock.hours, clock.minutes, 0, 0);
        const bucket = candidate.getFullYear() + '-' + String(candidate.getMonth() + 1).padStart(2, '0') + '-' + String(candidate.getDate()).padStart(2, '0');
        if (c.date && bucket < c.date) continue;
        const matches = c.repeat === 'daily' || (c.repeat === 'never' && bucket === c.date) ||
          (c.repeat === 'monthly' && c.date && candidate.getDate() === Number(c.date.slice(8, 10)));
        if (matches && candidate.getTime() - leadMs > base.getTime()) { when = candidate; break; }
      }
    } else {
      when = untilNextWeekly(c.day, c.time, base);
    }
    if (!when) continue;
    const at = new Date(when.getTime() - leadMs);
    if (at.getTime() <= base.getTime()) continue;
    add('class-' + c.rowId, at, 'Class in ' + (options.classLeadMin || 15) + ' min',
      [c.subject, c.time, c.room].filter(Boolean).join(' · '),
      { url: './?tab=more', priority: 'normal' });
  }

  /* --- Muscle recovery: the day is late and something needs training. */
  const status = (state.workouts && state.workouts.muscleStatus) || {};
  const dueNow = [];
  const overdue = [];
  for (const name in status) {
    const m = status[name];
    if (!m || m.daysAgo === null || m.daysAgo === undefined) continue;
    if (m.daysAgo === 0) continue;
    if (m.daysAgo <= 6) dueNow.push(name);
    else overdue.push(name);
  }
  if (overdue.length || dueNow.length) {
    const parts = [];
    if (overdue.length) parts.push(overdue.length + ' overdue');
    if (dueNow.length) parts.push(dueNow.length + ' due for a hit');
    const when = atTime(base, DAILY_SUMMARY_HOUR, 0);
    add('muscles-' + startOfDay(base, 0).getTime(), when,
      'Muscle recovery',
      parts.join(' · ') + '. Log a workout to reset the clock.',
      { url: './?tab=body', priority: overdue.length ? 'high' : 'normal' });
  }

  /* --- End-of-day goal review: nutrition + study. */
  const goals = state.goals || {};
  const kcalGoal = Number(goals.calories) || 0;
  const proGoal = Number(goals.protein) || 0;
  const today = state.nutrition && state.nutrition.today;

  // Never nag about a target the user has not actually set.
  if (today && (kcalGoal > 0 || proGoal > 0)) {
    const eatenCalories = Number(today.calories) || 0;
    const eatenProtein = Number(today.protein) || 0;

    const gaps = [];
    if (eatenCalories === 0 && eatenProtein === 0) gaps.push('nothing logged today');
    if (kcalGoal > 0 && kcalGoal - eatenCalories > 150) {
      gaps.push(Math.round(kcalGoal - eatenCalories) + ' kcal short');
    }
    if (proGoal > 0 && proGoal - eatenProtein > 15) {
      gaps.push(Math.round(proGoal - eatenProtein) + ' g protein short');
    }

    if (gaps.length) {
      add('nutrition-' + startOfDay(base, 0).getTime(), atTime(base, DAILY_SUMMARY_HOUR, 0),
        'Nutrition check-in',
        gaps.join(' · ') + '. Log a meal or adjust the goal.',
        { url: './?tab=food' });
    }
  }

  /* --- Study target. */
  const studyMin = Number(state.study && state.study.todayMinutes) || 0;
  const studyGoal = Number(goals.studyMinutes) || 0;
  if (studyGoal > 0 && studyMin < studyGoal) {
    add('study-' + startOfDay(base, 0).getTime(), atTime(base, DAILY_SUMMARY_HOUR, 0),
      'Study target not met',
      studyMin + ' / ' + studyGoal + ' min logged today.',
      { url: './?tab=study' });
  }

  /* --- Budget: warn as soon as spending passes the month goal. */
  const budget = Number(state.expenses && state.expenses.monthBudget) || 0;
  const spent = Number(state.expenses && state.expenses.monthTotal) || 0;
  if (budget > 0 && spent >= budget) {
    add('budget-' + new Date(base.getFullYear(), base.getMonth(), 1).getTime(),
      atTime(base, DAILY_SUMMARY_HOUR, 0),
      'Budget reached',
      'Spent ' + spent + ' of ' + budget + ' ' + ((state.goals && state.goals.currency) || '') + '.',
      { url: './?tab=money', priority: 'high' });
  }

  /* --- Backlog nudge: stale open tasks. Anchored just after "now" rather than a
       fixed hour, because opening the app at 14:00 must still produce it. */
  const overdueTasks = tasks.filter((t) => {
    const when = parseWhen(t.due, base);
    return when && when.getTime() < base.getTime();
  });
  if (overdueTasks.length) {
    add('task-overdue-' + startOfDay(base, 0).getTime(), new Date(base.getTime() + 5 * MINUTE),
      overdueTasks.length + ' overdue task' + (overdueTasks.length > 1 ? 's' : ''),
      overdueTasks.slice(0, 3).map((t) => t.task).join(', ') +
        (overdueTasks.length > 3 ? '…' : ''),
      { url: './?tab=tasks', priority: 'high' });
  }

  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Human echo of the original due text, so messages match what was typed. */
function describeDue(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return 'soon';
  return raw.replace(/\s+/g, ' ');
}

/* ============================================================================
   Runtime: permission, display, and the two scheduling mechanisms
   ========================================================================== */

const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='100' y2='100'%3E%3Cstop offset='0' stop-color='%2322d3ee'/%3E%3Cstop offset='1' stop-color='%23a855f7'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M10 50 Q10 10 50 10 Q90 10 90 50 Q90 90 50 90 Q10 90 10 50' fill='none' stroke='url(%23g)' stroke-width='10' stroke-linecap='round'/%3E%3Ccircle cx='50' cy='50' r='13' fill='%23a855f7'/%3E%3C/svg%3E";

const TICK_MS = 30 * 1000;     // in-page poll interval
const FIRED_TTL = 7 * DAY;      // forget a fired key after a week
const MAX_TRIGGERS = 12;       // OS budgets are small; keep the plan short

const rt = {
  plan: [],
  handled: {},        // key -> true when an OS trigger owns the delivery
  fired: {},
  timer: null,
  opts: {}
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* quota */ }
}

function pruneFired(now) {
  for (const k in rt.fired) {
    if (!Object.prototype.hasOwnProperty.call(rt.fired, k)) continue;
    if (now - rt.fired[k] > FIRED_TTL) delete rt.fired[k];
  }
}

function alreadyFired(key, now) {
  pruneFired(now);
  return Object.prototype.hasOwnProperty.call(rt.fired, key);
}

function markFired(key, now) {
  rt.fired[key] = now;
  writeJSON(LS_NOTIFY.fired, rt.fired);
}

/** Notification permission, or 'unsupported' in browsers without the API. */
function permission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

function supported() {
  return typeof Notification !== 'undefined' && permission() !== 'unsupported';
}

/** True when the browser can fire notifications with the app closed. */
function triggersSupported() {
  if (typeof Notification === 'undefined') return false;
  if (!('showTrigger' in Notification.prototype)) return false;
  if (typeof ServiceWorkerRegistration === 'undefined') return false;
  return 'getNotifications' in ServiceWorkerRegistration.prototype;
}

/** True when the page is running as an installed PWA (triggers require it). */
function installed() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: window-controls-overlay)').matches ||
      window.navigator.standalone === true;
  } catch (e) {
    return false;
  }
}

async function request() {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch (e) {
    return Notification.permission;
  }
}

async function registration() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch (e) {
    return null;
  }
}

/** Display one notification. Prefers the service worker so it survives restarts. */
async function show(title, body, options) {
  const o = options || {};
  if (permission() !== 'granted') return false;

  const payload = {
    body: body || '',
    tag: o.tag || 'tp-' + String(title).slice(0, 24),
    icon: ICON,
    badge: ICON,
    renotify: true,
    requireInteraction: o.priority === 'high',
    data: { url: o.url || './', tag: o.tag || '' }
  };

  const reg = await registration();
  if (reg && typeof reg.showNotification === 'function') {
    try {
      await reg.showNotification(title, payload);
      return true;
    } catch (e) { /* fall through to the window path */ }
  }

  try {
    // eslint-disable-next-line no-new
    new Notification(title, payload);
    return true;
  } catch (e) {
    return false;
  }
}

/** Close every notification this app owns (used when the plan is rebuilt). */
async function clearAll() {
  const reg = await registration();
  if (!reg || typeof reg.getNotifications !== 'function') return;
  try {
    const list = await reg.getNotifications();
    await Promise.all(list.map((n) => n.close()));
  } catch (e) { /* nothing to clear */ }
}

/**
 * Tags of notifications the OS is currently showing.
 *
 * This matters because a trigger-delivered reminder fires while the page is
 * closed, so nothing gets the chance to write it to localStorage. Without this
 * the same reminder would be re-armed on every launch and nag forever. The
 * service worker is the only party that knows, so ask it.
 */
async function harvestDisplayed() {
  const reg = await registration();
  if (!reg || typeof reg.getNotifications !== 'function') return [];
  try {
    const list = await reg.getNotifications();
    return list
      .map((n) => (n.data && n.data.tag) || '')
      .filter(Boolean)
      .map((tag) => String(tag).replace(/^tp-/, ''));
  } catch (e) {
    return [];
  }
}

/** Fire anything in the in-page plan whose time has come. */
async function tick() {
  if (permission() !== 'granted') return;
  const now = Date.now();
  for (const item of rt.plan) {
    if (item.at.getTime() > now) continue;
    if (rt.handled[item.key]) continue;      // an OS trigger owns this one
    if (alreadyFired(item.key, now)) continue;
    markFired(item.key, now);
    await show(item.title, item.body, item);
  }
  rt.plan = rt.plan.filter((i) => i.at.getTime() > now || !alreadyFired(i.key, now));
}

/**
 * Install OS triggers for the plan. Returns the number scheduled; anything the
 * OS refuses falls back to the in-page timer.
 */
async function armTriggers(items) {
  if (!triggersSupported() || !installed()) return 0;
  let armed = 0;
  for (const item of items.slice(0, MAX_TRIGGERS)) {
    const reg = await registration();
    if (!reg) break;
    try {
      await reg.showNotification(item.title, {
        body: item.body,
        tag: item.tag,
        icon: ICON,
        badge: ICON,
        timestamp: item.at.getTime(),
        requireInteraction: item.priority === 'high',
        data: { url: item.url, tag: item.tag, at: item.at.getTime() },
        showTrigger: new TimestampTrigger(item.at.getTime())
      });
      rt.handled[item.key] = true;
      armed++;
    } catch (e) {
      // showTrigger throws when the PWA is not installed or the budget is spent;
      // stop trying triggers and let the timer cover the rest.
      break;
    }
  }
  return armed;
}

/**
 * Rebuild the whole reminder set from app state. Safe to call often: it clears
 * previously armed notifications first, so editing a task cannot leave a stale
 * reminder behind.
 */
async function reschedule(state, options) {
  rt.opts = options || rt.opts;
  if (typeof localStorage !== 'undefined' && localStorage.getItem(LS_NOTIFY.on) === '0') {
    await disable();
    return { scheduled: 0, reason: 'disabled' };
  }
  if (!supported() || permission() !== 'granted') {
    rt.plan = [];
    return { scheduled: 0, reason: permission() };
  }

  rt.fired = readJSON(LS_NOTIFY.fired, {});
  pruneFired(Date.now());

  // Reminders that already reached the user (including ones the OS fired while
  // the app was shut) must not be queued a second time.
  const shownTags = await harvestDisplayed();
  const nowMs = Date.now();
  for (const key of shownTags) markFired(key, nowMs);

  const now = new Date();
  let plan = buildPlan(state, now, rt.opts).filter((p) => !alreadyFired(p.key, now.getTime()));

  await clearAll();
  rt.handled = {};

  // Triggers first, because anything they own is removed from the timer path.
  let armed = 0;
  try {
    armed = await armTriggers(plan);
  } catch (e) {
    armed = 0;
  }
  rt.plan = plan.filter((p) => !rt.handled[p.key]);

  if (rt.timer) clearInterval(rt.timer);
  rt.timer = setInterval(() => { tick(); }, TICK_MS);
  if (document.visibilityState === 'visible') tick();

  return { scheduled: plan.length, armed: armed, timers: rt.plan.length };
}

/** Remove every reminder and stop the timer. */
async function disable() {
  if (rt.timer) { clearInterval(rt.timer); rt.timer = null; }
  rt.plan = [];
  rt.handled = {};
  await clearAll();
  try { localStorage.setItem(LS_NOTIFY.on, '0'); } catch (e) { /* ignore */ }
}

/** Human-readable capability summary for the settings UI. */
function capability() {
  if (!supported()) return 'This browser has no notification support.';
  const bits = [];
  bits.push(triggersSupported() && installed()
    ? 'Works with the app closed (installed + Chrome).'
    : 'Works while the app is open.');
  if (!installed()) bits.push('Install the app from your browser menu for background reminders.');
  else if (!triggersSupported()) bits.push('This browser cannot fire reminders with the app closed.');
  return bits.join(' ');
}

/* NB: this must NOT be called `api` — app.js declares a global `function api`
   for its backend calls, and a top-level `const api` here collides with it,
   killing app.js with "Identifier 'api' has already been declared". */
const NotifyApi = {
  LS_NOTIFY: LS_NOTIFY,
  QUIET_START: QUIET_START,
  QUIET_END: QUIET_END,
  DAILY_SUMMARY_HOUR: DAILY_SUMMARY_HOUR,
  WEEKDAYS: WEEKDAYS,
  ICON: ICON,
  TICK_MS: TICK_MS,
  MAX_TRIGGERS: MAX_TRIGGERS,
  startOfDay: startOfDay,
  atTime: atTime,
  minutesOfDay: minutesOfDay,
  parseClock: parseClock,
  parseWhen: parseWhen,
  untilNextWeekly: untilNextWeekly,
  respectQuietHours: respectQuietHours,
  describeDue: describeDue,
  buildPlan: buildPlan,
  permission: permission,
  supported: supported,
  triggersSupported: triggersSupported,
  installed: installed,
  request: request,
  show: show,
  clearAll: clearAll,
  harvestDisplayed: harvestDisplayed,
  reschedule: reschedule,
  disable: disable,
  capability: capability,
  state: rt
};

if (typeof module !== 'undefined' && module.exports) module.exports = NotifyApi;
if (typeof globalThis !== 'undefined') globalThis.TPNotify = NotifyApi;