// Unit tests for the student-info half of the admin/مدير الإنتاج order edit
// (backend/controllers/orderEditController.js).
//
// Point a harmless DATABASE_URL at localhost BEFORE requiring the controller: lib/db
// refuses to attach a non-production process to the shared Neon database, and building
// a Pool never opens a socket, so these tests stay entirely offline.
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';

const test = require('node:test');
const assert = require('node:assert');
const { validateStudentInfo, applyStudentInfo } = require('../controllers/orderEditController');

// ── validateStudentInfo ──────────────────────────────────────────────────────

test('only reports fields the caller actually supplied', () => {
  const { values } = validateStudentInfo({ department: 'هندسة' });
  assert.deepStrictEqual(Object.keys(values), ['department']);
});

test('an omitted field is distinct from one explicitly cleared', () => {
  assert.strictEqual('department' in validateStudentInfo({}).values, false);
  assert.strictEqual(validateStudentInfo({ department: '' }).values.department, null);
});

test('strips a leading @ from the instagram handle', () => {
  assert.strictEqual(validateStudentInfo({ instagram_username: '@@lolo_shop96' }).values.instagram_username, 'lolo_shop96');
});

test('rejects a blank student name (name is NOT NULL everywhere it is mirrored)', () => {
  assert.ok(validateStudentInfo({ name: '   ' }).error);
});

test('accepts both study_type enum values and clears on empty', () => {
  assert.strictEqual(validateStudentInfo({ study_type: 'morning' }).values.study_type, 'morning');
  assert.strictEqual(validateStudentInfo({ study_type: 'evening' }).values.study_type, 'evening');
  assert.strictEqual(validateStudentInfo({ study_type: '' }).values.study_type, null);
  assert.strictEqual(validateStudentInfo({ study_type: null }).values.study_type, null);
});

test('rejects an out-of-enum study_type instead of letting Postgres 500', () => {
  assert.ok(validateStudentInfo({ study_type: 'bogus' }).error);
});

test('rejects non-string study_type rather than coercing it', () => {
  // ['morning'] used to String()-coerce to a VALID value — a JSON API must not accept that.
  for (const bad of [['morning'], { a: 1 }, 5, true]) {
    assert.ok(validateStudentInfo({ study_type: bad }).error, `should reject ${JSON.stringify(bad)}`);
  }
});

test('validates study_type before truncation, so a long value fails loudly', () => {
  assert.ok(validateStudentInfo({ study_type: 'morningXXXXXXXXXXXX' }).error);
});

test('phone_primary normalises to "" (the NOT NULL "no phone" marker), secondary to null', () => {
  const { values } = validateStudentInfo({ phone_primary: '  ', phone_secondary: '  ' });
  assert.strictEqual(values.phone_primary, '');
  assert.strictEqual(values.phone_secondary, null);
});

test('truncates over-long free text to the column limit', () => {
  assert.strictEqual(validateStudentInfo({ name: 'ب'.repeat(500) }).values.name.length, 120);
  assert.strictEqual(validateStudentInfo({ university_name: 'ج'.repeat(500) }).values.university_name.length, 160);
});

// ── applyStudentInfo — write behaviour via a spy executor ────────────────────

const spy = () => {
  const calls = [];
  const exec = async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; };
  return { calls, exec };
};
const STUDENT = () => ({ id: 'student-1', user_id: 'user-1', name: 'قديم' });

test('an invalid field writes NOTHING (no partially-applied edit behind a 400)', async () => {
  const { calls, exec } = spy();
  const res = await applyStudentInfo(
    STUDENT(),
    { university_name: 'بغداد', department: 'حاسوب', study_type: 'bogus' },
    'group-1',
    exec
  );
  assert.ok(res.error, 'should report the invalid study_type');
  assert.strictEqual(calls.length, 0, 'no UPDATE may run when validation fails');
});

test('name is mirrored to users, students and the checkout group', async () => {
  const { calls, exec } = spy();
  const res = await applyStudentInfo(STUDENT(), { name: 'زينب' }, 'group-1', exec);
  assert.deepStrictEqual(res.changed, ['name']);
  assert.strictEqual(calls.length, 3);
  assert.match(calls[0].sql, /UPDATE users SET name/);
  assert.match(calls[1].sql, /UPDATE students SET full_name_third/);
  assert.match(calls[2].sql, /UPDATE checkout_groups SET customer_name/);
  assert.ok(calls.every((c) => c.params.includes('زينب')));
});

test('group-only fields are skipped when the order has no checkout group', async () => {
  // Cart bundles carry a checkout_group_id with no checkout_groups row — most live retail
  // orders. The phone writes must simply not run rather than hit a missing row.
  const { calls, exec } = spy();
  const res = await applyStudentInfo(
    STUDENT(),
    { instagram_username: 'zainab', phone_primary: '07701234567' },
    null,
    exec
  );
  assert.deepStrictEqual(res.changed, ['instagram_username']);
  assert.strictEqual(calls.length, 1, 'only the students-table IG write may run');
  assert.match(calls[0].sql, /UPDATE students SET instagram_username/);
});

test('academic fields write to students only, and are cast to the enum', async () => {
  const { calls, exec } = spy();
  const res = await applyStudentInfo(
    STUDENT(),
    { university_name: 'جامعة بغداد', department: 'هندسة', study_type: 'evening' },
    'group-1',
    exec
  );
  assert.deepStrictEqual(res.changed, ['university_name', 'department', 'study_type']);
  assert.ok(calls.every((c) => /UPDATE students SET/.test(c.sql)), 'no checkout_groups mirror for academic fields');
  assert.match(calls[2].sql, /\$1::study_type/);
});
