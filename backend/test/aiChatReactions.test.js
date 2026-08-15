'use strict';
// POST /api/assistant/react — tap-reactions on لولو's own answers (migration 082).
//
// Runs against the real dev database, self-cleaning: every row it creates (users,
// ai_chat_messages) is removed in `after`, which then asserts 0 leftovers.
//
// Calls the controller function directly with a mock req/res, same pattern as
// test/otpDegradedMode.test.js — there is no supertest anywhere in this repo, and going through
// a real HTTP layer would test express-rate-limit and routing, not the ownership logic this
// suite exists to pin.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcrypt');
const crypto = require('node:crypto');

const { query } = require('../lib/db');
const anonSession = require('../lib/anonSession');
const support = require('../controllers/supportChatController');

const TAG = `aireact-${crypto.randomBytes(4).toString('hex')}`;
const PASSWORD = `x-${crypto.randomBytes(16).toString('hex')}`;

const createdUsers = [];
const createdMessages = [];

function mockRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const mockReq = (body, user = null) => ({ body, user });

function freshPhone() {
  return '079' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
}

async function makeUser() {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const { rows } = await query(
    `INSERT INTO users (name, phone, password_hash, role) VALUES ($1, $2, $3, 'retail') RETURNING id`,
    [TAG, freshPhone(), hash]
  );
  createdUsers.push(rows[0].id);
  return rows[0].id;
}

/** A settled ai_chat_messages row to react to — owned either by a user_id or a session_key. */
async function makeMessage({ userId = null, sessionKey = null }) {
  const { rows } = await query(
    `INSERT INTO ai_chat_messages (user_id, session_key, surface, question, answer, model, cost_usd)
     VALUES ($1, $2, 'support', $3, 'جواب تجريبي', 'test', 0)
     RETURNING id`,
    [userId, sessionKey, `${TAG} question`]
  );
  createdMessages.push(rows[0].id);
  return rows[0].id;
}

test.after(async () => {
  if (createdMessages.length) {
    await query(`DELETE FROM ai_chat_messages WHERE id = ANY($1::bigint[])`, [createdMessages]);
  }
  if (createdUsers.length) {
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUsers]);
  }
  const { rows: leftMsgs } = await query(
    `SELECT id FROM ai_chat_messages WHERE id = ANY($1::bigint[])`,
    [createdMessages]
  );
  const { rows: leftUsers } = await query(`SELECT id FROM users WHERE name = $1`, [TAG]);
  assert.strictEqual(leftMsgs.length, 0, 'every test message must be cleaned up');
  assert.strictEqual(leftUsers.length, 0, 'every test user must be cleaned up');
});

test('REACT: happy path — a signed-in user reacts to their own message', async () => {
  const userId = await makeUser();
  const msgId = await makeMessage({ userId });

  const res = mockRes();
  await support.react(mockReq({ message_id: msgId, reaction: 'love' }, { id: userId }), res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.reaction, 'love');
  // `msgId` is whatever `pg` returned for a bigint column (a string, to avoid precision loss);
  // the controller echoes back the NUMBER it parsed from the request, so compare numerically.
  assert.strictEqual(Number(res.body.message_id), Number(msgId));

  const { rows } = await query('SELECT reaction FROM ai_chat_messages WHERE id = $1', [msgId]);
  assert.strictEqual(rows[0].reaction, 'love');
});

test('REACT: setting a new reaction overwrites the old one', async () => {
  const userId = await makeUser();
  const msgId = await makeMessage({ userId });

  await support.react(mockReq({ message_id: msgId, reaction: 'like' }, { id: userId }), mockRes());
  const res2 = mockRes();
  await support.react(mockReq({ message_id: msgId, reaction: 'excellent' }, { id: userId }), res2);

  assert.strictEqual(res2.statusCode, 200);
  const { rows } = await query('SELECT reaction FROM ai_chat_messages WHERE id = $1', [msgId]);
  assert.strictEqual(rows[0].reaction, 'excellent');
});

test('REACT: reaction: null CLEARS a previous reaction', async () => {
  const userId = await makeUser();
  const msgId = await makeMessage({ userId });

  await support.react(mockReq({ message_id: msgId, reaction: 'sad' }, { id: userId }), mockRes());
  const res2 = mockRes();
  await support.react(mockReq({ message_id: msgId, reaction: null }, { id: userId }), res2);

  assert.strictEqual(res2.statusCode, 200);
  assert.strictEqual(res2.body.reaction, null);
  const { rows } = await query('SELECT reaction FROM ai_chat_messages WHERE id = $1', [msgId]);
  assert.strictEqual(rows[0].reaction, null);
});

test('REACT: an anonymous caller with a valid signed session_key can react to their own message', async () => {
  const token = anonSession.mint();
  const sessionKey = anonSession.verify(token);
  const msgId = await makeMessage({ sessionKey });

  const res = mockRes();
  await support.react(mockReq({ message_id: msgId, reaction: 'happy', sessionToken: token }, null), res);

  assert.strictEqual(res.statusCode, 200);
  const { rows } = await query('SELECT reaction FROM ai_chat_messages WHERE id = $1', [msgId]);
  assert.strictEqual(rows[0].reaction, 'happy');
});

test('REACT: WRONG OWNER (a different signed-in user) gets 404, never a leak of whether the id exists', async () => {
  const ownerId = await makeUser();
  const strangerId = await makeUser();
  const msgId = await makeMessage({ userId: ownerId });

  const res = mockRes();
  await support.react(mockReq({ message_id: msgId, reaction: 'love' }, { id: strangerId }), res);

  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(res.body.code, 'ERR_AI_REACT_NOT_FOUND');
  // The row must be untouched.
  const { rows } = await query('SELECT reaction FROM ai_chat_messages WHERE id = $1', [msgId]);
  assert.strictEqual(rows[0].reaction, null);
});

test('REACT: WRONG OWNER (a different anon session) also gets 404', async () => {
  const ownerKey = anonSession.verify(anonSession.mint());
  const strangerToken = anonSession.mint();
  const msgId = await makeMessage({ sessionKey: ownerKey });

  const res = mockRes();
  await support.react(
    mockReq({ message_id: msgId, reaction: 'love', sessionToken: strangerToken }, null),
    res
  );

  assert.strictEqual(res.statusCode, 404);
});

test('REACT: a message that does not exist gets 404', async () => {
  const userId = await makeUser();
  const res = mockRes();
  // Postgres bigserial — far outside anything this suite could ever have inserted.
  await support.react(mockReq({ message_id: 999999999999, reaction: 'like' }, { id: userId }), res);
  assert.strictEqual(res.statusCode, 404);
});

test('REACT: no identity at all (signed out, no/invalid session token) is refused with 403', async () => {
  const msgId = await makeMessage({ sessionKey: anonSession.verify(anonSession.mint()) });

  const res1 = mockRes();
  await support.react(mockReq({ message_id: msgId, reaction: 'like' }, null), res1); // no sessionToken
  assert.strictEqual(res1.statusCode, 403);
  assert.strictEqual(res1.body.code, 'ERR_AI_REACT_FORBIDDEN');

  const res2 = mockRes();
  await support.react(
    mockReq({ message_id: msgId, reaction: 'like', sessionToken: 'not-a-real-token' }, null),
    res2
  );
  assert.strictEqual(res2.statusCode, 403);
});

test('REACT: an invalid reaction value is a 400 in Arabic, not a raw DB constraint error', async () => {
  const userId = await makeUser();
  const msgId = await makeMessage({ userId });

  const res = mockRes();
  await support.react(mockReq({ message_id: msgId, reaction: 'super-duper-happy' }, { id: userId }), res);

  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.code, 'ERR_AI_REACT_INVALID');
  assert.match(res.body.error, /[؀-ۿ]/, 'the error must be Arabic');
});

test('REACT: a missing or non-numeric message_id is a 400, never reaches the database', async () => {
  const userId = await makeUser();

  for (const bad of [undefined, 'abc', -1, 0, 1.5]) {
    const res = mockRes();
    await support.react(mockReq({ message_id: bad, reaction: 'like' }, { id: userId }), res);
    assert.strictEqual(res.statusCode, 400, `message_id=${bad} should 400`);
    assert.strictEqual(res.body.code, 'ERR_AI_REACT_BAD_ID');
  }
});
