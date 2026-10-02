/* ============================================================================
   ThirdPerspective - PWA client
   Talks to the Apps Script JSON API. No secrets live in this file.
   ========================================================================== */

const LS = {
  url: 'gt.apiUrl',
  key: 'gt.appKey',
  tab: 'gt.tab'
};

const S = {
  url: localStorage.getItem(LS.url) || '',
  key: localStorage.getItem(LS.key) || '',
  data: null,
  parsed: [],          // foods staged for logging
  muscles: new Set(),  // muscle groups picked in the workout form
  charts: {},
  acIndex: -1,
  acMatches: []
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, kind) {
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
  const body = Object.assign({ action: action, appKey: S.key }, payload || {});
  const res = await fetch(S.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
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

async function load() {
  if (!S.url) { setConn('bad', 'Not connected'); return; }
  setConn('busy', 'Syncing…');
  try {
    S.data = await api('state');
    localStorage.setItem(LS.url, S.url);
    setConn('ok', 'Connected');
    render();
    $('#conn-info').textContent = 'Connected · ' + (S.data.goals.currency || '');
    // Reminders are derived from state, so every sync rebuilds the schedule.
    syncNotifications();
  } catch (e) {
    setConn('bad', 'Connection failed');
    $('#conn-info').textContent = 'Error: ' + e.message;
    toast(e.message, 'err');
  }
}

function refreshSoon() { setTimeout(load, 120); }

/* ============================================================================
   RENDER
   ========================================================================== */

function render() {
  const d = S.data;
  if (!d) return;
  lucide.createIcons();
  renderRings(d);
  renderMetrics(d);
  renderTodayFoods(d);
  renderTasksInto('#today-tasks', d.tasks.filter(t => t.status !== 'Completed'), true);
  renderFoodLog(d);
  renderLibrary(d);
  renderBody(d);
  renderWorkoutLog(d);
  renderExpenses(d);
  renderStudy(d);
  renderTasks();
  renderClasses(d);
  renderGoals(d);
  drawCharts(d);
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

  // Update ring colors to match new branding
  $('#ring-calorie').style.color = 'rgba(34, 211, 238, 0.6)';
  $('#ring-protein').style.color = 'rgba(168, 85, 247, 0.6)';
  $('#ring-budget').style.color = 'rgba(245, 158, 11, 0.6)';
}

function renderMetrics(d) {
  const open = d.tasks.filter(t => t.status !== 'Completed').length;
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
      ${rowDelete('Nutrition', x.rowId)}
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
    const inWindow = Number.isFinite(days) && days <= max;
    g.classList.toggle('bm-out', !inWindow);
  });
  const note = $('#bm-window-note');
  if (note) note.textContent = 'Highlighted: trained in the last ' + (max + 1) + ' days';
}

function buildLegend(status) {
  const el = $('#bm-legend');
  el.innerHTML = Object.keys(status).map(k => {
    const m = status[k];
    const tone = muscleTone(m);
    const ago = m.daysAgo === null ? 'never' : (m.daysAgo === 0 ? 'today' : m.daysAgo + 'd');
    const color = getComputedStyle(document.documentElement)
      .getPropertyValue('--' + tone.replace('bm-', 'bm-')).trim() || '#2c3a50';
    return `<span class="bm-key" data-muscle="${k}">
      <span class="dot" style="background:${color}"></span>
      ${MUSCLE_LABELS[k] || k}
      <span class="ago">${ago}${m.sessions7d ? ' · ' + m.sessions7d + '×' : ''}</span>
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
        <div class="flex flex-wrap gap-1 mt-1">${(w.muscles || []).map(m =>
          `<span class="badge badge-cache">${esc(m)}</span>`).join('')}</div>
      </div>
      ${rowDelete('Workouts', w.rowId)}
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
  const open = S.data.tasks.filter(t => t.status !== 'Completed');
  const done = S.data.tasks.filter(t => t.status === 'Completed');
  $('#task-open').textContent = open.length;
  renderTasksInto('#task-open-list', open, false);
  renderTasksInto('#task-done-list', done, false);
}

function renderClasses(d) {
  const el = $('#cl-list');
  if (!d.classes.length) { el.innerHTML = '<div class="text-center py-6 text-sm text-slate-500">No classes yet</div>'; return; }
  el.innerHTML = d.classes.map(c => `
    <div class="list-row">
      <span class="badge badge-ai">${esc(c.day)}</span>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-slate-100">${esc(c.subject)}</div>
        <div class="text-[11px] text-slate-500 font-mono">${esc(c.time)} ${esc(c.room)}</div>
      </div>
      ${rowDelete('Classes', c.rowId)}
    </div>`).join('');
}

function renderGoals(d) {
  if ($('#g-cal').dataset.touched) return;
  $('#g-cal').value = d.goals.calories;
  $('#g-pro').value = d.goals.protein;
  $('#g-carb').value = d.goals.carbs;
  $('#g-fat').value = d.goals.fat;
  $('#g-study').value = d.goals.studyMinutes;
  $('#g-budget').value = d.goals.monthBudget;
  $('#g-currency').value = d.goals.currency || '';
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
        backgroundColor: ['#8B5CF6', '#FF5722', '#00E5FF', '#10B981', '#F59E0B', '#EF4444', '#60A5FA', '#F472B6'],
        borderColor: 'rgba(9,13,22,0.8)', borderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 10, font: { size: 10 } } },
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
    per: {
      calories: Number(per.calories) || 0,
      protein: Number(per.protein) || 0,
      carbs: Number(per.carbs) || 0,
      fat: Number(per.fat) || 0
    }
  };
  Object.assign(it, flags || {});
  recompute(it);
  return it;
}

/** Refresh the serving-level macros from qty x reference macros. */
function recompute(it) {
  const k = it.refAmount ? (it.qty / it.refAmount) : 0;
  it.calories = round1(it.per.calories * k);
  it.protein = round1(it.per.protein * k);
  it.carbs = round1(it.per.carbs * k);
  it.fat = round1(it.per.fat * k);
  return it;
}

/** Scale a library item to a quantity. No AI call. */
function fromLibrary(f, qty, unit) {
  return makeItem(f.name, qty === undefined || qty === null ? f.refAmount : qty,
    unit || f.refUnit, f, f.refAmount, f.refUnit, { cached: true });
}

/** Convert an item from the `parse` API into the staged shape. */
function fromApi(f) {
  const ref = f.ref || { amount: 1, unit: f.unit, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat };
  return makeItem(f.name, f.qty, f.unit, ref, ref.amount, ref.unit,
    { estimated: !!f.estimated });
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
        toast('That looks like a workout — logged in the Body tab instead', 'warn');
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
    renderParsed();
    await load();
  } catch (e) {
    toast(e.message, 'err');
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
  document.querySelector(`[data-mus="${m}"]`).classList.toggle('on', S.muscles.has(m));
}

async function autoDetectWorkout() {
  const text = $('#wk-input').value.trim();
  if (!text || !S.url) return;
  try {
    const r = await api('parse', { text: text });
    if (r.kind === 'workout') {
      S.muscles.clear();
      (r.muscles || []).forEach(m => S.muscles.add(m));
      document.querySelectorAll('[data-mus]').forEach(c =>
        c.classList.toggle('on', S.muscles.has(c.dataset.mus)));
      if (!$('#wk-name').value) $('#wk-name').value = r.workoutName || '';
      if (r.durationMin && !$('#wk-dur').value) $('#wk-dur').value = r.durationMin;
      toast('Detected: ' + (r.muscles || []).join(', '), 'ok');
    } else if (r.kind === 'food' && r.foods && r.foods.length) {
      toast('That is food — switch to the Food tab', 'warn');
    }
  } catch (e) { /* detection is best-effort */ }
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
  $$('#tabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'panel-' + name));
  localStorage.setItem(LS.tab, name);
  if (S.data) drawCharts(S.data);
}

function bind() {
  // tabs
  $('#tabs').addEventListener('click', (e) => {
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
    renderNotifyStatus(S.data ? (N() ? N().buildPlan(S.data, new Date()) : null) : null);
    $('#settings-modal').classList.remove('hidden');
  });
  $('#close-settings').addEventListener('click', () => $('#settings-modal').classList.add('hidden'));
  $('#settings-modal').addEventListener('click', (e) => {
    if (e.target.id === 'settings-modal') $('#settings-modal').classList.add('hidden');
  });
  $('#save-settings-btn').addEventListener('click', async () => {
    S.url = $('#api-url-input').value.trim();
    S.key = $('#api-key-input').value.trim();
    localStorage.setItem(LS.url, S.url);
    localStorage.setItem(LS.key, S.key);
    $('#settings-modal').classList.add('hidden');
    await load();
  });

  // food
  $('#food-parse').addEventListener('click', parseFood);
  $('#food-add').addEventListener('click', logParsed);
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
    if (c) toggleMuscle(c.dataset.mus);
  });
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

  // classes
  $('#cl-save').addEventListener('click', async () => {
    if (!$('#cl-subject').value.trim()) { toast('Enter a subject', 'warn'); return; }
    try {
      await api('class.add', {
        day: $('#cl-day').value, time: $('#cl-time').value.trim(),
        subject: $('#cl-subject').value.trim(), room: $('#cl-room').value.trim()
      });
      toast('Class added');
      $('#cl-subject').value = ''; $('#cl-time').value = ''; $('#cl-room').value = '';
      await load();
    } catch (e) { toast(e.message, 'err'); }
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
      toast('Goals updated');
      await load();
    } catch (e) { toast(e.message, 'err'); }
  });

  // generic delegated actions: ticks + deletes + library pick
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
  });

  // backend tests
  $('#test-btn').addEventListener('click', async () => {
    try { const r = await api('ping'); toast('Backend OK · ' + r.now.slice(0, 19), 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  });
  $('#gemin-test').addEventListener('click', async () => {
    try { const r = await api('gemini.test'); toast('Gemini OK: ' + r.response, 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  });

  // goals inputs should stop render() from stomping on edits
  ['#g-cal', '#g-pro', '#g-carb', '#g-fat', '#g-study', '#g-budget', '#g-currency']
    .forEach(s => $(s).addEventListener('input', () => { $(s).dataset.touched = '1'; }));

  // notifications
  $('#notify-enable').addEventListener('click', enableNotifications);
  $('#notify-test').addEventListener('click', sendTestNotification);
  $('#notify-off').addEventListener('click', disableNotifications);

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
  return !!n && n.supported() && n.permission() === 'granted';
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
    const plan = n.buildPlan(S.data, new Date());
    await n.reschedule(S.data);
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
  switchTab(localStorage.getItem(LS.tab) || 'today');

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

  if (S.url) await load();
  else { switchTab('today'); $('#settings-modal').classList.remove('hidden'); }
});
