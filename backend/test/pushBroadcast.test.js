'use strict';
// «إرسال إشعار» — the guards on the first push a HUMAN composes.
//
// Everything else in this system pushes because an event happened, so the event bounded the
// audience. Here the sender picks it, and there is no unsend. The three things worth testing
// are therefore the three ways a press can go wrong in a way nobody can take back:
//
//   · the link leaves the app          → a phishing message wearing the shop's name
//   · «الكل» is pressed by accident    → 1,100 phones, unrecallable
//   · the audience is not who was meant → the university free-text problem, live on prod
//
// The link check is pure and tested directly; the audience and the fan-out are tested against
// the real database, because the SQL is where the parameter-numbering bug would live.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const { query } = require('../lib/db');
const push = require('../lib/pushBroadcast');

// ── the link allowlist ─────────────────────────────────────────────────────────────────────

test('an absolute URL is refused, whatever it points at', () => {
  for (const bad of [
    'https://evil.example/login',
    'http://lolo-shop96.com/orders',
    'HTTPS://evil.example',
    'javascript:alert(1)',
  ]) {
    const r = push.checkLink(bad);
    assert.equal(r.ok, false, `${bad} must be refused`);
  }
});

test('a protocol-relative URL is refused even though it starts with a slash', () => {
  // `//evil.example/x` is a URL. The naive "must start with /" test passes it, which is exactly
  // why the check tests for `//` separately.
  assert.equal(push.checkLink('//evil.example/x').ok, false);
  assert.equal(push.checkLink('//evil.example/x').code, 'ERR_LINK_EXTERNAL');
});

test('an in-app path is accepted only if it is ON the list', () => {
  assert.equal(push.checkLink('/cart').ok, true);
  assert.equal(push.checkLink('/orders').ok, true);
  assert.equal(push.checkLink(null).ok, true, 'no link at all is fine');

  // Shares a prefix with an allowlisted path — a startsWith() test would let it through.
  assert.equal(push.checkLink('/orders-evil').ok, false);
  assert.equal(push.checkLink('/admin').ok, false, 'not on the list');
});

test('an allowlisted path plus one id segment is accepted', () => {
  assert.equal(push.checkLink('/orders/9d0a2f1c-1111-2222-3333-444455556666').ok, true);
  assert.equal(push.checkLink('/orders/../../etc/passwd').ok, false);
});

// ── the audience ───────────────────────────────────────────────────────────────────────────

async function makeStudent(suffix, university) {
  const { rows } = await query(
    `INSERT INTO users (name, phone, password_hash, role)
     VALUES ($1, $2, 'x', 'retail') RETURNING id`,
    [`ZZ اختبار إشعار ${suffix}`, `0771000${String(suffix).padStart(4, '0')}`]
  );
  const userId = rows[0].id;
  await query(
    `INSERT INTO students (user_id, university_name, full_name_third)
     VALUES ($1, $2, $3)`,
    [userId, university, `ZZ اختبار إشعار ${suffix}`]
  );
  return userId;
}

async function cleanup(ids) {
  await query(`DELETE FROM notifications WHERE user_id = ANY($1)`, [ids]);
  await query(`DELETE FROM users WHERE id = ANY($1)`, [ids]);
}

test('a university audience matches the spellings prod actually has', async (t) => {
  // The real problem this loose match exists for: one university is spelled three ways on prod.
  // An exact match would reach a third of the cohort and look like it worked.
  const ids = [
    await makeStudent(801, 'كلية بلاد الرافدين'),
    await makeStudent(802, 'بلاد الرافدين'),
    await makeStudent(803, 'جامعة ديالى'),
  ];
  t.after(() => cleanup(ids));

  const r = await push.resolveAudience({ kind: 'university', value: 'بلاد الرافدين' });
  assert.equal(r.ok, true);
  assert.ok(r.people >= 2, 'both spellings of the same university must be reached');

  const other = await push.resolveAudience({ kind: 'university', value: 'ديالى' });
  assert.ok(other.people >= 1);
});

test('a deleted account is never a recipient', async (t) => {
  const id = await makeStudent(804, 'ZZ جامعة الاختبار');
  t.after(() => cleanup([id]));

  const before = await push.resolveAudience({ kind: 'university', value: 'ZZ جامعة الاختبار' });
  assert.equal(before.people, 1);

  // Migration 076 anonymises rather than row-deletes, so the row still exists.
  await query(`UPDATE users SET deleted_at = NOW() WHERE id = $1`, [id]);
  const after = await push.resolveAudience({ kind: 'university', value: 'ZZ جامعة الاختبار' });
  assert.equal(after.people, 0);
});

test('«الكل» refuses to send unless the sender types the count back', async () => {
  const wrong = await push.send({
    audience: { kind: 'all' },
    titleAr: 'تجربة',
    bodyAr: 'نص',
    confirmedCount: 1,
    adminId: null,
  });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, 'ERR_CONFIRM_COUNT');
});

test('a send writes one notification per recipient, and an audit row', async (t) => {
  const ids = [
    await makeStudent(805, 'ZZ جامعة الإرسال'),
    await makeStudent(806, 'ZZ جامعة الإرسال'),
  ];
  let broadcastId = null;
  t.after(async () => {
    if (broadcastId) await query(`DELETE FROM push_broadcasts WHERE id = $1`, [broadcastId]);
    await cleanup(ids);
  });

  const r = await push.send({
    audience: { kind: 'university', value: 'ZZ جامعة الإرسال' },
    titleAr: 'موعد التسليم',
    bodyAr: 'راجع طلبك',
    link: '/orders',
    adminId: null,
  });
  assert.equal(r.ok, true, r.error);
  broadcastId = r.broadcast_id;
  assert.equal(r.people, 2);

  const { rows } = await query(
    `SELECT type, title_ar, link, push_state FROM notifications WHERE user_id = ANY($1)`,
    [ids]
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.every((n) => n.type === 'admin_broadcast' && n.link === '/orders'));
  // 'pending' IS the queue (migration 077) — the outbox drains it after commit. A row written
  // in any other state would never be delivered.
  assert.ok(rows.every((n) => n.push_state === 'pending'));

  const { rows: log } = await query(`SELECT people, devices FROM push_broadcasts WHERE id = $1`, [
    broadcastId,
  ]);
  assert.equal(log[0].people, 2);
});

test('an empty audience is refused rather than silently sending nothing', async () => {
  const r = await push.send({
    audience: { kind: 'university', value: 'ZZ جامعة ما موجودة أبداً' },
    titleAr: 'تجربة',
    adminId: null,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ERR_EMPTY_AUDIENCE');
});

// ── the marketing opt-in gate (Apple 4.5.4) ────────────────────────────────────────────────
// The single rule that keeps promotional push inside the App Store guidelines: an offer may
// only reach accounts that explicitly asked for offers. Everything here is about the DEFAULT
// falling the safe way, because that is what a reviewer checks and what silently enrols 1,100
// people if it is wrong.

test('a marketing send reaches nobody until they opt in — and a transactional one is unaffected', async (t) => {
  const ids = [await makeStudent(807, 'ZZ جامعة التسويق'), await makeStudent(808, 'ZZ جامعة التسويق')];
  t.after(() => cleanup(ids));

  const audience = { kind: 'university', value: 'ZZ جامعة التسويق' };

  // Fresh accounts take the column default. Nobody is enrolled by existing — this is the
  // assertion that a future "sensible default" change would break loudly.
  const promo = await push.resolveAudience(audience, { marketing: true });
  assert.equal(promo.people, 0, 'marketing must be opt-IN');

  const transactional = await push.resolveAudience(audience);
  assert.equal(transactional.people, 2, 'order updates are not gated by the marketing toggle');

  await query(
    `UPDATE users SET notification_prefs = notification_prefs || '{"marketing": true}'::jsonb
      WHERE id = $1`,
    [ids[0]]
  );

  const after = await push.resolveAudience(audience, { marketing: true });
  assert.equal(after.people, 1, 'only the person who opted in');
});

test('a marketing send is typed apart from a transactional one in the notifications it writes', async (t) => {
  const ids = [await makeStudent(809, 'ZZ جامعة النوع')];
  let broadcastId = null;
  t.after(async () => {
    if (broadcastId) await query(`DELETE FROM push_broadcasts WHERE id = $1`, [broadcastId]);
    await cleanup(ids);
  });
  await query(
    `UPDATE users SET notification_prefs = notification_prefs || '{"marketing": true}'::jsonb
      WHERE id = $1`,
    [ids[0]]
  );

  const r = await push.send({
    audience: { kind: 'university', value: 'ZZ جامعة النوع' },
    titleAr: 'خصم على الأوشحة',
    marketing: true,
    adminId: null,
  });
  assert.equal(r.ok, true, r.error);
  broadcastId = r.broadcast_id;

  const { rows } = await query(`SELECT type FROM notifications WHERE user_id = $1`, [ids[0]]);
  assert.equal(rows[0].type, 'admin_marketing');

  const { rows: log } = await query(`SELECT marketing FROM push_broadcasts WHERE id = $1`, [
    broadcastId,
  ]);
  assert.equal(log[0].marketing, true, 'the audit row records which rule the send was made under');
});

test('an empty marketing audience says WHY it is empty', async () => {
  const r = await push.send({
    audience: { kind: 'role', value: 'retail' },
    titleAr: 'عرض',
    marketing: true,
    adminId: null,
  });
  // No retail account has opted in on this database, so this is the message an admin will
  // actually hit first — it must not read as "the audience is broken".
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ERR_EMPTY_AUDIENCE');
  assert.match(r.error, /العروض/);
});
