const assert = require('assert');
const {
  detectCategory,
  parseSpent,
  parseCalories,
  parseWorkout,
  parseStudy,
  parseTask,
  autoDetectAndParse,
  parseBankSms
} = require('../_archive/parsers.js');

console.log('--- Running Tests for Parsers ---');

// 1. Test parseSpent
{
  const res1 = parseSpent('/spent 15.50 lunch at subway');
  assert.strictEqual(res1.amount, 15.50);
  assert.strictEqual(res1.category, 'Food & Dining');

  const res2 = parseSpent('spent $45 Amazon headphones');
  assert.strictEqual(res2.amount, 45);
  assert.strictEqual(res2.category, 'Shopping');
  console.log('✓ parseSpent passed (with and without slash)');
}

// 2. Test parseCalories
{
  const res1 = parseCalories('/c 650 chicken and rice 45p');
  assert.strictEqual(res1.calories, 650);
  assert.strictEqual(res1.protein, 45);

  const res2 = parseCalories('c 350 2 eggs and toast');
  assert.strictEqual(res2.calories, 350);

  const res3 = parseCalories('ate 500 burger 30p 45c 18f');
  assert.strictEqual(res3.calories, 500);
  assert.strictEqual(res3.protein, 30);
  console.log('✓ parseCalories passed (with and without slash)');
}

// 3. Test parseWorkout
{
  const res1 = parseWorkout('/w Chest: Bench press 80kg 4x10, Incline 30kg 3x12');
  assert.strictEqual(res1.type, 'Chest');
  assert.ok(res1.exercises.includes('Bench press'));

  const res2 = parseWorkout('workout 45m outdoor 5km run');
  assert.strictEqual(res2.duration, '45m');
  console.log('✓ parseWorkout passed');
}

// 4. Test parseStudy
{
  const res1 = parseStudy('/study 45m Physics mechanics');
  assert.strictEqual(res1.durationMinutes, 45);

  const res2 = parseStudy('study 1.5h Linear Algebra chapter 3');
  assert.strictEqual(res2.durationMinutes, 90);
  console.log('✓ parseStudy passed');
}

// 5. Test parseTask
{
  const res1 = parseTask('/task Submit assignment by Friday 5pm');
  assert.strictEqual(res1.task, 'Submit assignment');
  assert.strictEqual(res1.dueDate, 'Friday 5pm');
  console.log('✓ parseTask passed');
}

// 6. Test autoDetectAndParse
{
  const d1 = autoDetectAndParse('650 chicken and rice 45p');
  assert.strictEqual(d1.type, 'calorie');
  assert.strictEqual(d1.data.calories, 650);
  assert.strictEqual(d1.data.protein, 45);

  const d2 = autoDetectAndParse('spent 18.50 at starbucks');
  assert.strictEqual(d2.type, 'spent');
  assert.strictEqual(d2.data.amount, 18.50);

  const d3 = autoDetectAndParse('study 60m biology');
  assert.strictEqual(d3.type, 'study');
  assert.strictEqual(d3.data.durationMinutes, 60);

  const d4 = autoDetectAndParse('bench press 80kg 4x10');
  assert.strictEqual(d4.type, 'workout');

  console.log('✓ autoDetectAndParse passed for all natural language inputs');
}

// 7. Test parseBankSms
{
  const sms1 = "Your card ending 4321 was charged $42.50 at Trader Joe's on 09/30. Avail Bal: $1,250.00";
  const parsed1 = parseBankSms(sms1);
  assert.strictEqual(parsed1.amount, 42.50);
  assert.strictEqual(parsed1.category, 'Groceries');

  const sms2 = "A/C *9876 debited by USD 15.00 at Starbucks on 30-Sep. Ref: 1092834";
  const parsed2 = parseBankSms(sms2);
  assert.strictEqual(parsed2.amount, 15.00);

  const sms3 = "Bardasht: 120,000 Kharid az Hyperstar. Mojoodi: 4,500,000";
  const parsed3 = parseBankSms(sms3);
  assert.strictEqual(parsed3.amount, 120000);
  console.log('✓ parseBankSms passed for all regional formats');
}

console.log('\n--- ALL PARSER TESTS PASSED SUCCESSFULLY! ---');
