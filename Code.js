/**
 * ============================================================================
 *  GOAL TRACKER - GOOGLE APPS SCRIPT BACKEND (JSON API)
 * ============================================================================
 *  This file is the *server*. The PWA in /web is a static client that calls
 *  this endpoint. It never talks to Google or Gemini directly.
 *
 *  Why Apps Script instead of Vercel?
 *    - 100% free, no build step, no environment variables to manage
 *    - Keeps the Gemini API key server-side (a Netlify/Vercel client would
 *      expose it to anyone who opens devtools)
 *
 *  API shape (POST JSON, or GET with ?action= for reads):
 *    { action: 'state' }                        -> full dashboard payload
 *    { action: 'parse', text: '2 eggs and rice' }
 *    { action: 'log.food', items: [...] }
 *    { action: 'log.expense', amount, category, merchant, notes }
 *    { action: 'log.workout', name, exercises, durationMin, muscles[] }
 *    { action: 'log.study', subject, minutes }
 *    { action: 'task.add' | 'task.toggle' | 'task.delete' }
 *    { action: 'class.add' | 'class.delete' }
 *    { action: 'entry.delete', sheet, rowId }
 *    { action: 'goals.save', calories, protein, budget, currency }
 *    { action: 'gemini.test' }
 * ============================================================================
 */

// ------------------------------------------------------------------------------
// CONFIG - only non-secret values live here
// ------------------------------------------------------------------------------
const CONFIG = {
  DAILY_CALORIE_GOAL: 2000,
  DAILY_PROTEIN_GOAL: 140,
  DAILY_CARB_GOAL: 250,
  DAILY_FAT_GOAL: 70,
  DAILY_STUDY_GOAL_MIN: 120,
  MONTHLY_SPEND_BUDGET: 30000000,
  CURRENCY_SYMBOL: 'toman',
  TIMEZONE: 'Asia/Tehran',
  GEMINI_MODEL: 'gemini-2.5-flash'
};

// Script Properties (Project Settings -> Script Properties):
//   GEMINI_API_KEY  = your AI Studio key  (required for natural language logging)
//   APP_KEY         = optional shared secret. If set, every request must send
//                     it, otherwise the URL is open to anyone who finds it.
const KEYS = {
    GEMINI: "GEMINI_API_KEY",
    APP: "APP_KEY",
    GOALS: "tracker_goals",
};

const SHEETS = {
  NUTRITION: 'Nutrition',
  FOODS: 'Foods',
  EXPENSES: 'Expenses',
  WORKOUTS: 'Workouts',
  STUDY: 'Study',
  TASKS: 'Tasks',
  CLASSES: 'Classes'
};

const SCHEMAS = [
  { name: SHEETS.NUTRITION, headers: ['Timestamp', 'Date', 'Food', 'Qty', 'Unit', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Source'] },
  { name: SHEETS.FOODS, headers: ['Key', 'Name', 'Per Amount', 'Per Unit', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Uses', 'Updated'] },
  { name: SHEETS.EXPENSES, headers: ['Timestamp', 'Date', 'Amount', 'Category', 'Merchant', 'Source', 'Notes'] },
  { name: SHEETS.WORKOUTS, headers: ['Timestamp', 'Date', 'Name', 'Exercises', 'Duration (min)', 'Muscles', 'Notes'] },
  { name: SHEETS.STUDY, headers: ['Timestamp', 'Date', 'Subject', 'Duration (min)', 'Notes'] },
  { name: SHEETS.TASKS, headers: ['Created', 'Task', 'Due', 'Status', 'Completed', 'Priority'] },
  { name: SHEETS.CLASSES, headers: ['Day', 'Time', 'Subject', 'Room', 'Notes'] }
];

/** Canonical muscle groups. Order matters: it drives the body map legend. */
const MUSCLES = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms',
  'abs', 'obliques', 'glutes', 'quads', 'hamstrings', 'calves'
];

/** Exercise -> muscle keyword hints used by the local (non-AI) workout parser. */
const MUSCLE_KEYWORDS = {
  chest: ['bench', 'chest', 'fly', 'pec', 'pushup', 'push-up', 'dip', 'cable fly', 'decline'],
  back: ['lat', 'pull', 'row', 'pulldown', 'pull-up', 'pullup', 'chin', 'deadlift', 'back', 'shrug'],
  shoulders: ['shoulder', 'overhead press', 'lateral raise', 'front raise', 'arnold', 'delt'],
  biceps: ['bicep', 'curl', 'hammer', 'preacher'],
  triceps: ['tricep', 'pushdown', 'push-down', 'skullcrusher', 'extension', 'dip'],
  forearms: ['forearm', 'wrist', 'grip', 'farmer'],
  abs: ['abs', 'crunch', 'sit-up', 'situp', 'plank', 'leg raise', 'toe touch', 'hollow', 'cable crunch'],
  obliques: ['oblique', 'side plank', 'woodchop', 'russian', 'twist'],
  glutes: ['glute', 'glute bridge', 'hip thrust', 'squat', 'kettlebell swing', 'clamshell', 'lunge', 'split squat'],
  quads: ['squat', 'leg press', 'lunge', 'leg extension', 'quad', 'hack squat', 'bulgarian'],
  hamstrings: ['hamstring', 'rdl', 'romanian', 'leg curl', 'nordic', 'hip hinge', 'good morning'],
  calves: ['calf', 'calves', 'raise', 'seated calf', 'standing calf']
};

// ============================================================================
// SETUP
// ============================================================================

/** Run once from the Apps Script editor. Creates + formats all tabs. */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  SCHEMAS.forEach(function (schema) {
    let sheet = ss.getSheetByName(schema.name);
    if (!sheet) sheet = ss.insertSheet(schema.name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(schema.headers);
      sheet.getRange(1, 1, 1, schema.headers.length).setFontWeight('bold');
      sheet.getRange(1, 1, 1, schema.headers.length).setBackground('#F3F4F6');
      sheet.setFrozenRows(1);
    }
  });
  SpreadsheetApp.flush();
  return 'Sheets ready: ' + SCHEMAS.map(function (s) { return s.name; }).join(', ');
}

/** Health check. Open the /exec URL in a browser: you should see JSON. */
function doGet(e) {
  const params = (e && e.parameter) || {};
  return json(dispatch(params));
}

/**
 * Main entry point. Accepts a JSON body. Answers with JSON and permissive CORS
 * so the static PWA can call it from any origin.
 */
function doPost(e) {
  let body = {};
  try {
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: 'Invalid JSON body' });
  }
  if (e && e.parameter && e.parameter.action && !body.action) {
    body = e.parameter;
  }
  return json(dispatch(body));
}

/** JSON response with CORS headers so the PWA on Netlify can read it. */
function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// ROUTER
// ============================================================================

function dispatch(req) {
  const action = String(req.action || 'state');
  try {
    if (action !== 'ping' && action !== 'gemini.test' && !isAuthorized(req)) {
      return { ok: false, error: 'Unauthorized: bad or missing appKey' };
    }
    const handler = ROUTES[action];
    if (!handler) return { ok: false, error: 'Unknown action: ' + action };
    return handler(req);
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

const ROUTES = {
  'ping': function () { return { ok: true, pong: true, now: new Date().toISOString() }; },
  'state': getState,
  'parse': parseAction,
  'gemini.test': function () { return geminiTest(); },
  'log.food': function (r) { return logFood(r); },
  'food.cache': function (r) { return cacheFood(r); },
  'food.search': function (r) { return searchFoods(r); },
  'log.expense': function (r) { return logExpense(r); },
  'log.workout': function (r) { return logWorkout(r); },
  'log.study': function (r) { return logStudy(r); },
  'task.add': function (r) { return addTask(r); },
  'task.toggle': function (r) { return toggleTask(r); },
  'task.delete': function (r) { return deleteRow(SHEETS.TASKS, r.rowId); },
  'class.add': function (r) { return addClass(r); },
  'class.delete': function (r) { return deleteRow(SHEETS.CLASSES, r.rowId); },
  'entry.delete': function (r) { return deleteEntry(r); },
  'goals.save': function (r) { return saveGoals(r); }
};

function isAuthorized(req) {
  const expected = PropertiesService.getScriptProperties().getProperty(KEYS.APP);
  if (!expected) return true; // key not configured -> open endpoint
  return String(req.appKey || '') === expected;
}

// ============================================================================
// STATE - one call powers the whole dashboard
// ============================================================================

function getState() {
  const goals = getGoals();
  return {
    ok: true,
    now: new Date().toISOString(),
    today: todayStr(),
    goals: goals,
    nutrition: nutritionState(),
    foods: foodCache(),
    expenses: expenseState(goals),
    workouts: workoutState(),
    study: studyState(),
    tasks: taskState(),
    classes: classState()
  };
}

function nutritionState() {
  const sheet = getSheet(SHEETS.NUTRITION);
  const rows = sheet ? sheet.getDataRange().getValues() : [];
  const today = todayStr();

  let cal = 0, pro = 0, carb = 0, fat = 0;
  const week = {};
  for (let i = 7; i >= 0; i--) week[dateOffset(-i)] = { calories: 0, protein: 0, carbs: 0, fat: 0 };

  const recent = [];
  for (let i = rows.length - 1; i >= 1; i--) {
    const d = rowDateStr(rows[i][1]);
    const rec = {
      rowId: i + 1,
      date: d,
      food: rows[i][2],
      qty: num(rows[i][3]),
      unit: rows[i][4],
      calories: num(rows[i][5]),
      protein: num(rows[i][6]),
      carbs: num(rows[i][7]),
      fat: num(rows[i][8])
    };
    if (d === today) {
      cal += rec.calories; pro += rec.protein; carb += rec.carbs; fat += rec.fat;
    }
    if (week[d]) {
      week[d].calories += rec.calories;
      week[d].protein += rec.protein;
      week[d].carbs += rec.carbs;
      week[d].fat += rec.fat;
    }
    if (recent.length < 40) recent.push(rec);
  }

  return {
    today: { calories: cal, protein: pro, carbs: carb, fat: fat },
    week: week,
    recent: recent
  };
}

function foodCache() {
  const sheet = getSheet(SHEETS.FOODS);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  const out = [];
  for (let i = rows.length - 1; i >= 1; i--) {
    if (!rows[i][0]) continue;
    out.push({
      key: rows[i][0],
      name: rows[i][1],
      refAmount: num(rows[i][2]) || 100,
      refUnit: rows[i][3] || 'g',
      calories: num(rows[i][4]),
      protein: num(rows[i][5]),
      carbs: num(rows[i][6]),
      fat: num(rows[i][7]),
      uses: num(rows[i][8])
    });
  }
  return out;
}

function expenseState(goals) {
  const sheet = getSheet(SHEETS.EXPENSES);
  const rows = sheet ? sheet.getDataRange().getValues() : [];
  const today = todayStr();
  const month = today.slice(0, 7);

  let todayTotal = 0, monthTotal = 0;
  const byCategory = {};
  const recent = [];

  for (let i = rows.length - 1; i >= 1; i--) {
    const d = rowDateStr(rows[i][1]);
    const amount = num(rows[i][2]);
    const category = rows[i][3] || 'Miscellaneous';
    if (d === today) todayTotal += amount;
    if (d.slice(0, 7) === month) {
      monthTotal += amount;
      byCategory[category] = (byCategory[category] || 0) + amount;
    }
    if (recent.length < 30) {
      recent.push({ rowId: i + 1, date: d, amount: amount, category: category, merchant: rows[i][4] || '', source: rows[i][5] || '' });
    }
  }

  return {
    todayTotal: todayTotal,
    monthTotal: monthTotal,
    monthBudget: goals.monthBudget,
    byCategory: byCategory,
    recent: recent
  };
}

function workoutState() {
  const sheet = getSheet(SHEETS.WORKOUTS);
  const rows = sheet ? sheet.getDataRange().getValues() : [];
  const today = todayStr();
  const todayList = [];
  const recent = [];
  const muscleLast = {};
  const muscleCount7 = {};
  MUSCLES.forEach(function (m) { muscleLast[m] = null; muscleCount7[m] = 0; });

  for (let i = rows.length - 1; i >= 1; i--) {
    const d = rowDateStr(rows[i][1]);
    const muscles = splitList(rows[i][5]);
    const rec = {
      rowId: i + 1,
      date: d,
      name: rows[i][2],
      exercises: rows[i][3],
      durationMin: num(rows[i][4]),
      muscles: muscles
    };

    muscles.forEach(function (m) {
      if (muscleLast[m] === null || d > muscleLast[m]) muscleLast[m] = d;
      if (daysBetween(d, today) <= 6) muscleCount7[m] += 1;
    });

    if (d === today) todayList.push(rec);
    if (recent.length < 30) recent.push(rec);
  }

  const muscleStatus = {};
  MUSCLES.forEach(function (m) {
    const last = muscleLast[m];
    const daysAgo = last ? daysBetween(last, today) : null;
    muscleStatus[m] = {
      trained: daysAgo !== null && daysAgo <= 6,
      daysAgo: daysAgo,
      sessions7d: muscleCount7[m],
      stale: daysAgo !== null && daysAgo > 13
    };
  });

  return { today: todayList, recent: recent, muscleStatus: muscleStatus };
}

function studyState() {
  const sheet = getSheet(SHEETS.STUDY);
  const rows = sheet ? sheet.getDataRange().getValues() : [];
  const today = todayStr();
  const week = {};
  for (let i = 6; i >= 0; i--) week[dateOffset(-i)] = 0;

  let todayMins = 0;
  const recent = [];
  for (let i = rows.length - 1; i >= 1; i--) {
    const d = rowDateStr(rows[i][1]);
    const mins = num(rows[i][3]);
    if (d === today) todayMins += mins;
    if (week[d] !== undefined) week[d] += mins;
    if (recent.length < 30) recent.push({ rowId: i + 1, date: d, subject: rows[i][2], minutes: mins });
  }
  return { todayMinutes: todayMins, week: week, recent: recent };
}

function taskState() {
  const sheet = getSheet(SHEETS.TASKS);
  const rows = sheet ? sheet.getDataRange().getValues() : [];
  const out = [];
  for (let i = rows.length - 1; i >= 1; i--) {
    if (!rows[i][1]) continue;
    out.push({
      rowId: i + 1,
      task: rows[i][1],
      due: rows[i][2],
      status: rows[i][3] || 'Pending',
      completed: rows[i][4],
      priority: rows[i][5] || 'Normal'
    });
  }
  return out;
}

function classState() {
  const sheet = getSheet(SHEETS.CLASSES);
  const rows = sheet ? sheet.getDataRange().getValues() : [];
  const out = [];
  for (let i = rows.length - 1; i >= 1; i--) {
    if (!rows[i][2]) continue;
    out.push({ rowId: i + 1, day: rows[i][0], time: rows[i][1], subject: rows[i][2], room: rows[i][3] || '' });
  }
  return out;
}

// ============================================================================
// NATURAL LANGUAGE PARSING (Gemini, with a free local fallback)
// ============================================================================

/**
 * Understands a free-text line and returns foods or a workout.
 * Food macros are normalised per `perAmount perUnit` so the cache entry can be
 * reused at any quantity without ever calling the AI again.
 */
function parseAction(req) {
  const text = String(req.text || '').trim();
  if (!text) return { ok: false, error: 'Nothing to parse' };
  if (getGeminiKey()) return parseWithGemini(text);
  return { ok: true, source: 'local', ...parseLocally(text) };
}

function geminiTest() {
  if (!getGeminiKey()) return { ok: false, error: 'GEMINI_API_KEY is not set in Script Properties' };
  const res = callGemini(
    'Reply with the single word: OK',
    { type: 'object', properties: { ok: { type: 'string' } }, required: ['ok'] }
  );
  return res.ok
    ? { ok: true, model: CONFIG.GEMINI_MODEL, response: res.data }
    : { ok: false, error: res.error };
}

const PARSE_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['food', 'workout', 'study', 'expense', 'task', 'unknown'] },
    foods: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          qty: { type: 'number' },
          unit: { type: 'string' },
          calories: { type: 'number' },
          protein: { type: 'number' },
          carbs: { type: 'number' },
          fat: { type: 'number' },
          refAmount: { type: 'number' },
          refUnit: { type: 'string' }
        },
        required: ['name', 'qty', 'unit', 'calories', 'protein', 'carbs', 'fat', 'refAmount', 'refUnit']
      }
    },
    workoutName: { type: 'string' },
    durationMin: { type: 'number' },
    muscles: { type: 'array', items: { type: 'string', enum: MUSCLES } },
    subject: { type: 'string' },
    amount: { type: 'number' },
    category: { type: 'string' },
    merchant: { type: 'string' },
    task: { type: 'string' },
    due: { type: 'string' },
    confidence: { type: 'number' }
  },
  required: ['kind']
};

function parseWithGemini(text) {
  const prompt =
    'You are a nutrition and fitness logging engine for a personal tracker.\n\n' +
    'TASK: read the user line and extract the log entry.\n\n' +
    'NUTRITION RULES (critical - getting these wrong ruins the numbers):\n' +
    '1. `qty` and `unit` must describe the portion the USER actually described,\n' +
    '   using the user\'s own words. "2 eggs" -> qty 2, unit "egg".\n' +
    '   "150g chicken" -> qty 150, unit "g". "a slice of pizza" -> qty 1, unit "slice".\n' +
    '2. `calories`, `protein`, `carbs`, `fat` are the macros FOR THAT SERVING ONLY,\n' +
    '   i.e. for `qty` of `unit`. 2 large eggs ~= 144 kcal total, NOT 143.\n' +
    '3. `refAmount` / `refUnit` describe a single reference portion used to store this\n' +
    '   food in a reusable library. For anything weighed or measured in g/ml use\n' +
    '   refUnit "g" and refAmount 100. For countable items (egg, slice, banana, bowl,\n' +
    '   can, cup, piece) use refUnit equal to the same word you used in `unit` and\n' +
    '   refAmount 1. A user who typed "2 eggs" must later be able to type "3 eggs".\n' +
    '4. Split compound sentences into separate food items and keep each item\'s macros\n' +
    '   scoped to its own portion.\n' +
    '5. Set kind="unknown" if the line is not a food, workout, study, expense or task.\n\n' +
    'WORKOUT RULES:\n' +
    '- muscles must be chosen from: ' + MUSCLES.join(', ') + '.\n' +
    '- Be generous: barbell back squat also trains quads, glutes, hamstrings.\n' +
    '- durationMin is the session length in minutes; use 0 if not stated.\n\n' +
    'Return JSON only.\n\n' +
    'USER LINE: ' + text;

  const res = callGemini(prompt, PARSE_SCHEMA);
  if (!res.ok) return { ok: true, source: 'local-fallback', geminiError: res.error, ...parseLocally(text) };

  const d = res.data || {};
  const out = { ok: true, source: 'gemini', kind: d.kind || 'unknown' };

  if (out.kind === 'food' && d.foods && d.foods.length) {
    out.foods = d.foods.map(serveFood);
  }
  if (out.kind === 'workout') {
    out.workoutName = d.workoutName || 'Workout';
    out.durationMin = num(d.durationMin);
    out.muscles = normaliseMuscles(d.muscles);
    out.exercises = text;
  }
  if (out.kind === 'study') { out.subject = d.subject || 'Study'; out.minutes = num(d.durationMin) || 30; }
  if (out.kind === 'expense') { out.amount = num(d.amount); out.category = d.category || 'Miscellaneous'; out.merchant = d.merchant || ''; }
  if (out.kind === 'task') { out.task = d.task || text; out.due = d.due || ''; }

  if (out.kind === 'unknown' || out.kind === 'food') {
    if (!out.foods) Object.assign(out, parseLocally(text), { source: out.source });
  }
  return out;
}

/** No-AI fallback: enough for simple, unambiguous lines. */
function parseLocally(text) {
  const t = text.toLowerCase();
  if (/\b(bench|squat|deadlift|pushup|push-up|pull-?up|curl|press|raise|workout|run|row|lunge|plank)\b/.test(t) ||
      /\d+\s?(kg|lbs)\b/.test(t)) {
    return { kind: 'workout', workoutName: text.slice(0, 40), durationMin: 0, muscles: detectMuscles(text), exercises: text };
  }
  if (/^\s*(study|studied|read|revise)\b/.test(t)) {
    const m = text.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)/i);
    let mins = 30;
    if (m) mins = m[2].toLowerCase().charAt(0) === 'h' ? Math.round(parseFloat(m[1]) * 60) : Math.round(parseFloat(m[1]));
    return { kind: 'study', subject: text.replace(/^\s*\S+\s+/, ''), minutes: mins };
  }
  if (/^\s*(spent|paid|bought)\b/.test(t) || /^\d[\d,.]*\s*(toman|irr|rial|usd|\$|€|£)\b/i.test(t)) {
    const m = text.replace(/^\s*(spent|paid|bought)\s+/i, '').match(/([\d,.]+)/);
    if (m) return { kind: 'expense', amount: parseFloat(m[1].replace(/,/g, '')), category: detectCategory(text), merchant: '' };
  }
  if (/^\s*(task|todo|remember)\b/.test(t)) {
    return { kind: 'task', task: text.replace(/^\s*\S+\s+/, ''), due: '' };
  }
  // Assume food.
  return { kind: 'food', foods: localFoodStub(text) };
}

function localFoodStub(text) {
  // No macro data available offline - the UI prompts the user to fill it in.
  // Shape matches serveFood() so the client handles both identically.
  const qtyMatch = text.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  const qty = qtyMatch ? parseFloat(qtyMatch[1]) : 1;
  const name = (qtyMatch ? qtyMatch[2] : text).trim() || 'Food';
  return [serveFood({
    name: name, qty: qty, unit: 'serving',
    refAmount: 1, refUnit: 'serving',
    calories: 0, protein: 0, carbs: 0, fat: 0
  })].map(function (f) { f.estimated = true; return f; });
}

function callGemini(prompt, schema) {
  const key = getGeminiKey();
  if (!key) return { ok: false, error: 'No GEMINI_API_KEY' };
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    CONFIG.GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(key);
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      responseSchema: schema
    }
  };
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    const text = res.getContentText();
    if (res.getResponseCode() !== 200) return { ok: false, error: 'HTTP ' + res.getResponseCode() + ': ' + text.slice(0, 400) };
    const jsonOut = JSON.parse(text);
    const part = jsonOut.candidates && jsonOut.candidates[0] && jsonOut.candidates[0].content &&
      jsonOut.candidates[0].content.parts && jsonOut.candidates[0].content.parts[0];
    if (!part) return { ok: false, error: 'Empty response: ' + text.slice(0, 300) };
    return { ok: true, data: JSON.parse(part.text) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ============================================================================
// WRITES
// ============================================================================
// logFood() and cacheFood() are defined further down, next to serveFood(),
// because they share the serving-vs-reference macro model.

/** Server-side prefix search so the client can offer instant autocomplete. */
function searchFoods(req) {
  const q = String(req.q || '').toLowerCase().trim();
  const all = foodCache();
  if (!q) return { ok: true, matches: all.slice(0, 25) };
  const starts = [], contains = [];
  all.forEach(function (f) {
    if (f.name.toLowerCase().indexOf(q) === 0) starts.push(f);
    else if (f.name.toLowerCase().indexOf(q) !== -1) contains.push(f);
  });
  return { ok: true, matches: starts.concat(contains).slice(0, 25) };
}

function logExpense(req) {
  const amount = num(req.amount);
  if (!amount) return { ok: false, error: 'Amount required' };
  const now = new Date();
  const rowId = append(SHEETS.EXPENSES, [now, todayStr(), amount,
    req.category || 'Miscellaneous', req.merchant || '', req.source || 'Manual', req.notes || '']);
  return { ok: true, rowId: rowId, state: expenseState(getGoals()) };
}

function logWorkout(req) {
  const muscles = normaliseMuscles(req.muscles);
  if (!muscles.length) return { ok: false, error: 'Pick at least one muscle group' };
  const now = new Date();
  const rowId = append(SHEETS.WORKOUTS, [now, todayStr(), req.name || 'Workout',
    req.exercises || '', num(req.durationMin), muscles.join(','), req.notes || '']);
  return { ok: true, rowId: rowId, muscles: muscles, state: workoutState() };
}

function logStudy(req) {
  const mins = num(req.minutes);
  if (!mins) return { ok: false, error: 'Minutes required' };
  const now = new Date();
  const rowId = append(SHEETS.STUDY, [now, todayStr(), req.subject || 'Study', mins, req.notes || '']);
  return { ok: true, rowId: rowId, todayMinutes: studyState().todayMinutes };
}

function addTask(req) {
  if (!req.task) return { ok: false, error: 'Task text required' };
  const rowId = append(SHEETS.TASKS, [todayStr(), req.task, req.due || '', 'Pending', '', req.priority || 'Normal']);
  return { ok: true, rowId: rowId, tasks: taskState() };
}

function toggleTask(req) {
  const sheet = getSheet(SHEETS.TASKS);
  const row = num(req.rowId);
  if (row < 2 || row > sheet.getLastRow()) return { ok: false, error: 'Bad rowId' };
  const done = sheet.getRange(row, 4).getValue() === 'Completed';
  sheet.getRange(row, 4).setValue(done ? 'Pending' : 'Completed');
  sheet.getRange(row, 5).setValue(done ? '' : todayStr());
  return { ok: true, tasks: taskState() };
}

function addClass(req) {
  if (!req.subject) return { ok: false, error: 'Subject required' };
  const rowId = append(SHEETS.CLASSES, [req.day || 'Monday', req.time || '', req.subject, req.room || '', req.notes || '']);
  return { ok: true, rowId: rowId, classes: classState() };
}

function deleteRow(sheetName, rowId) {
  const sheet = getSheet(sheetName);
  const row = num(rowId);
  if (row < 2 || row > sheet.getLastRow()) return { ok: false, error: 'Bad rowId' };
  sheet.deleteRow(row);
  return { ok: true, sheet: sheetName };
}

function deleteEntry(req) {
  const allowed = [SHEETS.NUTRITION, SHEETS.EXPENSES, SHEETS.WORKOUTS, SHEETS.STUDY, SHEETS.TASKS, SHEETS.CLASSES];
  if (allowed.indexOf(req.sheet) === -1) return { ok: false, error: 'Not deletable' };
  return deleteRow(req.sheet, req.rowId);
}

function saveGoals(req) {
  const goals = getGoals();
  const next = {
    calories: num(req.calories) || goals.calories,
    protein: num(req.protein) || goals.protein,
    carbs: num(req.carbs) || goals.carbs,
    fat: num(req.fat) || goals.fat,
    studyMinutes: num(req.studyMinutes) || goals.studyMinutes,
    monthBudget: num(req.monthBudget) || goals.monthBudget,
    currency: req.currency || goals.currency
  };
  PropertiesService.getScriptProperties().setProperty(KEYS.GOALS, JSON.stringify(next));
  return { ok: true, goals: next };
}

function getGoals() {
  const raw = PropertiesService.getScriptProperties().getProperty(KEYS.GOALS);
  const base = {
    calories: CONFIG.DAILY_CALORIE_GOAL,
    protein: CONFIG.DAILY_PROTEIN_GOAL,
    carbs: CONFIG.DAILY_CARB_GOAL,
    fat: CONFIG.DAILY_FAT_GOAL,
    studyMinutes: CONFIG.DAILY_STUDY_GOAL_MIN,
    monthBudget: CONFIG.MONTHLY_SPEND_BUDGET,
    currency: CONFIG.CURRENCY_SYMBOL
  };
  if (!raw) return base;
  try { return Object.assign(base, JSON.parse(raw)); } catch (e) { return base; }
}

// ============================================================================
// HELPERS
// ============================================================================

function getSheet(name) {
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) { setupSheets(); sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }
  return sheet;
}

function append(sheetName, row) {
  const sheet = getSheet(sheetName);
  sheet.appendRow(row);
  SpreadsheetApp.flush();
  return sheet.getLastRow();
}

function getGeminiKey() {
  return (PropertiesService.getScriptProperties().getProperty(KEYS.GEMINI) || '').trim();
}

function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(String(v).replace(/[,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function round1(n) { return Math.round(n * 10) / 10; }

function todayStr() { return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd'); }

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function rowDateStr(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  return String(v || '');
}

function daysBetween(a, b) {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  const da = Date.UTC(pa[0], pa[1] - 1, pa[2]);
  const db = Date.UTC(pb[0], pb[1] - 1, pb[2]);
  return Math.round((db - da) / 86400000);
}

function splitList(v) {
  if (!v) return [];
  return String(v).split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
}

function normaliseMuscles(list) {
  const out = [];
  (list || []).forEach(function (m) {
    const s = String(m).trim().toLowerCase();
    if (MUSCLES.indexOf(s) !== -1 && out.indexOf(s) === -1) out.push(s);
  });
  return out;
}

function detectMuscles(text) {
  const t = String(text).toLowerCase();
  const found = [];
  Object.keys(MUSCLE_KEYWORDS).forEach(function (muscle) {
    for (let i = 0; i < MUSCLE_KEYWORDS[muscle].length; i++) {
      if (t.indexOf(MUSCLE_KEYWORDS[muscle][i]) !== -1) { found.push(muscle); return; }
    }
  });
  return found;
}

function foodKey(name, unit) {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim() + '|' + String(unit || 'g').toLowerCase();
}

/**
 * Units that are genuinely measured. For these the library reference is
 * 100 of the same unit, so "150 g chicken" and "300 g chicken" both work.
 * For everything else the reference is 1 piece, so "2 eggs" -> "3 eggs" works.
 */
const WEIGHED_UNITS = /^(g|gr|gram|grams|gm|kg|mg|ml|millilitre|milliliter|millilitres|milliliters|l|litre|liter|litres|liters|oz|ounce|ounces|lb|lbs|pound|pounds|cl|dl)$/i;

function isWeighedUnit(unit) { return WEIGHED_UNITS.test(String(unit || '').trim()); }

/**
 * Convert a raw AI food into the two things the client needs:
 *   - the serving macros (what the user is about to eat)
 *   - `ref`, the reusable per-reference macros for the food library
 */
function serveFood(f) {
  const qty = num(f.qty) || 1;
  const unit = String(f.unit || 'serving').trim();
  const refUnit = String(f.refUnit || (isWeighedUnit(unit) ? 'g' : unit)).trim();
  const refAmount = num(f.refAmount) || (isWeighedUnit(unit) ? 100 : 1);
  const k = qty ? refAmount / qty : 0;

  const serving = {
    calories: round1(num(f.calories)),
    protein: round1(num(f.protein)),
    carbs: round1(num(f.carbs)),
    fat: round1(num(f.fat))
  };

  return {
    name: String(f.name || 'Food').trim(),
    qty: qty,
    unit: unit,
    calories: serving.calories,
    protein: serving.protein,
    carbs: serving.carbs,
    fat: serving.fat,
    ref: {
      amount: refAmount,
      unit: refUnit,
      calories: round1(serving.calories * k),
      protein: round1(serving.protein * k),
      carbs: round1(serving.carbs * k),
      fat: round1(serving.fat * k)
    }
  };
}

function logFood(req) {
  const items = (req.items || []).map(function (it) {
    return {
      food: it.name || 'Food',
      qty: num(it.qty),
      unit: it.unit || 'serving',
      // Macros are already scoped to this serving by the client.
      calories: round1(num(it.calories)),
      protein: round1(num(it.protein)),
      carbs: round1(num(it.carbs)),
      fat: round1(num(it.fat))
    };
  });
  if (!items.length) return { ok: false, error: 'No items' };

  const now = new Date();
  const date = todayStr();
  const sheet = getSheet(SHEETS.NUTRITION);
  items.forEach(function (it) {
    sheet.appendRow([now, date, it.food, it.qty, it.unit, it.calories, it.protein, it.carbs, it.fat, req.source || 'Manual']);
  });
  SpreadsheetApp.flush();

  return { ok: true, logged: items.length, items: items, today: nutritionState().today };
}

/**
 * Upsert the reusable food library.
 * Expects PER-REFERENCE macros: { name, refAmount, refUnit, calories, ... }.
 */
function cacheFood(req) {
  const items = req.items || [];
  if (!items.length) return { ok: true, cached: 0 };
  const sheet = getSheet(SHEETS.FOODS);
  const rows = sheet.getDataRange().getValues();
  const index = {};
  for (let i = 1; i < rows.length; i++) if (rows[i][0]) index[rows[i][0]] = i + 1;

  let n = 0;
  items.forEach(function (it) {
    const refUnit = it.refUnit || 'g';
    const key = foodKey(it.name, refUnit);
    const per = [num(it.calories), num(it.protein), num(it.carbs), num(it.fat)];
    if (index[key]) {
      const row = index[key];
      sheet.getRange(row, 5, 1, 6).setValues([[
        per[0], per[1], per[2], per[3],
        num(sheet.getRange(row, 9).getValue()) + 1,
        new Date()
      ]]);
    } else {
      sheet.appendRow([key, it.name, num(it.refAmount) || 100, refUnit,
        per[0], per[1], per[2], per[3], 1, new Date()]);
      index[key] = sheet.getLastRow();
    }
    n++;
  });
  SpreadsheetApp.flush();
  return { ok: true, cached: n };
}

const CATEGORIES = {
  'Food & Dining': ['coffee', 'cafe', 'starbucks', 'mcdonald', 'burger', 'pizza', 'restaurant', 'lunch', 'dinner', 'breakfast', 'snack', 'food', 'kfc', 'bakery', 'donut', 'noodles'],
  'Groceries': ['grocery', 'supermarket', 'market', 'hypermarket', 'vegetable', 'fruit'],
  'Transportation': ['uber', 'lyft', 'taxi', 'metro', 'bus', 'train', 'fuel', 'petrol', 'gas station', 'parking'],
  'Subscriptions': ['netflix', 'spotify', 'apple', 'google', 'youtube', 'github', 'prime', 'patreon', 'chatgpt', 'openai'],
  'Shopping': ['amazon', 'ebay', 'aliexpress', 'zara', 'h&m', 'clothing', 'shoes', 'electronics', 'digikala'],
  'Health & Fitness': ['gym', 'fitness', 'pharmacy', 'medicine', 'doctor', 'supplement', 'protein powder'],
  'Education': ['course', 'book', 'udemy', 'coursera', 'tuition', 'university', 'class'],
  'Utilities & Bills': ['electric', 'water', 'internet', 'wifi', 'mobile', 'phone', 'rent', 'bill', 'gas bill']
};

function detectCategory(text) {
  const t = String(text || '').toLowerCase();
  const keys = Object.keys(CATEGORIES);
  for (let i = 0; i < keys.length; i++) {
    for (let j = 0; j < CATEGORIES[keys[i]].length; j++) {
      if (t.indexOf(CATEGORIES[keys[i]][j]) !== -1) return keys[i];
    }
  }
  return 'Miscellaneous';
}
