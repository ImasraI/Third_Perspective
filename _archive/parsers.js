/**
 * Core parsing utilities for Telegram Tracker and Bank SMS
 * Compatible with Node.js and Google Apps Script (V8)
 */

// Category keyword mappings for auto-categorization
const CATEGORY_KEYWORDS = {
  'Food & Dining': ['coffee', 'cafe', 'starbucks', 'mcdonalds', 'burger', 'pizza', 'restaurant', 'lunch', 'dinner', 'breakfast', 'snack', 'food', 'subway', 'kfc', 'bakery'],
  'Groceries': ['grocery', 'supermarket', 'market', 'walmart', 'costco', 'trader joe', 'target', 'store', 'hypermarket'],
  'Transportation': ['uber', 'lyft', 'taxi', 'metro', 'bus', 'train', 'fuel', 'gas', 'petrol', 'parking'],
  'Subscriptions': ['netflix', 'spotify', 'apple', 'google', 'youtube', 'github', 'amazon prime', 'patreon', 'chatgpt', 'openai'],
  'Shopping': ['amazon', 'ebay', 'aliexpress', 'zara', 'h&m', 'clothes', 'shoes', 'electronics'],
  'Health & Fitness': ['gym', 'fitness', 'pharmacy', 'medicine', 'doctor', 'supplement', 'protein'],
  'Education': ['course', 'book', 'udemy', 'coursera', 'tuition', 'school', 'university'],
  'Utilities & Bills': ['electric', 'water', 'internet', 'wifi', 'phone', 'telecom', 'rent', 'bill']
};

/**
 * Auto-detect expense category from merchant or note keywords
 */
function detectCategory(text) {
  if (!text) return 'Miscellaneous';
  const lower = text.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return category;
      }
    }
  }
  return 'Miscellaneous';
}

/**
 * Parse /spent or natural spent command
 * Examples:
 *   /spent 15.50 lunch at subway
 *   spent $42 Amazon headphones
 *   spent 120 uber
 */
function parseSpent(text) {
  let clean = text.replace(/^\/?spent\b\s*/i, '').trim();
  if (!clean) return null;

  // Extract amount: handles optional currency signs ($, €, £, etc.) and commas
  const amountMatch = clean.match(/[$€£]?\s*([0-9]+(?:[.,][0-9]{1,2})?)/);
  if (!amountMatch) return null;

  const rawAmount = amountMatch[1].replace(',', '.');
  const amount = parseFloat(rawAmount);
  if (isNaN(amount)) return null;

  // Remaining text is merchant/description
  let desc = clean.replace(amountMatch[0], '').trim();
  desc = desc.replace(/^(at|for|on)\s+/i, '').trim();

  let merchant = desc || 'General';
  let category = detectCategory(desc);

  return {
    amount: amount,
    merchant: merchant,
    category: category,
    notes: desc
  };
}

/**
 * Parse /c, /cal, or natural Calorie & Nutrition command
 * Examples:
 *   /c 650 chicken and rice 45p
 *   c 350 2 eggs and toast
 *   650 chicken and rice 45p
 *   ate 500 burger 30p 45c 18f
 */
function parseCalories(text) {
  let clean = text.replace(/^\/?(calories|calorie|cal|c)\b\s*/i, '');
  clean = clean.replace(/^ate\s+/i, '').trim();
  if (!clean) return null;

  // Extract calories: first standalone number or number followed by 'cal' / 'kcal'
  let calories = 0;
  const calMatch = clean.match(/\b([0-9]+)\s*(?:cal|kcal)?\b/i);
  if (calMatch) {
    calories = parseInt(calMatch[1], 10);
    clean = clean.replace(calMatch[0], ' ');
  }

  // Extract macros: e.g. 45p, 50c, 15f
  let protein = 0;
  let carbs = 0;
  let fat = 0;

  const pMatch = clean.match(/\b([0-9]+)(?:g)?\s*p(?:rotein)?\b/i);
  if (pMatch) {
    protein = parseInt(pMatch[1], 10);
    clean = clean.replace(pMatch[0], ' ');
  }

  const cMatch = clean.match(/\b([0-9]+)(?:g)?\s*c(?:arbs?)?\b/i);
  if (cMatch) {
    carbs = parseInt(cMatch[1], 10);
    clean = clean.replace(cMatch[0], ' ');
  }

  const fMatch = clean.match(/\b([0-9]+)(?:g)?\s*f(?:at)?\b/i);
  if (fMatch) {
    fat = parseInt(fMatch[1], 10);
    clean = clean.replace(fMatch[0], ' ');
  }

  const meal = clean.replace(/\s+/g, ' ').trim() || 'Meal';

  return {
    calories: calories,
    protein: protein,
    carbs: carbs,
    fat: fat,
    meal: meal
  };
}

/**
 * Parse /w, workout, or natural workout command
 * Examples:
 *   /w Chest: Bench 80kg 4x10, Incline 30kg 3x12
 *   workout 45m 5km outdoor run
 */
function parseWorkout(text) {
  let clean = text.replace(/^\/?(workout|w)\b\s*/i, '').trim();
  if (!clean) return null;

  let duration = '';
  const durMatch = clean.match(/\b([0-9]+(?:\.[0-9]+)?)\s*(m|min|mins|h|hr|hrs|hours)\b/i);
  if (durMatch) {
    duration = durMatch[0];
    clean = clean.replace(durMatch[0], ' ');
  }

  clean = clean.replace(/\s+/g, ' ').trim();
  let type = 'Workout';
  let exercises = clean;

  const splitMatch = clean.match(/^([^:-]+)[:\-](.+)$/);
  if (splitMatch) {
    type = splitMatch[1].trim();
    exercises = splitMatch[2].trim();
  } else {
    const routineMatch = clean.match(/\b(push|pull|legs|leg day|chest|back|arms|shoulders|cardio|running|run|swim|cycling|hiit)\b/i);
    if (routineMatch) {
      type = routineMatch[0];
    }
  }

  return {
    type: type,
    exercises: exercises,
    duration: duration || 'N/A'
  };
}

/**
 * Parse /study or natural study command
 * Examples:
 *   /study 45m Physics chapter 4
 *   study 1.5h Linear Algebra
 */
function parseStudy(text) {
  let clean = text.replace(/^\/?(study|studied)\b\s*/i, '').trim();
  if (!clean) return null;

  let durationMinutes = 30;
  const durMatch = clean.match(/\b([0-9]+(?:\.[0-9]+)?)\s*(m|min|mins|h|hr|hrs|hours)\b/i);
  if (durMatch) {
    const val = parseFloat(durMatch[1]);
    const unit = durMatch[2].toLowerCase();
    durationMinutes = unit.startsWith('h') ? Math.round(val * 60) : Math.round(val);
    clean = clean.replace(durMatch[0], ' ');
  }

  const subject = clean.replace(/\s+/g, ' ').trim() || 'General Study';

  return {
    durationMinutes: durationMinutes,
    subject: subject
  };
}

/**
 * Parse /task or natural task command
 * Examples:
 *   /task Submit physics lab report by Friday 5pm
 *   task Buy groceries
 */
function parseTask(text) {
  let clean = text.replace(/^\/?(task|todo)\b\s*/i, '').trim();
  if (!clean) return null;

  let dueDate = 'No deadline';
  const dueMatch = clean.match(/\b(?:by|due|before)\s+(.+)$/i);
  if (dueMatch) {
    dueDate = dueMatch[1].trim();
    clean = clean.replace(dueMatch[0], '').trim();
  }

  return {
    task: clean,
    dueDate: dueDate,
    status: 'Pending'
  };
}

/**
 * Smart Auto-Detector:
 * Detects whether an un-prefixed text is Food, Expense, Workout, Study, or Task
 */
function autoDetectAndParse(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.trim();

  // 1. Direct command prefixes
  if (/^\/?spent\b/i.test(t)) {
    const res = parseSpent(t);
    return res ? { type: 'spent', data: res } : null;
  }
  if (/^\/?(calories|calorie|cal|c)\b/i.test(t)) {
    const res = parseCalories(t);
    return res ? { type: 'calorie', data: res } : null;
  }
  if (/^\/?(workout|w)\b/i.test(t)) {
    const res = parseWorkout(t);
    return res ? { type: 'workout', data: res } : null;
  }
  if (/^\/?(study|studied)\b/i.test(t)) {
    const res = parseStudy(t);
    return res ? { type: 'study', data: res } : null;
  }
  if (/^\/?(task|todo)\b/i.test(t)) {
    const res = parseTask(t);
    return res ? { type: 'task', data: res } : null;
  }

  // 2. Natural language detection:
  // Starts with calories e.g. "650 chicken and rice" or "ate ..."
  if (/^\d{2,4}\s+[A-Za-z]/i.test(t) || /^ate\b/i.test(t) || /\b(cal|kcal)\b/i.test(t)) {
    const res = parseCalories(t);
    if (res && res.calories > 0) return { type: 'calorie', data: res };
  }

  // Starts with currency or spending phrase e.g. "$15 coffee" or "paid 20 for uber"
  if (/^[$€£₹]\s*\d+/i.test(t) || /\b(paid|bought|spent)\b/i.test(t)) {
    const res = parseSpent(t.replace(/^(paid|bought)\s+/i, ''));
    if (res && res.amount > 0) return { type: 'spent', data: res };
  }

  // Workout phrases (bench press, leg day, cardio, outdoor run)
  if (/\b(push day|pull day|leg day|chest day|bench press|incline db|squats|deadlift|outdoor run|cardio|treadmill)\b/i.test(t)) {
    const res = parseWorkout(t);
    if (res) return { type: 'workout', data: res };
  }

  return null;
}

/**
 * Parse Bank SMS into structured transaction data
 */
function parseBankSms(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;

  const text = rawText.trim();

  let amount = 0;
  const amountRegexes = [
    /(?:debited(?:\s+by)?|spent|charged|withdrawn|paid|purchase(?:\s+of)?|payment(?:\s+of)?|txn(?:\s+of)?)\s*[:]?\s*([$€£₹]|USD|EUR|GBP|INR|CAD|AUD)?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i,
    /([$€£₹])\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/,
    /\b(?:USD|EUR|GBP|CAD|AUD|INR|AED|SAR|IRR)\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i,
    /(?:mablagh|bardasht|kharid|variz)[\s:]*([0-9,]+)/i
  ];

  for (const regex of amountRegexes) {
    const match = text.match(regex);
    if (match) {
      const numStr = match.slice(1).reverse().find(g => g && /[0-9]/.test(g));
      if (numStr) {
        amount = parseFloat(numStr.replace(/,/g, ''));
        if (!isNaN(amount) && amount > 0) break;
      }
    }
  }

  if (!amount) return null;

  let merchant = 'Unknown Merchant';
  const merchantRegexes = [
    /\b(?:at|to|in|vpa|info|vendor)\s+([A-Za-z0-9\s&'.-]{2,30}?)(?:\s+(?:on|dated|ref|avail|bal|using|card|ac|via|\.|\n|$))/i,
    /(?:kharid\s+az|forushgah)\s+([^\n\r,.-]{2,30})/i
  ];

  for (const mRegex of merchantRegexes) {
    const mMatch = text.match(mRegex);
    if (mMatch && mMatch[1]) {
      const candidate = mMatch[1].trim();
      if (!/^(the|a|an|your|card|bank)$/i.test(candidate)) {
        merchant = candidate;
        break;
      }
    }
  }

  let cardLast4 = '';
  const cardMatch = text.match(/\b(?:card|a\/c|acct|ending|xx)\s*(?:ending\s*)?[x*]*([0-9]{4})\b/i);
  if (cardMatch) {
    cardLast4 = cardMatch[1];
  }

  const category = detectCategory(merchant + ' ' + text);

  return {
    amount: amount,
    merchant: merchant,
    category: category,
    cardLast4: cardLast4,
    source: 'SMS Auto',
    raw: text
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    detectCategory,
    parseSpent,
    parseCalories,
    parseWorkout,
    parseStudy,
    parseTask,
    autoDetectAndParse,
    parseBankSms
  };
}
