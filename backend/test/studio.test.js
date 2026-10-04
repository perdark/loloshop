'use strict';
// «الاستوديو» — pure helpers (spend caps, message shaping) + the access gate. No database
// writes and no network calls: evaluateCaps/buildChatMessages/firstTitle are plain functions,
// and allowToolUser is exercised only on the branches that resolve WITHOUT a DB round trip
// (admin, an allowed staff type, an unrelated role, no user) — the design_helper branch (which
// does query design_team_members) is covered behaviourally by calligraphy's own access tests
// since it is the exact same function.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateCaps } = require('../lib/studioCaps');
const { firstTitle, buildChatMessages, SYSTEM_PROMPT } = require('../lib/studioMessages');
const { allowToolUser, mayUseTool } = require('../lib/calligraphyAccess');

// ── studioCaps.evaluateCaps ────────────────────────────────────────────────────────────────
test('1. evaluateCaps: under both ceilings → allowed', () => {
  const err = evaluateCaps(
    { userSpent: 0.1, shopSpent: 1 },
    { userMaxUsd: 2, shopMaxUsd: 10 }
  );
  assert.equal(err, null);
});

test('2. evaluateCaps: shop ceiling hit → ERR_STUDIO_CAP, even if the user is under their own', () => {
  const err = evaluateCaps(
    { userSpent: 0.01, shopSpent: 10 },
    { userMaxUsd: 2, shopMaxUsd: 10 }
  );
  assert.equal(err.code, 'ERR_STUDIO_CAP');
  assert.equal(err.status, 429);
  assert.match(err.message, /كامل/); // the shop-wide message, not the per-user one
});

test('3. evaluateCaps: per-user ceiling hit → ERR_STUDIO_CAP, shop still has room', () => {
  const err = evaluateCaps(
    { userSpent: 2, shopSpent: 3 },
    { userMaxUsd: 2, shopMaxUsd: 10 }
  );
  assert.equal(err.code, 'ERR_STUDIO_CAP');
  assert.match(err.message, /سقف استخدامك/);
});

test('4. evaluateCaps: shop ceiling is checked first (both tripped → shop-wide message)', () => {
  const err = evaluateCaps(
    { userSpent: 5, shopSpent: 10 },
    { userMaxUsd: 2, shopMaxUsd: 10 }
  );
  assert.match(err.message, /كامل/);
});

// ── studioMessages.firstTitle ───────────────────────────────────────────────────────────────
test('5. firstTitle: trims, collapses whitespace, caps at 40 chars', () => {
  const long = 'ص'.repeat(60);
  assert.equal(firstTitle(long).length, 40);
  assert.equal(firstTitle('  a   b  '), 'a b');
  assert.equal(firstTitle(''), null);
  assert.equal(firstTitle('   '), null);
});

// ── studioMessages.buildChatMessages ────────────────────────────────────────────────────────
test('6. buildChatMessages: system prompt first, history in the middle, plain string for a text-only turn', () => {
  const history = [{ role: 'user', content: 'سؤال سابق' }, { role: 'assistant', content: 'جواب سابق' }];
  const msgs = buildChatMessages({ history, text: 'سؤال جديد', imageDataUrls: [] });
  assert.equal(msgs.length, 4);
  assert.deepEqual(msgs[0], { role: 'system', content: SYSTEM_PROMPT });
  assert.equal(msgs[1].content, 'سؤال سابق');
  assert.equal(msgs[2].content, 'جواب سابق');
  assert.deepEqual(msgs[3], { role: 'user', content: 'سؤال جديد' });
});

test('7. buildChatMessages: attached images become an image_url content-part array', () => {
  const msgs = buildChatMessages({ history: [], text: 'صمم لي شعار', imageDataUrls: ['data:image/jpeg;base64,AA=='] });
  const last = msgs[msgs.length - 1];
  assert.equal(last.role, 'user');
  assert.ok(Array.isArray(last.content));
  assert.deepEqual(last.content[0], { type: 'text', text: 'صمم لي شعار' });
  assert.deepEqual(last.content[1], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA==' } });
});

// ── allowToolUser (lib/calligraphyAccess.js) — branches that never touch the database ───────
function mockRes() {
  const res = { statusCode: 200, body: null, status(c) { res.statusCode = c; return res; }, json(b) { res.body = b; return res; } };
  return res;
}

test('8. allowToolUser: no req.user → 401 ERR_AUTH, next() not called', async () => {
  const res = mockRes();
  let called = false;
  await allowToolUser({ user: null }, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'ERR_AUTH');
});

test('9. allowToolUser: admin → next() called, response untouched', async () => {
  const res = mockRes();
  let called = false;
  await allowToolUser({ user: { role: 'admin' } }, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(res.body, null);
});

test('10. allowToolUser: staff designer → next() called (mayUseTool fast path, no DB hit)', async () => {
  const res = mockRes();
  let called = false;
  const user = { role: 'staff', staff_type: 'designer', staff_types: ['designer'] };
  assert.equal(mayUseTool(user), true); // sanity: this test relies on the fast path firing
  await allowToolUser({ user }, res, () => { called = true; });
  assert.equal(called, true);
});

test('11. allowToolUser: retail role (not design_helper) → 403 ERR_FORBIDDEN, no DB hit needed', async () => {
  const res = mockRes();
  let called = false;
  await allowToolUser({ user: { role: 'retail' } }, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'ERR_FORBIDDEN');
});

test('12. allowToolUser: staff presser (staff but wrong staff_type, not design_helper) → 403', async () => {
  const res = mockRes();
  let called = false;
  const user = { role: 'staff', staff_type: 'presser', staff_types: ['presser'] };
  await allowToolUser({ user }, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
});
