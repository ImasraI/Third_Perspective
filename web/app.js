/* ============================================================================
   ThirdPerspective - PWA client
   Talks to the Apps Script JSON API. No secrets live in this file.
   ========================================================================== */

// This site's backend is available even on a fresh browser or after storage is cleared.
const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbwpVei2PcSBquSnhTVqopCOqQ5gts0g8cm68TNXcjcz4S_Pdm6_64Cx9OikgtDz_PRM/exec';

function readSetting(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

function saveSetting(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* Use current settings when storage is unavailable. */ }
}

const LS = {
  url: 'gt.apiUrl',
  key: 'gt.appKey',
  tab: 'gt.tab',
  snapshot: 'gt.dashboard.v1'
};

const S = {
  url: readSetting(LS.url) || DEFAULT_API_URL,
  key: readSetting(LS.key) || '',
  data: null,
  parsed: [],          // foods staged for logging
  photo: null,         // downscaled meal photo (data URL) staged for parse.image
  muscles: new Set(),  // muscle groups picked in the workout form
  charts: {},
  acIndex: -1,
  acMatches: [],
  calendar: { view: 'day', start: new Date(), end: null },
  workouts: [],
  workoutEditMuscles: new Set(),
  workoutEditPanelOpen: false
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, kind) {
  if (globalThis.TPSound) TPSound.toast(kind || 'ok');
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast on ' + (kind || 'ok');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = 'toast ' + (kind || 'ok'); }, 2800);
}

/* ============================================================================
   API
   ========================================================================== */

// POST with text/plain keeps this a "simple request", so no CORS preflight is
// needed and Apps Script's ContentService answers work from any origin.
async function api(action, payload) {
  if (!S.url) throw new Error('No backend URL — open Settings first');
  const body = Object.assign({}, payload || {}, { action: action, appKey: S.key });
  const res = await fetch(S.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  let json;
  try { json = await res.json(); }
  catch (e) { throw new Error('Backend did not return JSON. Check the Apps Script deployment URL and access settings.'); }
  if (json.ok === false) throw new Error(json.error || 'Request failed');
  return json;
}

function setConn(state, label) {
  const dot = $('#live-dot');
  const ind = $('#live-indicator');
  const map = {
    ok: ['bg-emerald-400', 'text-emerald-400'],
    busy: ['bg-amber-400 animate-ping', 'text-amber-400'],
    bad: ['bg-red-500', 'text-red-500']
  };
  const [d, c] = map[state] || map.bad;
  dot.className = 'inline-block w-2.5 h-2.5 rounded-full ' + d;
  ind.className = 'text-[11px] uppercase tracking-wider font-semibold ' + c;
  ind.textContent = label;
}

function restoreDashboard() {
  try {
    const saved = JSON.parse(readSetting(LS.snapshot) || 'null');
    if (!saved || saved.url !== S.url || saved.key !== S.key) return false;
    const data = saved.data;
    if (!data || !data.goals || !data.nutrition || !data.workouts || !data.expenses || !data.study ||
        !Array.isArray(data.tasks) || !Array.isArray(data.classes) || !Array.isArray(data.foods)) return false;
    S.data = data;
    normaliseWorkoutState(S.data);
    render();
    setConn('ok', 'Saved data');
    $('#conn-info').textContent = 'Saved dashboard · checking for updates';
    return true;
  } catch (e) { S.data = null; return false; }
}

let loadSequence = 0;
async function load(options) {
  if (!S.url) { setConn('bad', 'Not connected'); return; }
  const background = !!(options && options.background && S.data);
  const sequence = ++loadSequence;
  const url = S.url, key = S.key;
  if (!background) setConn('busy', 'Syncing…');
  try {
    const data = await api('state');
    if (sequence !== loadSequence || url !== S.url || key !== S.key) return;
    S.data = data;
    normaliseWorkoutState(S.data);
    render();
    saveSetting(LS.url, S.url);
    saveSetting(LS.snapshot, JSON.stringify({ url, key, savedAt: Date.now(), data: S.data }));
    setConn('ok', 'Connected');
    $('#conn-info').textContent = 'Connected · ' + (S.data.goals.currency || '');
    syncNotifications();
  } catch (e) {
    if (sequence !== loadSequence || url !== S.url || key !== S.key) return;
    setConn('bad', S.data ? 'Saved data · offline' : 'Connection failed');
    $('#conn-info').textContent = (S.data ? 'Showing saved dashboard. ' : '') + 'Error: ' + e.message;
    if (!background) toast(e.message, 'err');
  }
}

/** Accept older Apps Script deployments that used a single shoulders group. */
function normaliseWorkoutState(data) {
  if (!data.workouts) return;
  const status = data.workouts.muscleStatus || {};
  const normalised = {};
  Object.keys(MUSCLE_LABELS).forEach(m => {
    normalised[m] = status[m] || (m.endsWith('-delts') ? status.shoulders : null) ||
      { level: 0, daysAgo: null, sessions7d: 0 };
  });
  data.workouts.muscleStatus = normalised;
  (data.workouts.recent || []).forEach(w => {
    w.muscles = [...new Set((w.muscles || []).flatMap(m => m === 'shoulders' ? ['front-delts', 'side-delts', 'rear-delts'] : [m]))];
  });
}

function refreshSoon() { setTimeout(load, 120); }

/* ============================================================================
   RENDER
   ========================================================================== */

function render() {
  const d = S.data;
  if (!d) return;
  S.workouts = d.workouts && d.workouts.recent ? d.workouts.recent.slice() : [];
  lucide.createIcons();
  renderRings(d);
  renderMetrics(d);
  renderTodayFoods(d);
  renderTasksInto('#today-tasks', d.tasks.filter(t => t.status !== 'Completed' && !isShopItem(t)), true);
  renderFoodLog(d);
  renderLibrary(d);
  renderBody(d);
  renderWorkoutLog(d);
  renderExpenses(d);
  renderStudy(d);
  renderTasks();
  renderShopping(d);
  if (S.calendar) renderCalendar(); else renderMarkPanel();
  renderGoals(d);
  drawCharts(d);
  renderChanges();
}

function pct(v, goal) { return goal > 0 ? Math.min(100, (v / goal) * 100) : 0; }

function setRing(id, r, value, goal) {
  const c = 2 * Math.PI * r;
  const el = $(id);
  el.setAttribute('stroke-dasharray', c.toFixed(1));
  el.setAttribute('stroke-dashoffset', (c * (1 - pct(value, goal) / 100)).toFixed(1));
}

function renderRings(d) {
  const n = d.nutrition.today, g = d.goals;
  const left = Math.max(0, g.calories - n.calories);
  $('#center-cal').textContent = fmt(left);
  $('#stat-cal').textContent = fmt(n.calories);
  $('#goal-cal').textContent = fmt(g.calories);
  $('#stat-pro').textContent = fmt(n.protein);
  $('#goal-pro').textContent = fmt(g.protein);
  $('#macro-split').textContent =
    'P ' + fmt(n.protein) + ' · C ' + fmt(n.carbs) + ' · F ' + fmt(n.fat);
  $('#bar-cal').style.width = pct(n.calories, g.calories) + '%';
  $('#bar-pro').style.width = pct(n.protein, g.protein) + '%';

  const e = d.expenses;
  $('#stat-spend').textContent = fmt(e.monthTotal);
  $('#goal-spend').textContent = fmt(e.monthBudget);
  $('#bar-spend').style.width = pct(e.monthTotal, e.monthBudget) + '%';

  setRing('#ring-calorie', 82, n.calories, g.calories);
  setRing('#ring-protein', 64, n.protein, g.protein);
  setRing('#ring-budget', 46, e.todayTotal, Math.max(1, e.monthBudget / 30));

  // Ring glow colors — warm IDE palette
  $('#ring-calorie').style.color = 'rgba(224, 138, 78, 0.65)';
  $('#ring-protein').style.color = 'rgba(121, 184, 232, 0.65)';
  $('#ring-budget').style.color = 'rgba(209, 111, 164, 0.65)';
}

function renderMetrics(d) {
  const open = d.tasks.filter(t => t.status !== 'Completed' && !isShopItem(t)).length;
  $('#m-spent').textContent = fmt(d.expenses.todayTotal);
  $('#m-study').textContent = d.study.todayMinutes + 'm';
  $('#m-workout').textContent = d.workouts.today.length;
  $('#m-tasks').textContent = open;
}

function rowDelete(sheet, rowId) {
  return `<button class="icon-btn" data-del="${sheet}" data-row="${rowId}" title="Delete">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>`;
}

function renderTodayFoods(d) {
  const today = d.nutrition.recent.filter(x => x.date === d.today);
  const el = $('#today-foods');
  if (!today.length) { el.innerHTML = '<div class="text-center py-6 text-sm text-slate-500">Nothing logged yet</div>'; return; }
  el.innerHTML = today.map(x => `
    <div class="list-row">
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-slate-100 truncate">${esc(x.food)}</div>
        <div class="text-[11px] text-slate-500 font-mono">${esc(x.qty)} ${esc(x.unit)} · P ${x.protein} C ${x.carbs} F ${x.fat}</div>
      </div>
      <span class="font-mono text-sm font-bold text-cyan-400">${fmt(x.calories)}</span>
      ${rowDelete('Nutrition', x.rowId)}
    </div>`).join('');
}

function renderFoodLog(d) {
  const el = $('#food-log');
  if (!d.nutrition.recent.length) { el.innerHTML = '<div class="text-center py-6 text-sm text-slate-500">Nothing logged yet</div>'; return; }
  el.innerHTML = d.nutrition.recent.slice(0, 25).map(x => `
    <div class="list-row">
      <span class="font-mono text-[10px] text-slate-500 w-10">${esc(x.date.slice(5))}</span>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-slate-100 truncate">${esc(x.food)}</div>
        <div class="text-[11px] text-slate-500 font-mono">${esc(x.qty)} ${esc(x.unit)} · P ${x.protein} C ${x.carbs} F ${x.fat}</div>
      </div>
      <span class="font-mono text-sm font-bold text-cyan-400">${fmt(x.calories)}</span>
      <div class="flex items-center gap-1">
        <button class="icon-btn btn-sm food-edit-btn" data-edit-sheet="Nutrition" data-edit-row="${x.rowId}" title="Edit food">
          <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
        </button>
        ${rowDelete('Nutrition', x.rowId)}
      </div>
    </div>`).join('');
}

function renderLibrary(d) {
  const q = ($('#lib-search').value || '').toLowerCase();
  const all = d.foods.slice().sort((a, b) => b.uses - a.uses);
  const list = q ? all.filter(f => f.name.toLowerCase().includes(q)) : all;
  $('#lib-count').textContent = all.length;
  const el = $('#lib-list');
  if (!list.length) {
    el.innerHTML = `<div class="text-center py-6 text-sm text-slate-500 col-span-full">${q ? 'No match' : 'No saved foods yet — log a meal first'}</div>`;
    return;
  }
  el.innerHTML = list.slice(0, 60).map(f => `
    <button class="list-row text-left" data-lib='${esc(JSON.stringify(f))}'>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-slate-100 truncate">${esc(f.name)}</div>
        <div class="text-[11px] text-slate-500 font-mono">per ${f.refAmount} ${esc(f.refUnit)} · P ${f.protein} C ${f.carbs} F ${f.fat}</div>
      </div>
      <div class="text-right">
        <div class="font-mono text-sm font-bold text-cyan-400">${fmt(f.calories)}</div>
        <div class="flex items-center justify-end gap-1 mt-1">
          <span class="currency-tag">${esc(d.goals.currency || 'toman')}</span>
          <span class="text-[10px] text-slate-600">${f.uses}× used</span>
        </div>
      </div>
    </button>`).join('');
}

function renderBody(d) {
  renderBodyMap($('#bodymap'), d.workouts.muscleStatus);
  buildLegend(d.workouts.muscleStatus);
  applyBodyWindow();
}

/* The window select only re-filters what is highlighted client-side; muscle
   status itself is computed server-side from every workout on record. */
function applyBodyWindow() {
  const sel = $('#body-window');
  if (!sel) return;
  const max = parseInt(sel.value, 10) || 6;
  const svg = $('#bodymap');
  if (!svg) return;
  svg.querySelectorAll('.bm-region').forEach(function (g) {
    const days = parseInt(g.dataset.days, 10);
    // Never-trained muscles have no days value and must stay fully visible;
    // only muscles trained longer ago than the selected window fade back.
    const inWindow = !Number.isFinite(days) || days <= max;
    g.classList.toggle('bm-out', !inWindow);
  });
  const note = $('#bm-window-note');
  if (note) note.textContent = 'Showing effort for the last ' + (max + 1) + ' days';
}

/**
 * One chip per muscle in the legend.
 *
 * Single colour language: the dot carries the effort class (bm-none /
 * bm-effort-1..4, same CSS as the figures), while the text carries the
 * numbers — effort level, days since trained and sessions this week.
 * This replaces both muscleTone() (recency colours) and the hardcoded
 * recency swatches, which used to disagree with the effort legend.
 */
function buildLegend(status) {
  const el = $('#bm-legend');
  if (!el) return;
  el.innerHTML = Object.keys(status).map(function (k) {
    const m = status[k] || {};
    const tone = getEffortClass(m);
    const level = Math.max(0, Math.min(4, Number(m.level) || 0));
    const days = m.daysAgo;
    const ago = (days === null || days === undefined) ? 'never'
      : (days === 0 ? 'today' : days + 'd ago');
    const wk = m.sessions7d ? ' · ' + m.sessions7d + '×/wk' : '';
    return `<span class="bm-key" data-muscle="${k}" data-tip="${esc(getEffortTooltip(m, k))}">
      <span class="dot ${tone}"></span>
      ${esc(MUSCLE_LABELS[k] || k)}
      <span class="ago">${level}/4 · ${ago}${wk}</span>
    </span>`;
  }).join('');
}

function renderWorkoutLog(d) {
  const el = $('#wk-log');
  if (!d.workouts.recent.length) { el.innerHTML = '<div class="text-center py-6 text-sm text-slate-500">No workouts yet</div>'; return; }
  el.innerHTML = d.workouts.recent.slice(0, 20).map(w => `
    <div class="list-row">
      <span class="font-mono text-[10px] text-slate-500 w-10">${esc(w.date.slice(5))}</span>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-slate-100">${esc(w.name)}</div>
        <div class="text-[11px] text-slate-500 font-mono">${w.durationMin ? w.durationMin + 'm · ' : ''}${esc(w.exercises || '')}</div>
        <div class="flex flex-wrap gap-1 mt-1">${[...new Set([...(w.muscles || []), ...activityMuscleTargets((w.name || '') + ' ' + (w.exercises || ''))])].map(m =>
          `<span class="badge badge-cache">${esc(m)}</span>`).join('')}</div>
      </div>
      <div class="flex items-center gap-1">
        <button class="icon-btn btn-sm workout-edit-btn" data-edit-sheet="Workouts" data-edit-row="${w.rowId}" title="Edit workout">
          <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
        </button>
        ${rowDelete('Workouts', w.rowId)}
      </div>
    </div>`).join('');
}

function renderExpenses(d) {
  const cur = d.goals.currency || '';
  $('#ex-month').textContent = fmt(d.expenses.monthTotal) + ' ' + cur;
  const el = $('#ex-list');
  if (!d.expenses.recent.length) { el.innerHTML = '<div class="text-center py-6 text-sm text-slate-500">No expenses yet</div>'; return; }
  el.innerHTML = d.expenses.recent.slice(0, 25).map(x => `
    <div class="list-row">
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-slate-100 truncate">${esc(x.merchant || x.category)}</div>
        <div class="text-[11px] text-slate-500">${esc(x.date)} · ${esc(x.category)}</div>
      </div>
      <div class="text-right">
        <div class="font-mono text-sm font-bold text-purple-400">${fmt(x.amount)}</div>
        <span class="currency-tag">${esc(cur)}</span>
      </div>
      ${rowDelete('Expenses', x.rowId)}
    </div>`).join('');
}

function renderStudy(d) {
  const el = $('#st-list');
  if (!d.study.recent.length) { el.innerHTML = '<div class="text-center py-6 text-sm text-slate-500">Nothing logged yet</div>'; return; }
  el.innerHTML = d.study.recent.slice(0, 20).map(x => `
    <div class="list-row">
      <span class="font-mono text-[10px] text-slate-500 w-10">${esc(x.date.slice(5))}</span>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-slate-100 truncate">${esc(x.subject)}</div>
        <div class="text-[11px] text-slate-500 font-mono">${x.minutes} min</div>
      </div>
      ${rowDelete('Study', x.rowId)}
    </div>`).join('');
}

function renderTasksInto(sel, list, compact) {
  const el = $(sel);
  if (!list.length) { el.innerHTML = `<div class="text-center py-6 text-sm text-slate-500">${sel === '#task-open-list' ? 'All clear 🎉' : 'None'}</div>`; return; }
  el.innerHTML = list.map(t => `
    <div class="list-row">
      <div class="tick ${t.status === 'Completed' ? 'on' : ''}" data-task="${t.rowId}">
        ${t.status === 'Completed' ? '<i data-lucide="check"></i>' : ''}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold ${t.status === 'Completed' ? 'line-through text-slate-600' : 'text-slate-100'} truncate">${esc(t.task)}</div>
        ${compact ? '' : `<div class="text-[11px] text-slate-500">${t.due ? 'Due ' + esc(t.due) : 'No deadline'} · ${esc(t.priority)}</div>`}
      </div>
      ${compact ? '' : rowDelete('Tasks', t.rowId)}
    </div>`).join('');
}

function renderTasks() {
  if (!S.data) return;
  const open = S.data.tasks.filter(t => t.status !== 'Completed' && !isShopItem(t));
  const done = S.data.tasks.filter(t => t.status === 'Completed' && !isShopItem(t));
  $('#task-open').textContent = open.length;
  renderTasksInto('#task-open-list', open, false);
  renderTasksInto('#task-done-list', done, false);
}

/* ============================================================================
   SHOPPING LIST
   ----------------------------------------------------------------------------
   Items are ordinary rows in the Tasks sheet carrying priority "Shopping",
   so add / tick / delete reuse the existing task.add, task.toggle and
   entry.delete actions — no backend change, no re-upload of Code.js.
   ========================================================================== */

const isShopItem = t => t.priority === 'Shopping';

function renderShopping(d) {
  const el = $('#shop-list');
  if (!el) return;
  const items = d.tasks.filter(isShopItem);
  const open = items.filter(t => t.status !== 'Completed');
  const done = items.filter(t => t.status === 'Completed');
  const count = $('#shop-count');
  if (count) count.textContent = open.length;

  if (!items.length) {
    el.innerHTML = '<div class="text-center py-6 text-sm text-slate-500">List is empty — add your first item</div>';
    return;
  }
  // Open items on top, bought ones underneath so ticking never reorders
  // the list under your finger.
  el.innerHTML = open.concat(done).map(t => {
    const bought = t.status === 'Completed';
    return `
    <div class="list-row">
      <div class="tick ${bought ? 'on' : ''}" data-task="${t.rowId}">
        ${bought ? '<i data-lucide="check"></i>' : ''}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold ${bought ? 'line-through text-slate-500' : 'text-slate-100'} truncate">${esc(t.task)}</div>
      </div>
      ${rowDelete('Tasks', t.rowId)}
    </div>`;
  }).join('');
  lucide.createIcons();
}

async function addShoppingItem() {
  const input = $('#shop-input');
  const name = input.value.trim();
  if (!name) { toast('Type an item first', 'warn'); return; }
  try {
    await api('task.add', { task: name, priority: 'Shopping' });
    input.value = '';
    toast('Added to the shopping list', 'ok');
    await load();
  } catch (e) { toast(e.message, 'err'); }
}

/* ============================================================================
   CALENDAR (Google Calendar style)
   The MORE tab becomes a full month/week/day calendar: month grid, week list,
   and a day detail with time blocks. Classes come from classState() (SHEETS.CLASSES).
   ========================================================================== */

const COLORS = {
  cyan: '#79b8e8',
  purple: '#c08bd9',
  green: '#98c379',
  orange: '#e08a4e',
  pink: '#d16fa4',
  amber: '#e3a04a',
  red: '#f14c4c',
  slate: '#8b8479'
};

/* ============================================================================
   Calendar notify marks
   --------------------------------------------------------------------------
   A class only pings 15 minutes ahead when its bell is ticked (and
   "Notify only marked blocks" is on). Marks live in localStorage, so they
   survive reloads without any backend change.
   ========================================================================== */

const LS_CAL = {
  marks: 'tp.cal.marks',
  only: 'tp.cal.onlyMarked'
};

function readMarks() {
  try {
    const raw = localStorage.getItem(LS_CAL.marks);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(Number).filter(function (n) { return n > 0; }) : []);
  } catch (e) { return new Set(); }
}

function saveMarks(set) {
  try { localStorage.setItem(LS_CAL.marks, JSON.stringify(Array.from(set))); } catch (e) { /* quota */ }
}

/** Default ON: only the blocks the user ticked should remind them. */
function notifyOnlyMarked() {
  const v = readSetting(LS_CAL.only);
  return v === null ? true : v === '1';
}

function setNotifyOnly(on) {
  try { localStorage.setItem(LS_CAL.only, on ? '1' : '0'); } catch (e) { /* quota */ }
}

/** Options handed to buildPlan/reschedule so the plan matches the toggles. */
function notifyOpts() {
  return { classLeadMin: 15, onlyMarked: notifyOnlyMarked(), marked: readMarks() };
}

/** Paint the "Marked blocks" list under the calendar. */
function renderMarkPanel() {
  const panel = $('#cal-mark-panel');
  if (!panel) return;
  const marks = readMarks();
  const classes = (S.data && S.data.classes) || [];
  const list = classes.filter(function (c) { return marks.has(Number(c.rowId)); });

  const count = $('#mark-count');
  if (count) count.textContent = marks.size ? marks.size + ' block(s) marked' : 'Nothing marked yet';

  const allBtn = $('#mark-all-notify');
  if (allBtn) {
    const all = classes.length > 0 && classes.every(function (c) { return marks.has(Number(c.rowId)); });
    allBtn.textContent = all ? 'Unmark all blocks' : 'Mark all blocks';
  }

  if (!list.length) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  $('#cal-mark-list').innerHTML = list.map(function (c) {
    const when = [c.day || c.date, c.time].filter(Boolean).join(' · ');
    return '<div class="cal-mark-item"><span class="dot on"></span>' +
      esc(when ? when + ' — ' + (c.subject || '') : (c.subject || '')) + '</div>';
  }).join('');
}

function renderCalendar() {
  const d = S.data;
  if (!d) return;
  const today = new Date();
  const view = S.calendar.view;
  const start = S.calendar.start;
  const end = S.calendar.end;

  const title = $('#cal-title');
  if (view === 'month') {
    title.textContent = start ? (start.getFullYear() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][start.getMonth()]) : 'Month';
    $('#cal-grid').classList.remove('hidden');
    $('#cal-list-view').classList.add('hidden');
    $('#cal-day-view').classList.add('hidden');
    renderMonthGrid(today, start, end);
  } else if (view === 'week') {
    const weekFrom = weekStart(start || today, 1);
    const weekTo = weekEnd(weekFrom);
    const label = fmtDate(weekFrom) + ' – ' + fmtDate(weekTo);
    title.textContent = label;
    $('#cal-grid').classList.add('hidden');
    $('#cal-list-view').classList.remove('hidden');
    $('#cal-day-view').classList.add('hidden');
    renderWeekList(today, start, end);
  } else {
    const label = start ? (start.getMonth()+1) + '/' + start.getDate() : 'Day';
    title.textContent = label;
    $('#cal-grid').classList.add('hidden');
    $('#cal-list-view').classList.add('hidden');
    $('#cal-day-view').classList.remove('hidden');
    renderDayView(today, start, end);
  }
  renderMarkPanel();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DAY_NAMES_FULL = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const MEMORY = {};

function dayName(d) { return DAY_NAMES[(d + 6) % 7]; }
function dayNameFull(d) { return DAY_NAMES_FULL[(d.getDay() + 6) % 7]; }
function weekStart(d, firstDay) { // Monday-based week start
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = copy.getDay();
  const diff = (day === 0 ? 6 : day - 1); // Sunday -> 6 (Monday-based)
  copy.setDate(copy.getDate() - diff);
  return copy;
}
function weekEnd(d) { const e = new Date(d); e.setDate(e.getDate() + 6); return e; }
function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function dayEnd(d) { const e = new Date(d); e.setDate(e.getDate() + 1); return e; }
function monthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function monthEnd(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }

function dayBucket(date) { return date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0'); }

/**
 * Classes that fall on a given calendar day.
 *
 * The Classes sheet stores a WEEKDAY ("Wednesday") plus a time, not a date, so
 * a block recurs every week. A class may also carry an explicit `date` for a
 * one-off occurrence; either form counts.
 */
function classesForDate(d) {
  const classes = (S.data && S.data.classes) || [];
  const bucket = dayBucket(d);
  const name = DAY_NAMES_FULL[(d.getDay() + 6) % 7].toLowerCase(); // Monday-based
  return classes.filter(function (c) {
    if (c.date && bucket < c.date) return false;
    if (c.repeat === 'never') return c.date === bucket;
    if (c.repeat === 'daily') return true;
    if (c.repeat === 'monthly') return !!c.date && Number(c.date.slice(8, 10)) === d.getDate();
    if (c.date && !c.repeat) return c.date === bucket;
    if (!c.day) return false;
    const day = String(c.day).toLowerCase();
    return day === name || day.slice(0, 3) === name.slice(0, 3);
  });
}

function isSameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

function fmtDate(d) { return (d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear(); }

function findClass(date, time) {
  return classesForDate(date).filter(c => c.time && c.time <= time);
}

/** Determine the class that is active at a given wall-clock time. */
function activeClassOn(date, time) {
  const candidates = classesForDate(date);
  let best = null, bestEnd = -1;
  candidates.forEach(c => {
    const [h, m] = String(c.time || '00:00').split(':').map(Number);
    const startMin = h * 60 + m;
    const endRaw = String(c.endTime || '00:00').split(':').map(Number);
    const endMin = (endRaw[0] || 0) * 60 + (endRaw[1] || 0);
    if (startMin <= time && endMin > time && endMin > bestEnd) {
      best = c; bestEnd = endMin;
    }
  });
  return best;
}

function renderMonthGrid(today, start) {
  const body = $('#cal-grid-body');
  const first = monthStart(start);
  const offset = (first.getDay() + 6) % 7;
  const count = Math.ceil((offset + monthEnd(start).getDate()) / 7) * 7;
  const marks = readMarks();
  let html = '<div class="grid grid-cols-7 gap-px">';
  for (let i = 0; i < count; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), i - offset + 1);
    html += '<div class="bg-slate-800/60 p-1 rounded-lg min-w-0' + (d.getMonth() !== start.getMonth() ? ' opacity-40' : '') + '" data-date="' + dayBucket(d) + '">' +
      '<div class="text-[11px] font-semibold' + (isSameDay(d, today) ? ' text-brand-cyan' : ' text-slate-400') + '">' + d.getDate() + '</div>' +
      classesForDate(d).map(c => '<div class="calendar-event text-[10px] truncate" data-cal-mark="' + c.rowId + '">' +
        (marks.has(Number(c.rowId)) ? '<span class="cal-mark-dot"></span>' : '') + esc(c.subject) + '</div>').join('') + '</div>';
  }
  body.innerHTML = html + '</div>';
}

function renderWeekList(today, start, end) {
  const el = $('#cal-list');
  const days = [];
  const s = weekStart(start || today, 1);
  const e = end ? new Date(end) : weekEnd(s);
  while (s <= e) { days.push(new Date(s)); s.setDate(s.getDate() + 1); }
  const marks = readMarks();
  const classes = S.data.classes || [];
  // Build the whole string first: the old version mixed insertAdjacentHTML
  // into the map callback, so everything inserted was wiped by the join.
  el.innerHTML = days.map(d => {
    const dayClasses = classesForDate(d);
    const label = dayNameFull(d) + ' ' + fmtDate(d);
    let row = '<div class="list-row rounded-2xl p-2" data-date="' + dayBucket(d) + '">' +
      '<div class="flex items-center justify-between w-full">' +
      '<div class="flex-1 min-w-0"><div class="text-sm font-semibold text-white truncate">' + esc(label) + '</div>' +
      '<div class="text-[11px] text-slate-500">' +
      (dayClasses.length ? dayClasses.length + ' class' + (dayClasses.length > 1 ? 'es' : '') : 'No class') +
      '</div></div>';
    if (dayClasses.length) {
      row += '<div class="ml-4 flex flex-wrap gap-1">' + dayClasses.map(c => {
        const col = COLORS[c.color] || '#64748b';
        const on = marks.has(Number(c.rowId));
        return '<span class="badge badge-ai' + (on ? ' cal-block-marked' : '') + '" data-cal-mark="' + c.rowId + '" ' +
          'title="' + (on ? 'Reminder on — tap to remove' : 'Tap to remind 15 min before') + '" ' +
          'style="background:' + col + ';color:#04121f;cursor:pointer">' +
          (on ? '<span class="cal-mark-dot"></span>' : '') + esc(c.subject) + '</span>';
      }).join('') + '</div>';
    }
    row += '</div></div>';
    return row;
  }).join('');
}

function renderDayView(today, start, end) {
  const el = $('#cal-day-body');
  if (!start) return;
  const date = start;
  const time = new Date().getHours() * 60 + new Date().getMinutes();
  const classes = S.data.classes || [];
  const dayClasses = classesForDate(date);
  el.innerHTML = dayClasses.map(c => {
    const col = COLORS[c.color] || '#64748b';
    const [h] = String(c.time || '00:00').split(':').map(Number);
    const hrs = h % 12 || 12;
    const ampm = h < 12 ? 'AM' : 'PM';
    const on = readMarks().has(Number(c.rowId));
    return '<div class="glass-card rounded-2xl p-3 relative' + (on ? ' cal-block-marked' : '') + '" style="border-top:4px solid ' + col + '">' +
      '<div class="flex items-center justify-between">' +
      '<div class="font-mono text-sm font-bold text-white">' + hrs + ' ' + ampm + '</div>' +
      '<div class="flex items-center gap-2 min-w-0">' +
      '<div class="font-semibold text-white truncate">' + esc(c.subject) + '</div>' +
      '<button type="button" class="cal-mark ' + (on ? 'on' : '') + '" data-cal-mark="' + c.rowId + '" ' +
      'title="Remind me 15 min before" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      '<i data-lucide="' + (on ? 'bell-ring' : 'bell') + '" class="w-3.5 h-3.5"></i></button>' +
      '</div>' +
      '</div>' +
      '<div class="text-[11px] text-slate-500">' + esc(c.room || '') + ' · ' + esc(c.time) + (c.endTime ? ' - ' + c.endTime : '') + '</div>' +
      '<div class="text-[11px] text-slate-400">' + (c.repeat === 'daily' ? 'Every day' : (!c.repeat || c.repeat === 'weekly') ? 'Every week' : c.repeat === 'monthly' ? 'Every month' : 'Once') + '</div>' +
      '<div class="mt-1">' + (c.color === 'cyan' ? '<span class="w-3 h-3 rounded-full" style="background:#22d3ee"></span>' : c.color === 'purple' ? '<span class="w-3 h-3 rounded-full" style="background:#a855f7"></span>' : c.color === 'green' ? '<span class="w-3 h-3 rounded-full" style="background:#22c55e"></span>' : c.color === 'orange' ? '<span class="w-3 h-3 rounded-full" style="background:#fb923c"></span>' : c.color === 'pink' ? '<span class="w-3 h-3 rounded-full" style="background:#ec4899"></span>' : c.color === 'amber' ? '<span class="w-3 h-3 rounded-full" style="background:#f59e0b"></span>' : c.color === 'red' ? '<span class="w-3 h-3 rounded-full" style="background:#ef4444"></span>' : '<span class="w-3 h-3 rounded-full" style="background:#64748b"></span>') + '</div>' +
      '<div class="mt-2 text-[11px] text-slate-400">rowId ' + c.rowId + '</div>' +
      '</div>';
  }).join('') || '<div class="text-center py-10 text-sm text-slate-500">No classes on this day</div>';
}

function renderGoals(d) {

  if (!$('#g-cal').dataset.touched) $('#g-cal').value = d.goals.calories;
  if (!$('#g-pro').dataset.touched) $('#g-pro').value = d.goals.protein;
  if (!$('#g-carb').dataset.touched) $('#g-carb').value = d.goals.carbs;
  if (!$('#g-fat').dataset.touched) $('#g-fat').value = d.goals.fat;
  if (!$('#g-study').dataset.touched) $('#g-study').value = d.goals.studyMinutes;
  if (!$('#g-budget').dataset.touched) $('#g-budget').value = d.goals.monthBudget;
  if (!$('#g-currency').dataset.touched) $('#g-currency').value = d.goals.currency || '';
}

function drawCharts(d) {
  const cat = Object.keys(d.expenses.byCategory).map(k => ({ k, v: d.expenses.byCategory[k] }));
  if (S.charts.exp) S.charts.exp.destroy();
  S.charts.exp = new Chart($('#expenseChart'), {
    type: 'doughnut',
    data: {
      labels: cat.map(c => c.k),
      datasets: [{
        data: cat.map(c => c.v),
        backgroundColor: ['#d16fa4', '#e08a4e', '#79b8e8', '#98c379', '#e3a04a', '#f14c4c', '#4ec9b0', '#c08bd9'],
        borderColor: 'rgba(31,29,27,0.85)', borderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#a9a196', boxWidth: 10, font: { size: 10 } } },
        tooltip: { callbacks: { label: (c) => fmt(c.raw) } }
      }
    }
  });

  const days = Object.keys(d.study.week).sort();
  if (S.charts.study) S.charts.study.destroy();
  S.charts.study = new Chart($('#studyChart'), {
    type: 'bar',
    data: {
      labels: days.map(x => x.slice(5)),
      datasets: [{
        label: 'Minutes', data: days.map(x => d.study.week[x]),
        backgroundColor: 'rgba(96,165,250,0.6)', borderRadius: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });
}

/* ============================================================================
   FOOD: AI parse + library reuse
   ========================================================================== */

/**
 * Build a staged food item.
 *
 * Two independent scales, which is the whole trick:
 *   qty + unit          what the user is about to eat ("2 eggs", "150 g")
 *   refAmount + refUnit the reusable library basis ("1 egg", "100 g")
 * `per` holds macros for ONE reference amount, so changing qty is a single
 * multiplication and never a guess.
 */
function makeItem(name, qty, unit, per, refAmount, refUnit, flags) {
  const it = {
    name: name,
    qty: Number(qty) || 0,
    unit: unit || refUnit || 'serving',
    refAmount: Number(refAmount) || 1,
    refUnit: refUnit || 'serving',
    // Macros for ONE reference unit, so changing qty is a multiplication, never
    // a guess. `gramsPerRef` is the same idea in weight, which is what lets the
    // g <-> servings toggle work for counted items like eggs and slices.
    per: {
      calories: Number(per.calories) || 0,
      protein: Number(per.protein) || 0,
      carbs: Number(per.carbs) || 0,
      fat: Number(per.fat) || 0
    },
    gramsPerRef: Number(flags && flags.gramsPerRef) || 0
  };
  Object.assign(it, flags || {});
  delete it.gramsPerRef;
  it.gramsPerRef = Number((flags && flags.gramsPerRef)) || 0;
  if (it.gramsPerRef && !flags.gramsPerUnit) it.gramsPerUnit = it.gramsPerRef;
  // Which unit the user is currently editing in: the entered unit, or grams.
  it.displayUnit = (flags && flags.displayUnit) || it.unit;
  recompute(it);
  return it;
}

/**
 * Refresh the serving-level macros from qty x reference macros.
 *
 * `qty` is ALWAYS in the item's own reference unit and is the single source of
 * truth. `displayQty`/`displayUnit` are only the numbers shown in the stepper,
 * so switching between grams and servings never mutates the stored quantity or
 * risks the two drifting apart.
 */
function recompute(it) {
  const k = it.refAmount ? (it.qty / it.refAmount) : 0;
  it.calories = round1(it.per.calories * k);
  it.protein = round1(it.per.protein * k);
  it.carbs = round1(it.per.carbs * k);
  it.fat = round1(it.per.fat * k);
  it.grams = gramsOf(it);
  if (it.displayUnit !== 'g') it.displayQty = it.qty;
  return it;
}

/**
 * Can this item be shown in grams? Only when we know how heavy one reference
 * unit is: either the library entry is already weighed (100 g), or the AI/vision
 * pass told us the weight of a counted portion like an egg or a slice.
 */
function canUseGrams(it) {
  if (!it) return false;
  if (it.refUnit === 'g' && it.refAmount === 100) return true;
  return Number(it.gramsPerRef) > 0;
}

/** Grams for the portion currently staged, or 0 when the weight is unknown. */
function gramsOf(it) {
  if (!it || Number(it.gramsPerRef) <= 0) return 0;
  return round1(it.gramsPerRef * (it.qty / (it.refAmount || 1)));
}

/**
 * Set the quantity the user typed, honouring the unit currently displayed.
 * `qty` stays in reference units, so this is the only place that converts.
 */
function setDisplayQty(it, value) {
  const v = Number(value) || 0;
  if (it.displayUnit === 'g' && it.gramsPerRef > 0) {
    // grams -> reference units of the item
    it.qty = round1(v * (it.refAmount || 1) / it.gramsPerRef);
    it.displayQty = v;
  } else {
    it.qty = v;
    it.displayQty = v;
  }
  return recompute(it);
}

/** Toggle an item between grams and its natural unit. Purely a display change. */
function setItemUnit(it, unit) {
  if (!canUseGrams(it)) return it;
  it.displayUnit = unit === 'g' ? 'g' : 'it.refUnit';
  it.displayQty = it.displayUnit === 'g' ? gramsOf(it) : it.qty;
  return it;
}

/** The unit label to show next to the quantity stepper. */
function displayUnitOf(it) {
  return it.displayUnit === 'g' ? 'g' : it.unit;
}

/** Scale a library item to a quantity. No AI call. */
function fromLibrary(f, qty, unit) {
  return makeItem(f.name, qty === undefined || qty === null ? f.refAmount : qty,
    unit || f.refUnit, f, f.refAmount, f.refUnit, { cached: true, gramsPerRef: f.gramsPerRef || 0 });
}

/** Convert an item from the `parse` API into the staged shape. */
function fromApi(f) {
  const ref = f.ref || { amount: 1, unit: f.unit, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat };
  // The API sends the weight of THIS portion; convert it to weight per ref unit
  // so grams stay correct when the quantity changes.
  const gramsPerRef = (f.grams && ref.amount)
    ? round1((Number(f.grams) || 0) * ref.amount / (Number(f.qty) || 1))
    : 0;
  return makeItem(f.name, f.qty, f.unit, ref, ref.amount, ref.unit,
    { estimated: !!f.estimated, gramsPerRef: gramsPerRef, vision: !!f.vision });
}

function round1(n) { return Math.round(n * 10) / 10; }

function totalOf(items) {
  return items.reduce((a, it) => ({
    calories: a.calories + it.calories, protein: a.protein + it.protein,
    carbs: a.carbs + it.carbs, fat: a.fat + it.fat
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

/** Update the parsed-item total row without a full re-render. */
function setParsedTotals(t) {
  const map = { 'p-cal': t.calories, 'p-pro': t.protein, 'p-carb': t.carbs, 'p-fat': t.fat };
  for (const id in map) {
    const el = document.getElementById(id);
    if (el) el.textContent = fmt(map[id]);
  }
}

function renderParsed() {
  const box = $('#parsed-box');
  if (!S.parsed.length) { box.classList.add('hidden'); $('#food-add').disabled = true; return; }
  const t = totalOf(S.parsed);
  box.classList.remove('hidden');
  box.innerHTML = S.parsed.map((it, i) => `
    <div class="list-row">
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-slate-100 flex items-center gap-2">
          ${esc(it.name)}
          ${it.cached ? '<span class="badge badge-cache">cached</span>'
                      : (it.estimated ? '<span class="badge badge-manual">fill in</span>'
                                      : '<span class="badge badge-ai">ai</span>')}
        </div>
        <div class="grid grid-cols-5 gap-1.5 mt-2">
          <div class="stepper" data-qty="${i}">
            <button class="stepper-btn" data-action="dec" aria-label="Decrease"><i data-lucide="minus" class="w-4 h-4"></i></button>
            <input class="stepper-input" type="number" step="0.1" value="${it.qty}" data-qty="${i}" aria-label="Quantity">
            <button class="stepper-btn" data-action="inc" aria-label="Increase"><i data-lucide="plus" class="w-4 h-4"></i></button>
          </div>
          <div class="stepper" data-mac="calories" data-i="${i}">
            <button class="stepper-btn" data-action="dec" aria-label="Decrease"><i data-lucide="minus" class="w-4 h-4"></i></button>
            <input class="stepper-input" type="number" value="${it.calories}" data-mac="calories" data-i="${i}" aria-label="Calories">
            <button class="stepper-btn" data-action="inc" aria-label="Increase"><i data-lucide="plus" class="w-4 h-4"></i></button>
          </div>
          <div class="stepper" data-mac="protein" data-i="${i}">
            <button class="stepper-btn" data-action="dec" aria-label="Decrease"><i data-lucide="minus" class="w-4 h-4"></i></button>
            <input class="stepper-input" type="number" value="${it.protein}" data-mac="protein" data-i="${i}" aria-label="Protein">
            <button class="stepper-btn" data-action="inc" aria-label="Increase"><i data-lucide="plus" class="w-4 h-4"></i></button>
          </div>
          <div class="stepper" data-mac="carbs" data-i="${i}">
            <button class="stepper-btn" data-action="dec" aria-label="Decrease"><i data-lucide="minus" class="w-4 h-4"></i></button>
            <input class="stepper-input" type="number" value="${it.carbs}" data-mac="carbs" data-i="${i}" aria-label="Carbs">
            <button class="stepper-btn" data-action="inc" aria-label="Increase"><i data-lucide="plus" class="w-4 h-4"></i></button>
          </div>
          <div class="stepper" data-mac="fat" data-i="${i}">
            <button class="stepper-btn" data-action="dec" aria-label="Decrease"><i data-lucide="minus" class="w-4 h-4"></i></button>
            <input class="stepper-input" type="number" value="${it.fat}" data-mac="fat" data-i="${i}" aria-label="Fat">
            <button class="stepper-btn" data-action="inc" aria-label="Increase"><i data-lucide="plus" class="w-4 h-4"></i></button>
          </div>
        </div>
        <div class="text-[10px] text-slate-600 mt-1">qty · kcal · P · C · F</div>
      </div>
      <button class="icon-btn" data-rm="${i}"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
    </div>`).join('') + `
    <div class="flex items-center justify-between rounded-xl bg-gradient-to-r from-cyan-500/20 to-purple-500/10 px-3 py-2">
      <span class="text-[11px] uppercase tracking-wider font-bold text-slate-300">Total</span>
      <span class="font-mono text-sm font-extrabold text-white">
        <span id="p-cal">${fmt(t.calories)}</span> kcal ·
        P <span id="p-pro">${fmt(t.protein)}</span> ·
        C <span id="p-carb">${fmt(t.carbs)}</span> ·
        F <span id="p-fat">${fmt(t.fat)}</span>
      </span>
    </div>`;
  lucide.createIcons();
  $('#food-add').disabled = false;

  // Attach stepper click handlers
  box.querySelectorAll('.stepper').forEach(st => {
    const isQty = st.dataset.qty !== undefined;
    const idx = isQty ? +st.dataset.qty : +st.dataset.i;
    const mac = st.dataset.mac;
    st.querySelectorAll('.stepper-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const it = S.parsed[idx];
        if (!it) return;
        const action = btn.dataset.action;
        const step = isQty ? 0.1 : 1;
        if (isQty) {
          it.qty = Math.max(0, round1(it.qty + (action === 'inc' ? step : -step)));
          recompute(it);
        } else {
          it[mac] = Math.max(0, round1(it[mac] + (action === 'inc' ? step : -step)));
          // Keep reference macros in sync
          const k = it.refAmount ? (it.qty / it.refAmount) : 0;
          if (k) it.per[mac] = round1(it[mac] / k);
        }
        renderParsed();
      });
    });
  });
}

/** Look up a typed name in the library. Returns a match or null. */
function findCached(text) {
  if (!S.data) return null;
  const q = text.toLowerCase().trim();
  if (!q) return null;
  const m = q.match(/^(\d+(?:\.\d+)?)?\s*(.+)$/);
  const qty = m && m[1] ? parseFloat(m[1]) : null;
  let rest = (m ? m[2] : q).replace(/\s+/g, ' ').trim();

  // Pull a leading unit off the name so "150 g chicken breast" still matches
  // the library entry "chicken breast", and the unit is applied on top.
  const UNIT_WORDS = /^(g|gram|grams|kg|mg|ml|l|oz|lb|piece|pieces|slice|slices|egg|eggs|bowl|bowls|cup|cups|can|cans|serving|servings|portion|portions|x)\s+/i;
  const um = rest.match(UNIT_WORDS);
  let unit = null;
  if (um) { unit = um[1].toLowerCase(); rest = rest.slice(um[0].length).trim(); }

  let best = null;
  S.data.foods.forEach(f => {
    const fn = f.name.toLowerCase();
    if (rest === fn || rest.indexOf(fn) === 0 || fn.indexOf(rest) === 0) {
      if (!best || fn.length > best.name.length) best = f;
    }
  });
  if (!best) return null;
  // Default to exactly one reference amount (1 egg, 1 slice, 100 g).
  return fromLibrary(best, qty || best.refAmount, unit || undefined);
}

async function parseFood() {
  if (S.photo) { await parsePhoto(); return; }
  const text = $('#food-input').value.trim();
  if (!text) { toast('Type a meal first', 'warn'); return; }

  // 1) library hit -> no AI, instant
  const hit = findCached(text);
  if (hit) {
    S.parsed = [hit];
    renderParsed();
    toast('Loaded from library — no AI needed', 'ok');
    return;
  }

  // 2) ask Gemini
  $('#ai-status').classList.remove('hidden');
  $('#food-parse').disabled = true;
  try {
    const r = await api('parse', { text: text });
    if (r.kind !== 'food' || !r.foods || !r.foods.length) {
      if (r.kind === 'workout') {
        toast('That looks like a workout — review it in the Body tab', 'warn');
        switchTab('body');
        $('#wk-input').value = text;
        return;
      }
      if (r.kind === 'study' && r.minutes) {
        $('#st-subject').value = r.subject || text;
        $('#st-min').value = r.minutes;
        toast('Filled the study form for you', 'ok');
        switchTab('study');
        return;
      }
      if (r.kind === 'expense' && r.amount) {
        $('#ex-amount').value = r.amount;
        if (r.category) $('#ex-cat').value = r.category;
        if (r.merchant) $('#ex-merchant').value = r.merchant;
        toast('Filled the expense form for you', 'ok');
        switchTab('money');
        return;
      }
      S.parsed = (r.foods || []).map(fromApi);
      renderParsed();
      return;
    }
    S.parsed = (r.foods || []).map(fromApi);
    renderParsed();
    toast(r.source === 'gemini' ? 'AI nutrition facts ready' : 'Parsed offline — fill the numbers in', r.source === 'gemini' ? 'ok' : 'warn');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    $('#ai-status').classList.add('hidden');
    $('#food-parse').disabled = false;
  }
}

/* ============================================================================
   PHOTO -> NUTRITION (Gemini vision)
   ----------------------------------------------------------------------------
   The backend already exposes parse.image (visionAction). The photo is
   downscaled here so it stays under the server's 2.1 MB cap and the request
   stays fast; anything typed in the food box rides along as a hint.
   ========================================================================== */

function clearPhoto() {
  S.photo = null;
  const box = $('#photo-preview');
  if (box) box.classList.add('hidden');
  const input = $('#food-photo');
  if (input) input.value = '';
}

/** Shrink to max 1280px edge and re-encode as JPEG so the upload stays small. */
function preparePhoto(dataUrl, done) {
  const img = new Image();
  img.onload = function () {
    const maxEdge = 1280;
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    let out = c.toDataURL('image/jpeg', 0.75);
    // ~4 base64 chars per 3 bytes; stay comfortably under the server cap.
    if (out.length * 0.75 > 1900000) out = c.toDataURL('image/jpeg', 0.55);
    done(out);
  };
  img.onerror = function () { toast('Could not read that image', 'err'); };
  img.src = dataUrl;
}

function onPhotoPicked(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function () {
    preparePhoto(reader.result, function (b64) {
      S.photo = b64;
      $('#photo-img').src = b64;
      $('#photo-size').textContent =
        Math.round(b64.length * 0.75 / 1024) + ' KB · auto-downscaled';
      $('#photo-preview').classList.remove('hidden');
      lucide.createIcons();
    });
  };
  reader.readAsDataURL(file);
}

async function parsePhoto() {
  const hint = $('#food-input').value.trim();
  $('#ai-status').classList.remove('hidden');
  $('#food-parse').disabled = true;
  try {
    const r = await api('parse.image', { image: S.photo, hint: hint });
    if (r.recognised === false || !r.foods || !r.foods.length) {
      toast(r.note || 'I could not tell what is in this photo. Try a closer, well-lit shot.', 'warn');
      return;
    }
    S.parsed = r.foods.map(fromApi);
    renderParsed();
    toast(r.rough
      ? 'Rough estimate — check the numbers before logging'
      : 'Recognised ' + r.foods.length + ' item(s) from your photo',
      r.rough ? 'warn' : 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    $('#ai-status').classList.add('hidden');
    $('#food-parse').disabled = false;
  }
}

/* ============================================================================
   WORKOUT PHOTO -> MUSCLES + EFFORT (Gemini vision)
   ----------------------------------------------------------------------------
   The backend exposes parse.workout.image (workoutVisionAction). The photo is
   downscaled here so the upload stays small; anything typed in the workout box
   rides along as a hint. The estimate fills the muscle chips + effort bars.
   ========================================================================== */

function clearWkPhoto() {
  S.workoutPhoto = null;
  const box = $('#wk-photo-preview');
  if (box) box.classList.add('hidden');
  const input = $('#wk-photo');
  if (input) input.value = '';
}

/** Shrink to max 1280px edge and re-encode as JPEG so the upload stays small. */
function prepareWkPhoto(dataUrl, done) {
  const img = new Image();
  img.onload = function () {
    const maxEdge = 1280;
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    let out = c.toDataURL('image/jpeg', 0.75);
    // ~4 base64 chars per 3 bytes; stay comfortably under the server cap.
    if (out.length * 0.75 > 1900000) out = c.toDataURL('image/jpeg', 0.55);
    done(out);
  };
  img.onerror = function () { toast('Could not read that image', 'err'); };
  img.src = dataUrl;
}

function onWkPhotoPicked(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function () {
    prepareWkPhoto(reader.result, function (b64) {
      S.workoutPhoto = b64;
      $('#wk-photo-img').src = b64;
      $('#wk-photo-size').textContent =
        Math.round(b64.length * 0.75 / 1024) + ' KB · auto-downscaled';
      $('#wk-photo-preview').classList.remove('hidden');
      lucide.createIcons();
    });
  };
  reader.readAsDataURL(file);
}

/** Populate the muscle chips + effort from a workout-photo estimate. */
function renderWkEstimate(r) {
  const box = $('#wk-estimated-box');
  box.classList.remove('hidden');
  const muscles = (r.muscles || []).filter(m => Object.prototype.hasOwnProperty.call(MUSCLE_LABELS, m));
  const effort = r.effort || [];
  const effortByMuscle = {};
  (effort || []).forEach(function (e) { effortByMuscle[e.muscle] = e.level; });
  const names = MUSCLE_LABELS || {};
  box.innerHTML = muscles.map(function (m) {
    const lvl = effortByMuscle[m] || 0;
    const effClass = lvl === 0 ? 'none' : 'bm-effort-' + Math.min(4, lvl);
    return `<div class="flex items-center gap-2">
      <span class="chip" data-mus="${m}">${names[m] || m} <span class="bm-effort-dot ${effClass}" title="Effort ${lvl}/4"></span></span>
      <span class="text-[11px] text-slate-500">${lvl === 0 ? 'targeted · low or unscored contribution' : lvl === 1 ? 'light' : lvl === 2 ? 'moderate' : lvl === 3 ? 'hard' : 'maximal'}</span>
    </div>`;
  }).join('') || '<div class="text-[11px] text-slate-500">No muscles detected in the photo.</div>';
  $('#wk-estimated-box').classList.remove('hidden');
  $('#wk-estimated-box').innerHTML = box.innerHTML;
  // Seed the toggle set so the Save button logs the estimated muscles.
  S.muscles = new Set(muscles);
  // Mirror chips into the workout form too.
  const form = $('#wk-muscles');
  form.innerHTML = muscles.map(function (m) {
    const on = S.muscles.has(m);
    return `<span class="chip ${on ? 'on' : ''}" data-mus="${m}">${names[m] || m}</span>`;
  }).join('');
  // Mirror effort dots into the workout form where they are rendered later.
  $('#wk-muscles').querySelectorAll('[data-mus]').forEach(function (chip) {
    const lvl = effortByMuscle[chip.dataset.mus] || 0;
    const dot = lvl === 0 ? 'none' : 'bm-effort-' + Math.min(4, lvl);
    chip.innerHTML += ` <span class="bm-effort-dot ${dot}"></span>`;
  });
  const conf = r.confidence ? ' · confidence ' + r.confidence.toFixed(2) : '';
  toast(r.rough
    ? 'Rough muscle estimate — check the chips before saving'
    : 'Muscle estimate ready',
    r.rough ? 'warn' : 'ok');
}

async function estimateWorkoutMuscles() {
  const hint = $('#wk-input').value.trim();
  $('#wk-ai-status').classList.remove('hidden');
  $('#wk-estimate').disabled = true;
  try {
    const r = await api('parse.workout.image', { image: S.workoutPhoto, hint: hint });
    if (!r.ok || r.recognised === false || (!r.muscles && !r.effort)) {
      toast(r.note || (r.error || 'Could not estimate from that photo'), 'warn');
      return;
    }
    renderWkEstimate(r);
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    $('#wk-ai-status').classList.add('hidden');
    $('#wk-estimate').disabled = false;
  }
}

async function logParsed() {
  if (!S.parsed.length) return;
  const btn = $('#food-add');
  btn.disabled = true;
  try {
    await api('log.food', { items: S.parsed, source: S.parsed.some(i => i.cached) ? 'Library' : 'AI' });
    // Save only items the AI estimated, so next time they are free.
    // The library stores PER-REFERENCE macros (1 egg / 100 g), not serving
    // totals, so "3 eggs" scales correctly next time.
    const newOnes = S.parsed.filter(i => !i.cached && !i.estimated).map(i => ({
      name: i.name, refAmount: i.refAmount, refUnit: i.refUnit,
      calories: i.per.calories, protein: i.per.protein,
      carbs: i.per.carbs, fat: i.per.fat
    }));
    if (newOnes.length) {
      try { await api('food.cache', { items: newOnes }); } catch (e) { /* non-fatal */ }
    }
    toast('Logged ' + S.parsed.length + ' item(s)');
    S.parsed = [];
    $('#food-input').value = '';
    clearPhoto();
    renderParsed();
    await load();
  } catch (e) {
    toast(e.message, 'err');
    btn.disabled = false;
  }
}

/* ============================================================================
   EDIT FOOD / WORKOUT
   ----------------------------------------------------------------------------
   Tracked rows are identified by their sheet row id. The client stores the
   staging objects in module state (S.foodEdit / S.workoutEdit), keeps the
   edit form in sync with the database on every change, and saves whichever
/* ============================================================================
   EDIT FOOD / WORKOUT
   ----------------------------------------------------------------------------
   Tracked rows are identified by their sheet row id. The client stores the
   staging objects in global state (S.foodEdit / S.workoutEdit), keeps the
   edit form in sync with the database on every change, and saves whichever
   fields are actually filled in — everything else is left untouched.
   ========================================================================== */

function openFoodEdit() {
  const panel = $('#food-edit-panel');
  const ed = S.foodEdit;
  if (!ed) return;
  panel.classList.remove('hidden');
  $('#food-edit-food').value = ed.orig.food;
  $('#food-edit-qty').value = ed.orig.qty;
  $('#food-edit-unit').value = ed.orig.unit;
  $('#food-edit-cal').value = ed.orig.calories;
  $('#food-edit-pro').value = ed.orig.protein;
  $('#food-edit-carbs').value = ed.orig.carbs;
  $('#food-edit-fat').value = ed.orig.fat;
  $('#food-edit-save').onclick = () => saveFoodEdit();
  $('#food-edit-clear').onclick = () => { S.foodEdit = null; panel.classList.add('hidden'); };
  $('#food-edit-cancel').onclick = () => { S.foodEdit = null; panel.classList.add('hidden'); };
}

function closeFoodEdit() {
  S.foodEdit = null;
  $('#food-edit-panel').classList.add('hidden');
}

async function saveFoodEdit() {
  const ed = S.foodEdit;
  if (!ed) return;
  const btn = $('#food-edit-save');
  btn.disabled = true;
  try {
    const body = { rowId: ed.rowId };
    const food = $('#food-edit-food').value.trim();
    if (food) body.food = food;
    const qty = parseFloat($('#food-edit-qty').value);
    if (isFinite(qty)) body.qty = qty;
    const unit = $('#food-edit-unit').value.trim();
    if (unit) body.unit = unit;
    const cal = parseFloat($('#food-edit-cal').value);
    if (isFinite(cal)) body.calories = cal;
    const pro = parseFloat($('#food-edit-pro').value);
    if (isFinite(pro)) body.protein = pro;
    const carbs = parseFloat($('#food-edit-carbs').value);
    if (isFinite(carbs)) body.carbs = carbs;
    const fat = parseFloat($('#food-edit-fat').value);
    if (isFinite(fat)) body.fat = fat;
    if (Object.keys(body).length <= 1) { toast('Nothing to change', 'warn'); return; }
    await api('edit.food', body);
    // Sync the whole sheet back into state so the rings update.
    await load();
    closeFoodEdit();
    toast('Food updated');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

function openWorkoutEdit() {
  const panel = $('#workout-edit-panel');
  const ed = S.workoutEdit;
  if (!ed) return;
  S.workoutEditPanelOpen = true;
  $('#workout-edit-muscles').classList.remove('hidden');
  panel.classList.remove('hidden');
  $('#workout-edit-name').value = ed.orig.name;
  $('#workout-edit-dur').value = ed.orig.durationMin;
  $('#workout-edit-ex').value = ed.orig.exercises;
  S.workoutEditMuscles = new Set(ed.orig.muscles || []);
  $('#workout-edit-muscles').innerHTML = Object.keys(MUSCLE_LABELS).map(m =>
    `<button type="button" class="chip ${S.workoutEditMuscles.has(m) ? 'on' : ''}" data-mus="${m}">${MUSCLE_LABELS[m]}</button>`).join('');
  $('#workout-edit-save').onclick = () => saveWorkoutEdit();
  $('#workout-edit-clear').onclick = () => { closeWorkoutEdit(); };
  $('#workout-edit-cancel').onclick = () => { closeWorkoutEdit(); };
}

function closeWorkoutEdit() {
  S.workoutEditPanelOpen = false;
  S.workoutEdit = null;
  $('#workout-edit-panel').classList.add('hidden');
  $('#workout-edit-muscles').classList.add('hidden');
}

async function saveWorkoutEdit() {
  const ed = S.workoutEdit;
  if (!ed) return;
  const btn = $('#workout-edit-save');
  btn.disabled = true;
  try {
    const body = { rowId: ed.rowId };
    const name = $('#workout-edit-name').value.trim();
    if (name) body.name = name;
    const dur = parseInt($('#workout-edit-dur').value, 10);
    if (isFinite(dur)) body.durationMin = dur;
    const ex = $('#workout-edit-ex').value.trim();
    if (ex) body.exercises = ex;
    // Muscle groups: chips are toggled client-side into S.workoutEditMuscles
    const muscles = Array.from(S.workoutEditMuscles || new Set());
    if (!muscles.length) { toast('Pick at least one muscle group', 'warn'); return; }
    body.muscles = muscles;
    if (Object.keys(body).length <= 1) { toast('Nothing to change', 'warn'); return; }
    await api('edit.workout', body);
    // Sync the whole sheet back into state so the rings + muscle map update.
    await load();
    closeWorkoutEdit();
    toast('Workout updated');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

/* ============================================================================
   Autocomplete (library)
   ========================================================================== */

function showAc(inputEl, listEl, matches, onPick) {
  const el = $(listEl);
  if (!matches.length) { el.classList.add('hidden'); return; }
  S.acMatches = matches;
  S.acIndex = -1;
  el.classList.remove('hidden');
  el.innerHTML = matches.map((f, i) => `
    <button class="ac-item" data-ac="${i}">
      <span class="nm">${esc(f.name)}</span>
      <span class="mt">${fmt(f.calories)} kcal / ${f.refAmount} ${esc(f.refUnit)} · P ${f.protein}</span>
    </button>`).join('');
  el.onclick = (e) => {
    const b = e.target.closest('[data-ac]');
    if (b) onPick(S.acMatches[+b.dataset.ac]);
  };
}

function hideAc(listEl) { $(listEl).classList.add('hidden'); }

function filterLibrary(q) {
  if (!S.data) return [];
  const t = q.toLowerCase().trim();
  if (!t) return S.data.foods.slice(0, 8);
  const starts = [], contains = [];
  S.data.foods.forEach(f => {
    const fn = f.name.toLowerCase();
    if (fn.indexOf(t) === 0) starts.push(f);
    else if (fn.indexOf(t) !== -1) contains.push(f);
  });
  return starts.concat(contains).slice(0, 8);
}

/* ============================================================================
   WORKOUT
   ========================================================================== */

function buildMuscleChips() {
  const el = $('#wk-muscles');
  el.innerHTML = Object.keys(MUSCLE_LABELS).map(m =>
    `<span class="chip" data-mus="${m}">${MUSCLE_EMOJI[m] || ''} ${MUSCLE_LABELS[m]}</span>`).join('');
}

function toggleMuscle(m) {
  if (S.muscles.has(m)) S.muscles.delete(m); else S.muscles.add(m);
  $('#wk-muscles').querySelector(`[data-mus="${m}"]`).classList.toggle('on', S.muscles.has(m));
}

/** Move a muscle toggle between the workout log form and an edit panel. */
function swapMuscleSet(sourceEl, targetEl) {
  const chips = sourceEl.querySelectorAll('[data-mus]');
  chips.forEach(function (chip) {
    const m = chip.dataset.mus;
    const on = chip.classList.contains('on');
    const targetChip = targetEl.querySelector(`[data-mus="${m}"]`);
    if (targetChip) {
      targetChip.classList.toggle('on', on);
      if (on) { S.workoutEditMuscles.add(m); } else { S.workoutEditMuscles.delete(m); }
    }
  });
}

/** A local fallback also works before a newer Apps Script version is deployed. */
function activityMuscleTargets(text) {
  if (/\bfenc(?:ing|ed)\b/i.test(text || '')) return ['quads', 'glutes', 'hamstrings', 'calves',
    'forearms', 'front-delts', 'side-delts', 'triceps', 'biceps', 'abs', 'obliques'];
  return [];
}

function applyDetectedWorkout(result, text) {
  const targets = [...new Set([...(result.muscles || []), ...activityMuscleTargets(text)]
    .flatMap(m => m === 'shoulders' ? ['front-delts', 'side-delts', 'rear-delts'] : [m]))]
    .filter(m => Object.prototype.hasOwnProperty.call(MUSCLE_LABELS, m));
  if (!targets.length) return false;
  S.muscles = new Set(targets);
  $('#wk-muscles').querySelectorAll('[data-mus]').forEach(c => c.classList.toggle('on', S.muscles.has(c.dataset.mus)));
  if (!$('#wk-name').value) $('#wk-name').value = result.workoutName || (activityMuscleTargets(text).length ? 'Fencing' : '');
  if (result.durationMin && !$('#wk-dur').value) $('#wk-dur').value = result.durationMin;
  return true;
}

async function autoDetectWorkout() {
  const text = $('#wk-input').value.trim();
  if (!text) return;
  const fallback = activityMuscleTargets(text);
  if (fallback.length) applyDetectedWorkout({}, text);
  if (!S.url) return;
  try {
    const r = await api('parse', { text: text });
    if ($('#wk-input').value.trim() !== text) return;
    if (r.kind === 'workout' || fallback.length) {
      if (applyDetectedWorkout(r, text)) toast('Targets: ' + Array.from(S.muscles).map(m => MUSCLE_LABELS[m]).join(', '), 'ok');
      else toast('No muscle targets detected — select the groups you used', 'warn');
    } else if (r.kind === 'food' && r.foods && r.foods.length) {
      toast('That is food — switch to the Food tab', 'warn');
    }
  } catch (e) {
    if (fallback.length && $('#wk-input').value.trim() === text) toast('Fencing targets selected — review the muscle groups before saving', 'ok');
  }
}

async function saveWorkout() {
  if (!S.muscles.size) { toast('Pick at least one muscle group', 'warn'); return; }
  const btn = $('#wk-save');
  btn.disabled = true;
  try {
    await api('log.workout', {
      name: $('#wk-name').value.trim() || 'Workout',
      exercises: $('#wk-input').value.trim(),
      durationMin: parseInt($('#wk-dur').value, 10) || 0,
      muscles: Array.from(S.muscles)
    });
    toast('Workout saved — nice work 💪');
    S.muscles.clear();
    document.querySelectorAll('[data-mus]').forEach(c => c.classList.remove('on'));
    $('#wk-input').value = ''; $('#wk-name').value = ''; $('#wk-dur').value = '';
    await load();
  } catch (e) {
    toast(e.message, 'err');
  } finally { btn.disabled = false; }
}

/* ============================================================================
   Wiring
   ========================================================================== */

function switchTab(name) {
  if (!document.getElementById('panel-' + name)) name = 'today';
  // Activity-bar icons carry data-tab; keep every row in sync with the panel.
  $$('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'panel-' + name));
  saveSetting(LS.tab, name);
  if (S.data) drawCharts(S.data);
}

function bind() {
  // tabs — delegated on document so the activity-bar icons switch panels.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) switchTab(b.dataset.tab);
  });

  $$('[data-goto]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.goto)));

  // header
  $('#refresh-btn').addEventListener('click', () => {
    const i = $('#refresh-icon');
    i.classList.add('spin');
    load().finally(() => i.classList.remove('spin'));
  });

  // settings
  $('#settings-btn').addEventListener('click', () => {
    $('#api-url-input').value = S.url;
    $('#api-key-input').value = S.key;
    renderNotifyStatus(S.data && N() ? N().buildPlan(S.data, new Date(), notifyOpts()) : null);
    $('#settings-modal').classList.remove('hidden');
  });
  $('#close-settings').addEventListener('click', () => $('#settings-modal').classList.add('hidden'));
  $('#settings-modal').addEventListener('click', (e) => {
    if (e.target.id === 'settings-modal') $('#settings-modal').classList.add('hidden');
  });
  $('#save-settings-btn').addEventListener('click', async () => {
    const nextUrl = $('#api-url-input').value.trim();
    try {
      const parsedUrl = new URL(nextUrl);
      if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'script.google.com' || !/^\/macros\/s\/[^/]+\/exec$/.test(parsedUrl.pathname)) throw new Error();
    } catch (e) { toast('Enter a Google Apps Script web app URL ending in /exec', 'warn'); return; }
    S.url = nextUrl;
    S.key = $('#api-key-input').value.trim();
    saveSetting(LS.url, S.url);
    saveSetting(LS.key, S.key);
    $('#settings-modal').classList.add('hidden');
    await load();
  });

  // food
  $('#food-parse').addEventListener('click', parseFood);
  $('#food-add').addEventListener('click', logParsed);
  $('#food-photo').addEventListener('change', onPhotoPicked);
  $('#photo-clear').addEventListener('click', clearPhoto);
  $('#food-input').addEventListener('input', (e) => {
    const q = e.target.value;
    if (q.length < 1) { hideAc('#food-ac'); return; }
    showAc('#food-input', '#food-ac', filterLibrary(q), (f) => {
      S.parsed = [fromLibrary(f)];
      $('#food-input').value = f.name;
      hideAc('#food-ac');
      renderParsed();
      toast('Loaded from library — no AI needed', 'ok');
    });
  });
  $('#food-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); parseFood(); }
  });
  $('#lib-search').addEventListener('input', () => S.data && renderLibrary(S.data));

  // parsed-item editing
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.mac !== undefined && t.dataset.i !== undefined) {
      const it = S.parsed[+t.dataset.i];
      if (it) {
        const v = parseFloat(t.value) || 0;
        it[t.dataset.mac] = v;
        // Keep the reference macros in sync so quantity changes still rescale.
        const k = it.refAmount ? (it.qty / it.refAmount) : 0;
        if (k) it.per[t.dataset.mac] = round1(v / k);
        const s = totalOf(S.parsed);
        setParsedTotals(s);
      }
    }
    if (t.dataset.qty !== undefined) {
      const it = S.parsed[+t.dataset.qty];
      if (it) {
        it.qty = parseFloat(t.value) || 0;
        recompute(it);
        renderParsed();
      }
    }
  });
  document.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { S.parsed.splice(+rm.dataset.rm, 1); renderParsed(); }
  });

  // body map
  $('#body-window').addEventListener('change', applyBodyWindow);

  // body map tooltips
  const tip = $('#bm-tip');
  document.addEventListener('mouseover', (e) => {
    const g = e.target.closest('.bm-region, .bm-key');
    if (!g) return;
    const box = g.getBoundingClientRect();
    tip.textContent = g.dataset.tip || g.textContent.trim();
    tip.style.left = (box.left + box.width / 2) + 'px';
    tip.style.top = box.top + 'px';
    tip.classList.add('on');
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('.bm-region, .bm-key')) tip.classList.remove('on');
  });

  // workout
  buildMuscleChips();
  $('#wk-muscles').addEventListener('click', (e) => {
    const c = e.target.closest('[data-mus]');
    if (c) {
      toggleMuscle(c.dataset.mus);
      // If an edit panel is open, mirror the toggle into it too.
      if (S.workoutEditPanelOpen) swapMuscleSet($('#wk-muscles'), $('#workout-edit-muscles'));
    }
  });
  $('#workout-edit-muscles').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-mus]');
    if (!chip) return;
    const m = chip.dataset.mus;
    if (S.workoutEditMuscles.has(m)) S.workoutEditMuscles.delete(m); else S.workoutEditMuscles.add(m);
    chip.classList.toggle('on', S.workoutEditMuscles.has(m));
  });
  $('#wk-photo').addEventListener('change', onWkPhotoPicked);
  $('#wk-photo-clear').addEventListener('click', clearWkPhoto);
  $('#wk-estimate').addEventListener('click', estimateWorkoutMuscles);
  $('#wk-save').addEventListener('click', saveWorkout);
  let wkTimer;
  $('#wk-input').addEventListener('input', () => {
    clearTimeout(wkTimer);
    wkTimer = setTimeout(autoDetectWorkout, 900);
  });

  // expense
  $('#ex-save').addEventListener('click', async () => {
    const amount = parseFloat($('#ex-amount').value);
    if (!amount) { toast('Enter an amount', 'warn'); return; }
    try {
      await api('log.expense', {
        amount: amount,
        category: $('#ex-cat').value,
        merchant: $('#ex-merchant').value.trim()
      });
      toast('Expense saved');
      $('#ex-amount').value = ''; $('#ex-merchant').value = '';
      await load();
    } catch (e) { toast(e.message, 'err'); }
  });

  // study
  $$('[data-quick]').forEach(b => b.addEventListener('click', () => { $('#st-min').value = b.dataset.quick; }));
  $('#st-save').addEventListener('click', async () => {
    const mins = parseInt($('#st-min').value, 10);
    if (!mins) { toast('Enter minutes', 'warn'); return; }
    try {
      await api('log.study', { subject: $('#st-subject').value.trim() || 'Study', minutes: mins });
      toast('Session saved');
      $('#st-subject').value = ''; $('#st-min').value = '';
      await load();
    } catch (e) { toast(e.message, 'err'); }
  });

  // tasks
  $('#task-save').addEventListener('click', async () => {
    const task = $('#task-input').value.trim();
    if (!task) { toast('Type a task', 'warn'); return; }
    try {
      await api('task.add', { task: task, due: $('#task-due').value.trim(), priority: $('#task-prio').value });
      toast('Task added');
      $('#task-input').value = ''; $('#task-due').value = '';
      await load();
    } catch (e) { toast(e.message, 'err'); }
  });
  $('#task-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#task-save').click(); }
  });

  // shopping list
  $('#shop-add').addEventListener('click', addShoppingItem);
  $('#shop-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addShoppingItem(); }
  });

  // classes
  // calendar
  // NB: `$`/`$$` are file-level helpers — do NOT redeclare them here: a const
  // in this scope puts the outer ones in the temporal dead zone and every
  // earlier $(...) call in bind() throws, silently killing all wiring.

  $('#cal-prev').addEventListener('click', () => {
    if (S.calendar.view === 'month') {
      S.calendar.start = new Date(S.calendar.start.getFullYear(), S.calendar.start.getMonth() - 1, 1);
    } else if (S.calendar.view === 'week') {
      S.calendar.start.setDate(S.calendar.start.getDate() - 7);
    } else {
      S.calendar.start.setDate(S.calendar.start.getDate() - 1);
    }
    S.calendar.end = null;
    renderCalendar();
  });
  $('#cal-next').addEventListener('click', () => {
    if (S.calendar.view === 'month') {
      S.calendar.start = new Date(S.calendar.start.getFullYear(), S.calendar.start.getMonth() + 1, 1);
    } else if (S.calendar.view === 'week') {
      S.calendar.start.setDate(S.calendar.start.getDate() + 7);
    } else {
      S.calendar.start.setDate(S.calendar.start.getDate() + 1);
    }
    S.calendar.end = null;
    renderCalendar();
  });
  $('#cal-view-month').addEventListener('click', () => {
    S.calendar.view = 'month';
    $('#cal-view-group').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.id === 'cal-view-month'));
    renderCalendar();
  });
  $('#cal-view-week').addEventListener('click', () => {
    S.calendar.view = 'week';
    $('#cal-view-group').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.id === 'cal-view-week'));
    renderCalendar();
  });
  $('#cal-view-day').addEventListener('click', () => {
    S.calendar.view = 'day';
    $('#cal-view-group').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.id === 'cal-view-day'));
    renderCalendar();
  });
  $('#cal-add').addEventListener('click', () => {
    $('#cal-add-sheet').classList.remove('hidden');
  });
  $('#cal-add-sheet-close').addEventListener('click', () => {
    $('#cal-add-sheet').classList.add('hidden');
  });
  $('#cal-add-sheet').addEventListener('click', (e) => {
    if (e.target.id === 'cal-add-sheet') $('#cal-add-sheet').classList.add('hidden');
  });
  $('#cl-save').addEventListener('click', async () => {
    if (!$('#cl-subject').value.trim()) { toast('Enter a subject', 'warn'); return; }
    try {
      const date = new Date();
      const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf($('#cl-day').value);
      date.setDate(date.getDate() + (weekday - date.getDay() + 7) % 7);
      const metadata = { date: dayBucket(date), repeat: $('#cl-repeat').value, endTime: $('#cl-end').value.trim(), color: $('#cl-color').value };
      const remind = $('#cl-notify').checked;
      const saved = await api('class.add', {
        day: $('#cl-day').value,
        time: $('#cl-time').value.trim(),
        subject: $('#cl-subject').value.trim(),
        room: $('#cl-room').value.trim(),
        notes: JSON.stringify(metadata)
      });
      if (remind && saved.rowId) { const marks = readMarks(); marks.add(saved.rowId); saveMarks(marks); }
      $('#cal-add-sheet').classList.add('hidden');
      $('#cl-notify').checked = false;
      toast('Class added');
      $('#cl-subject').value = ''; $('#cl-time').value = ''; $('#cl-end').value = '';
      $('#cl-room').value = ''; $('#cl-repeat').value = 'never'; $('#cl-color').value = 'cyan';
      await load();
      renderCalendar();
    } catch (e) { toast(e.message, 'err'); }
  });
  $('#cl-add-cancel').addEventListener('click', () => {
    $('#cal-add-sheet').classList.add('hidden');
  });

  // Clicking a day row in the week list opens that day's blocks.
  document.addEventListener('click', (e) => {
    const row = e.target.closest('[data-date]');
    if (!row || e.target.closest('[data-cal-mark]')) return;
    const parts = String(row.dataset.date).split('-').map(Number);
    if (parts.length !== 3 || !parts[0]) return;
    S.calendar.view = 'day';
    S.calendar.start = new Date(parts[0], parts[1] - 1, parts[2]);
    S.calendar.end = null;
    $('#cal-view-group').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.id === 'cal-view-day'));
    renderCalendar();
  });

  // goals
  $('#g-save').addEventListener('click', async () => {
    try {
      await api('goals.save', {
        calories: $('#g-cal').value, protein: $('#g-pro').value,
        carbs: $('#g-carb').value, fat: $('#g-fat').value,
        studyMinutes: $('#g-study').value, monthBudget: $('#g-budget').value,
        currency: $('#g-currency').value.trim()
      });
      ['#g-cal', '#g-pro', '#g-carb', '#g-fat', '#g-study', '#g-budget', '#g-currency'].forEach(id => delete $(id).dataset.touched);
      toast('Goals updated');
      await load();
    } catch (e) { toast(e.message, 'err'); }
  });

  // generic delegated actions: ticks + deletes + library pick + row edits
  document.addEventListener('click', async (e) => {
    const tick = e.target.closest('[data-task]');
    if (tick) {
      tick.classList.toggle('on');
      try { await api('task.toggle', { rowId: +tick.dataset.task }); await load(); }
      catch (err) { toast(err.message, 'err'); }
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      try {
        await api('entry.delete', { sheet: del.dataset.del, rowId: +del.dataset.row });
        toast('Deleted');
        await load();
      } catch (err) { toast(err.message, 'err'); }
      return;
    }
    const lib = e.target.closest('[data-lib]');
    if (lib) {
      const f = JSON.parse(lib.dataset.lib);
      S.parsed = [fromLibrary(f)];
      renderParsed();
      switchTab('food');
      toast(f.name + ' ready to log', 'ok');
    }
    const edit = e.target.closest('[data-edit-sheet]');
    if (edit) {
      const sheet = edit.dataset.editSheet;
      const row = +edit.dataset.editRow;
      let item = null;
      if (sheet === 'Nutrition') {
        item = S.data && S.data.nutrition.recent.find(i => i.rowId === row);
      } else {
        item = S.workouts.find(w => w.rowId === row);
      }
      if (!item) { toast('Could not locate this entry', 'err'); return; }
      if (sheet === 'Nutrition') {
        S.foodEdit = { rowId: row, orig: item };
        openFoodEdit();
      } else {
        S.workoutEdit = { rowId: row, orig: item };
        openWorkoutEdit();
      }
      await load();
    }
    const editWork = e.target.closest('[data-edit-workout]');
    if (editWork) {
      const row = +editWork.dataset.editWorkout;
      let item = S.workouts.find(w => w.rowId === row);
      if (!item) { toast('Could not locate this workout', 'err'); return; }
      S.workoutEdit = { rowId: row, orig: item };
      openWorkoutEdit();
    }
  });

  // backend tests
  $('#test-btn').addEventListener('click', async () => {
    try { const r = await api('ping'); toast('Backend OK · ' + r.now.slice(0, 19), 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  });
  $('#gemin-test').addEventListener('click', async () => {
    // Show which model answered: a fallback model serving your traffic is worth
    // knowing about, and it makes "it works" verifiable at a glance.
    try { const r = await api('gemini.test'); toast('Gemini OK: ' + r.response + (r.model ? ' · ' + r.model : ''), 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  });

  // goals inputs should stop render() from stomping on edits
  ['#g-cal', '#g-pro', '#g-carb', '#g-fat', '#g-study', '#g-budget', '#g-currency']
    .forEach(s => $(s).addEventListener('input', () => { $(s).dataset.touched = '1'; }));

  // notifications
  $('#notify-enable').addEventListener('click', enableNotifications);
  $('#notify-test').addEventListener('click', sendTestNotification);
  $('#notify-off').addEventListener('click', disableNotifications);

  // calendar notify marks
  const nfOnly = $('#nf-only');
  if (nfOnly) {
    nfOnly.checked = notifyOnlyMarked();
    nfOnly.addEventListener('change', () => {
      setNotifyOnly(nfOnly.checked);
      toast(nfOnly.checked ? 'Only marked blocks will remind you' : 'Every class will remind you', 'ok');
      syncNotifications();
    });
  }
  const markAllBtn = $('#mark-all-notify');
  if (markAllBtn) {
    markAllBtn.addEventListener('click', () => {
      const classes = (S.data && S.data.classes) || [];
      if (!classes.length) { toast('No classes to mark', 'warn'); return; }
      const marks = readMarks();
      const all = classes.every(c => marks.has(Number(c.rowId)));
      marks.clear();
      if (!all) classes.forEach(c => marks.add(Number(c.rowId)));
      saveMarks(marks);
      renderCalendar();
      syncNotifications();
      toast(all ? 'All blocks unmarked' : 'All blocks marked for 15-min reminders', 'ok');
    });
  }
  const markClear = $('#cal-mark-clear');
  if (markClear) {
    markClear.addEventListener('click', () => {
      saveMarks(new Set());
      renderCalendar();
      syncNotifications();
      toast('Marks cleared', 'ok');
    });
  }
  // Bell toggle on a class block (day view / month / week)
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cal-mark]');
    if (!b) return;
    const id = Number(b.dataset.calMark);
    const marks = readMarks();
    if (marks.has(id)) marks.delete(id); else marks.add(id);
    saveMarks(marks);
    renderCalendar();
    syncNotifications();
    toast(marks.has(id) ? 'Reminder set — 15 min before' : 'Reminder removed', 'ok');
  });

  // install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('#install-btn2').classList.remove('hidden');
    const b = $('#install-btn2');
    b.onclick = async () => {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      b.classList.add('hidden');
    };
  });
}

let deferredPrompt = null;

/* ============================================================================
   Notifications
   ========================================================================== */

const N = () => (typeof TPNotify !== 'undefined' ? TPNotify : null);

function notifyEnabled() {
  const n = N();
  return !!n && n.supported() && n.permission() === 'granted' && readSetting(n.LS_NOTIFY.on) !== '0';
}

/** Paint the settings panel so it always reflects real permission state. */
function renderNotifyStatus(plan) {
  const n = N();
  const status = $('#notify-status');
  const upcoming = $('#notify-upcoming');
  const off = $('#notify-off');
  if (!n || !status) return;

  if (!n.supported()) {
    status.textContent = 'This browser cannot show notifications.';
    $('#notify-enable').disabled = true;
    $('#notify-test').disabled = true;
    off.classList.add('hidden');
    return;
  }

  const perm = n.permission();
  if (perm === 'denied') {
    status.textContent = 'Blocked. Re-allow notifications for this site in your browser settings, then reload.';
    $('#notify-enable').textContent = 'Enable reminders';
    $('#notify-enable').disabled = true;
    $('#notify-test').disabled = true;
    off.classList.add('hidden');
  } else if (perm === 'default') {
    status.textContent = n.capability();
    $('#notify-enable').disabled = false;
    $('#notify-test').disabled = true;
    off.classList.add('hidden');
  } else {
    status.textContent = 'On. ' + n.capability();
    $('#notify-enable').disabled = true;
    $('#notify-test').disabled = false;
    off.classList.remove('hidden');
  }

  if (upcoming) {
    if (!plan || !plan.length) {
      upcoming.textContent = notifyEnabled() ? 'No upcoming reminders.' : '';
    } else {
      const next = plan.slice(0, 3).map((p) =>
        p.at.toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
      );
      upcoming.textContent = 'Next: ' + next.join(' · ');
    }
  }
}

/** Rebuild reminders from the freshest state and refresh the settings panel. */
async function syncNotifications() {
  const n = N();
  if (!n) return;
  if (!notifyEnabled()) {
    renderNotifyStatus(null);
    return;
  }
  try {
    const opts = notifyOpts();
    const plan = n.buildPlan(S.data, new Date(), opts);
    await n.reschedule(S.data, opts);
    renderNotifyStatus(plan);
  } catch (e) {
    if (e && e.name !== 'NotAllowedError') console.warn('notify reschedule failed', e);
    renderNotifyStatus(null);
  }
}

async function enableNotifications() {
  const n = N();
  if (!n) return;
  const perm = await n.request();
  if (perm === 'granted') {
    try { localStorage.setItem(n.LS_NOTIFY.on, '1'); } catch (e) { /* ignore */ }
    toast('Reminders on', 'ok');
    await syncNotifications();
    const shown = await n.show('Reminders are on', 'Task due times, classes and goal checks will ping you.',
      { tag: 'tp-test', url: './?tab=tasks' });
    if (!shown) toast('Permission granted, but the browser refused to display it', 'warn');
  } else {
    toast('Notifications were blocked', 'warn');
    renderNotifyStatus(null);
  }
}

async function disableNotifications() {
  const n = N();
  if (!n) return;
  await n.disable();
  toast('Reminders off', 'ok');
  renderNotifyStatus(null);
}

async function sendTestNotification() {
  const n = N();
  if (!n) return;
  const shown = await n.show('ThirdPerspective test',
    'Notifications are wired up correctly.', { tag: 'tp-test', url: './?tab=tasks' });
  toast(shown ? 'Test sent — check your device' : 'The browser refused to display it', shown ? 'ok' : 'warn');
}

/* ============================================================================
   Boot
   ========================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
  lucide.createIcons();
  bind();
  bindChat();
  switchTab(readSetting(LS.tab) || 'today');

  const now = new Date();
  $('#current-date').textContent = now.toLocaleDateString('en-US',
    { weekday: 'long', month: 'long', day: 'numeric' });

  // Register service worker for offline/PWA install
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // A tapped reminder asks us to jump to the tab it came from.
  navigator.serviceWorker?.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg && msg.type === 'tp-goto' && msg.tab) switchTab(msg.tab);
  });

  renderNotifyStatus(null);

  if (S.url) {
    const restored = restoreDashboard();
    await load({ background: restored });
  }
  else { switchTab('today'); $('#settings-modal').classList.remove('hidden'); }
});


const CHAT = {messages:[], image:null, busy:false, recognition:null, recording:false, until:0, scope:null, older:[]};
function chatStorageKey() { return 'gt.chat.'+S.url+'|'+S.key; }
function renderChat() {
  $('#chat-messages').innerHTML = CHAT.messages.map(m => '<div class="chat-message '+(m.role==='user'?'chat-user':'chat-assistant')+'"><strong>'+ (m.role==='user'?'You':'Assistant')+'</strong><p>'+esc(m.text)+'</p></div>').join('');
  $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
  saveSetting(chatStorageKey(),JSON.stringify(CHAT.messages.slice(-60)));
}
function renderChanges() {
  const changes = [...(S.data?.changes || []),...CHAT.older].filter((c,i,list)=>list.findIndex(x=>x.id===c.id)===i);
  $$('[data-change-panel]').forEach(el => {
    const panel = el.dataset.changePanel;
    const list=changes.filter(c=>panel==='all'||c.panel===panel|| (panel==='Tasks' && c.panel==='Goals')).slice(0,panel==='all'?changes.length:12);
    el.innerHTML=list.length?list.map(c=>'<div class="change-row"><span>'+esc(c.summary)+'<small>'+esc(new Date(c.time).toLocaleString())+'</small></span><button class="btn btn-ghost btn-sm" data-undo-change="'+esc(c.id)+'" '+(c.undone?'disabled':'')+'>'+(c.undone?'Undone':'Undo')+'</button></div>').join(''):'<p class="text-sm text-slate-400">No saved changes yet.</p>';
  });
}
function stopDictation() {
  CHAT.recording=false; clearTimeout(CHAT.timer);
  if(CHAT.recognition)CHAT.recognition.stop();
  $('#chat-mic').textContent='Start dictation';$('#chat-mic').setAttribute('aria-pressed','false');
}
function startDictation() {
  if(CHAT.recording){stopDictation();return;}
  const Recognition=window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!Recognition){$('#chat-status').textContent='Voice dictation is unavailable in this browser. Use your keyboard’s microphone or type here.';return;}
  const r=new Recognition(); CHAT.recognition=r; CHAT.recording=true;CHAT.until=Date.now()+5*60*1000;
  r.continuous=true;r.interimResults=true;r.lang=navigator.language || 'en-US';
  r.onresult=e=>{
    for(let i=e.resultIndex;i<e.results.length;i++)if(e.results[i].isFinal)$('#chat-input').value+= ( $('#chat-input').value?' ':'')+e.results[i][0].transcript;
    $('#chat-status').textContent='Listening… '+Array.from(e.results).filter(x=>!x.isFinal).map(x=>x[0].transcript).join(' ');
  };
  r.onerror=e=>{CHAT.recording=false;$('#chat-status').textContent='Dictation stopped: '+e.error+'. You can still edit and send your text.';stopDictation();};
  r.onend=()=>{if(CHAT.recording && Date.now()<CHAT.until){try{r.start();}catch(e){stopDictation();}}else stopDictation();};
  try{r.start();CHAT.timer=setTimeout(stopDictation,5*60*1000);$('#chat-mic').textContent='Stop dictation';$('#chat-mic').setAttribute('aria-pressed','true');$('#chat-status').textContent='Listening for up to five minutes. Stop and review before sending.';}catch(e){stopDictation();$('#chat-status').textContent=e.message;}
}
async function sendChat(e) {
  e?.preventDefault();if(CHAT.busy)return;
  if(!S.data?.capabilities?.assistantUndo){$('#chat-status').textContent='Update and redeploy Code.js in Apps Script, then refresh, to enable chat with undo.';return;}
  if(CHAT.scope!==chatStorageKey()){CHAT.messages=[];CHAT.older=[];CHAT.scope=chatStorageKey();renderChat();}
  stopDictation();const text=$('#chat-input').value.trim();if(!text&&!CHAT.image)return;
  CHAT.busy=true;$('#chat-send').disabled=true;$('#chat-input').readOnly=true;['chat-image','chat-mic','chat-photo-clear'].forEach(id=>$('#'+id).disabled=true);$('#chat-status').textContent='Reading your report and saving changes…';
  const history=CHAT.messages.slice(-8).map(m=>({role:m.role,text:m.text}));
  const image=CHAT.image;
  try{
    const scope=CHAT.scope;
    const r=await api('chat',{message:text,image,history});
    if(scope!==chatStorageKey())throw new Error('Backend settings changed while processing. Review the original backend’s history.');
    CHAT.messages.push({role:'user',text:text+(image?'\n[Photo attached]':'')});
    const changed=r.changes || r.applied || [];
    const lines=[r.reply || 'No changes were recorded.',r.question && r.question!==r.reply?r.question:'',changed.length?'Saved changes:\n'+changed.map(x=>'• '+x).join('\n'):'No changes saved.',r.failed?.length?'Could not save:\n'+r.failed.join('\n'):''];
    CHAT.messages.push({role:'assistant',text:lines.filter(Boolean).join('\n\n')});renderChat();
    $('#chat-input').value='';clearChatPhoto();
    await load({background:true});
    $('#chat-status').textContent='Report processed. Review the change history or undo in the relevant panel.';
  }catch(err){$('#chat-status').textContent=err.message+' Your message is still here. If the connection dropped, refresh and review history before retrying.';}
  finally{CHAT.busy=false;$('#chat-send').disabled=false;$('#chat-input').readOnly=false;['chat-image','chat-mic','chat-photo-clear'].forEach(id=>$('#'+id).disabled=false);}
}
function clearChatPhoto(){CHAT.image=null;$('#chat-image').value='';$('#chat-photo').removeAttribute('src');$('#chat-photo-preview').classList.add('hidden');}
function bindChat() {
  CHAT.scope=chatStorageKey();
  try{const saved=JSON.parse(readSetting(chatStorageKey())||'[]');if(Array.isArray(saved))CHAT.messages=saved.filter(m=>m && ['user','assistant'].includes(m.role)&&typeof m.text==='string').slice(-60);}catch(e){}
  renderChat();
  const panels={today:'all',food:'Nutrition',body:'Workouts',money:'Expenses',study:'Study',tasks:'Tasks',more:'Classes'};
  Object.entries(panels).forEach(([tab,panel])=>{const card=document.createElement('div');card.className='glass-card rounded-3xl p-6 space-y-3';card.innerHTML='<h3 class="font-bold">Recent changes · Undo</h3><div data-change-panel="'+panel+'"></div><button class="btn btn-ghost btn-sm" data-tab="chat">View full change history</button>';$('#panel-'+tab).appendChild(card);});
  // Goals can be reverted alongside their settings.
  const goalCard=document.createElement('div');goalCard.dataset.changePanel='Goals';$('#panel-more').appendChild(goalCard);
  $('#chat-form').addEventListener('submit',sendChat);$('#chat-mic').addEventListener('click',startDictation);
  $('#chat-photo-clear').addEventListener('click',clearChatPhoto);
  $('#chat-image').addEventListener('change',e=>{const file=e.target.files?.[0];if(!file)return;if(!file.type.startsWith('image/')){toast('Choose an image','err');return;}const reader=new FileReader();reader.onerror=()=>toast('Could not read image','err');reader.onload=()=>preparePhoto(reader.result,image=>{CHAT.image=image;$('#chat-photo').src=image;$('#chat-photo-preview').classList.remove('hidden');});reader.readAsDataURL(file);});
  document.addEventListener('click',async e=>{const btn=e.target.closest('[data-undo-change]');if(!btn)return;btn.disabled=true;try{await api('changes.undo',{id:btn.dataset.undoChange});CHAT.older.forEach(c=>{if(c.id===btn.dataset.undoChange)c.undone=true;});await load({background:true});toast('Change undone','ok');}catch(err){toast(err.message,'err');btn.disabled=false;}});
  $('#chat-history-more').addEventListener('click',async()=>{const btn=$('#chat-history-more');btn.disabled=true;try{const r=await api('changes.list',{offset:100+CHAT.older.length});CHAT.older.push(...r.changes);renderChanges();btn.classList.toggle('hidden',!r.more);}catch(e){toast(e.message,'err');}finally{btn.disabled=false;}});
  window.addEventListener('pagehide',stopDictation);
}
