'use strict';
// The app-presence beacon (migration 087), against a real database.
//
// What is worth guarding here is not "does it insert" but the two rules that make the numbers
// mean anything:
//
//   · `opens` counts SESSIONS, not pings. The beacon fires on every mount and every return to
//     the foreground, so an `opens = opens + 1` would report a student who switched tabs twelve
//     times as twelve opens. The increment is a CASE inside the UPSERT precisely so two tabs
//     cannot race it, which also means it cannot be tested from JS — only through the DB.
//   · a NULL platform must never overwrite one we already learned. An old build, or a web tab
//     belonging to someone who normally uses Android, would otherwise erase the answer to the
//     one question this table exists for: على أي منصة.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const { query } = require('../lib/db');
const {
  recordOpen,
  recordRegisterError,
  shopToday,
  SESSION_GAP_MINUTES,
} = require('../lib/appPresence');

async function makeUser(suffix) {
  const { rows } = await query(
    `INSERT INTO users (name, phone, password_hash, role)
     VALUES ($1, $2, 'x', 'retail') RETURNING id`,
    [`ZZ اختبار التطبيق ${suffix}`, `0770000${String(suffix).padStart(4, '0')}`]
  );
  return rows[0].id;
}

async function row(userId) {
  const { rows } = await query(
    `SELECT opens, platform, app_version, first_seen_at, last_seen_at FROM app_opens
      WHERE user_id = $1 AND work_date = $2`,
    [userId, shopToday()]
  );
  return rows[0];
}

async function cleanup(userId) {
  await query(`DELETE FROM app_opens WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM users WHERE id = $1`, [userId]);
}

test('pings inside the session window do NOT count a second open', async (t) => {
  const id = await makeUser(1);
  t.after(() => cleanup(id));

  const now = new Date();
  await recordOpen({ userId: id, platform: 'android', now });
  await recordOpen({ userId: id, platform: 'android', now: new Date(now.getTime() + 60_000) });
  await recordOpen({
    userId: id,
    platform: 'android',
    now: new Date(now.getTime() + (SESSION_GAP_MINUTES - 1) * 60_000),
  });

  const r = await row(id);
  assert.equal(r.opens, 1, 'three pings inside the window are one open');
});

test('a ping after the session gap counts a new open', async (t) => {
  const id = await makeUser(2);
  t.after(() => cleanup(id));

  const now = new Date();
  await recordOpen({ userId: id, platform: 'ios', now });
  await recordOpen({
    userId: id,
    platform: 'ios',
    now: new Date(now.getTime() + (SESSION_GAP_MINUTES + 1) * 60_000),
  });

  assert.equal((await row(id)).opens, 2);
});

test('a NULL or unknown platform never erases one we already know', async (t) => {
  const id = await makeUser(3);
  t.after(() => cleanup(id));

  await recordOpen({ userId: id, platform: 'android' });
  await recordOpen({ userId: id, platform: null });
  assert.equal((await row(id)).platform, 'android');

  // Same for a value that is not one of the three we accept — it is dropped, not stored.
  await recordOpen({ userId: id, platform: 'windows-phone' });
  assert.equal((await row(id)).platform, 'android');
});

test('last_seen_at only ever moves forward', async (t) => {
  const id = await makeUser(4);
  t.after(() => cleanup(id));

  const now = new Date();
  await recordOpen({ userId: id, platform: 'web', now });
  // A late-arriving beacon (a queued keepalive request, a phone whose clock is behind) must not
  // drag the row backwards and make the next real ping look like a new session.
  await recordOpen({ userId: id, platform: 'web', now: new Date(now.getTime() - 10 * 60_000) });

  const r = await row(id);
  assert.ok(r.last_seen_at.getTime() >= now.getTime() - 1000);
  assert.equal(r.opens, 1);
});

// ── the 2026-08-26 diagnostics (migration 090) ─────────────────────────────────────────────
// Added because prod held 145 Android device tokens and ZERO iOS while signed-in iPhone users
// opened the app daily, and nothing in the system could say WHY. Both columns exist to separate
// "the app is too old to register" from "registration was attempted and refused".

test('the app version is recorded, and a NEWER one replaces the old within the same day', async (t) => {
  const id = await makeUser(5);
  t.after(() => cleanup(id));

  await recordOpen({ userId: id, platform: 'ios', appVersion: '1.0.3' });
  assert.equal((await row(id)).app_version, '1.0.3');

  // Unlike `platform`, the version must move: someone updating mid-day is exactly the event
  // this column was added to observe.
  await recordOpen({ userId: id, platform: 'ios', appVersion: '1.0.4' });
  assert.equal((await row(id)).app_version, '1.0.4');

  // A client that cannot report one must not erase what we already know.
  await recordOpen({ userId: id, platform: 'ios', appVersion: null });
  assert.equal((await row(id)).app_version, '1.0.4');
});

test('a registration failure is stored with its reason, capped', async (t) => {
  const id = await makeUser(6);
  t.after(async () => {
    await query(`DELETE FROM push_register_errors WHERE user_id = $1`, [id]);
    await cleanup(id);
  });

  await recordRegisterError({
    userId: id,
    platform: 'ios',
    appVersion: '1.0.4',
    // A hostile or buggy client must not be able to write an unbounded string.
    message: 'x'.repeat(5000),
  });

  const { rows } = await query(
    `SELECT platform, app_version, message FROM push_register_errors WHERE user_id = $1`,
    [id]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].platform, 'ios');
  assert.equal(rows[0].app_version, '1.0.4');
  assert.equal(rows[0].message.length, 500);
});
