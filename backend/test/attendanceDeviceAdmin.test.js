'use strict';
// جهاز البصمة — the ADMIN surface (migration 094).
//
// The case that matters is the last block: assigning an unmapped PIN must REPLAY that pin's
// already-stored punches. `punch_raw` keeps a punch from a number nobody has claimed instead
// of rejecting it, and that is only worth anything if linking the number later turns those
// punches into attendance. If the replay is ever dropped, every screen here still looks fine
// while a worker's first week silently never existed.
//
// Drives the real controller functions against the real dev database, the house pattern from
// test/optionGroupAudience.test.js. Every fixture row is tagged and removed in `after` — the
// dev DB is shared.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { query } = require('../lib/db');
const { zonedToUtc } = require('../lib/iclockProtocol');
const { allocatePin } = require('../lib/attendanceDevice');
const { DEFAULT_TZ } = require('../lib/shopTime');
const dev = require('../controllers/attendanceDeviceController');

const SUFFIX = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
const TAG = `ZZTEST-dev-${SUFFIX}`;
const SN = `ZZTESTSN${SUFFIX}`;
const SN2 = `ZZTESTSN${SUFFIX}B`;

// High, random, and outside anything an admin would type by hand, so two agents running
// against this database at once cannot collide on a number.
const base = 40000 + Math.floor(Math.random() * 20000);
const PIN_UNMAPPED = base;
const PIN_MANUAL = base + 1;

const fx = { users: [], pins: [PIN_UNMAPPED, PIN_MANUAL], serials: [SN, SN2] };
const ctx = {};

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
  };
  return res;
}
async function call(handler, req = {}) {
  const res = mockRes();
  await handler({ params: {}, query: {}, body: {}, ...req }, res);
  return res;
}

const newPhone = () => `078${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function insertStaff(name) {
  const { rows } = await query(
    `INSERT INTO users (name, phone, password_hash, role)
     VALUES ($1, $2, 'x', 'staff') RETURNING id, name`,
    [`${TAG} ${name}`, newPhone()]
  );
  fx.users.push(rows[0].id);
  return rows[0];
}

/** Baghdad calendar date `back` days ago, as 'YYYY-MM-DD'. */
function shopDateDaysAgo(back) {
  const d = new Date(Date.now() - back * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).reduce((a, p) => (p.type === 'literal' ? a : { ...a, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const hhmmPlus = (start, addMinutes) => {
  const [h, m] = String(start).split(':').map(Number);
  const total = h * 60 + m + addMinutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:00`;
};

async function insertPunch(pin, deviceTs, { sn = SN, status = 0 } = {}) {
  const { rows } = await query(
    `INSERT INTO punch_raw (device_sn, device_pin, device_ts, punched_at, raw_status, raw_verify, raw_line)
     VALUES ($1, $2, $3::timestamp, $4, $5, 1, $6)
     RETURNING id, punched_at`,
    [sn, String(pin), deviceTs, zonedToUtc(deviceTs), status, `${pin}\t${deviceTs}\t${status}\t1`]
  );
  return rows[0];
}

test.before(async () => {
  ctx.workerA = await insertStaff('عامل أ');
  ctx.workerB = await insertStaff('عامل ب');
  ctx.workerC = await insertStaff('عامل ج');

  // Pick a real working day from the shop's OWN schedule rather than hardcoding one: the
  // seeded week is editable by the admin and الجمعة is a different shift entirely.
  const week = await query(
    `SELECT weekday, to_char(start_time,'HH24:MI') AS start_time, is_off FROM staff_schedule_days`
  );
  const byWeekday = new Map(week.rows.map((r) => [Number(r.weekday), r]));
  for (let back = 2; back <= 9; back += 1) {
    const date = shopDateDaysAgo(back);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const day = byWeekday.get(dow);
    if (!day || day.is_off) continue;
    const holiday = await query(`SELECT 1 FROM staff_holidays WHERE work_date = $1::date`, [date]);
    if (holiday.rows.length) continue;
    ctx.workDate = date;
    ctx.shiftStart = day.start_time;
    break;
  }
  assert.ok(ctx.workDate, 'no open shift day in the last week — the schedule seed is missing');

  // Three punches from a number NOBODY has claimed: arrival, a lunchtime double-touch, and
  // the way out. They land before any mapping exists — the situation the replay exists for.
  ctx.punchIn = `${ctx.workDate} ${hhmmPlus(ctx.shiftStart, 30)}`;
  ctx.punchMid = `${ctx.workDate} ${hhmmPlus(ctx.shiftStart, 180)}`;
  ctx.punchOut = `${ctx.workDate} ${hhmmPlus(ctx.shiftStart, 400)}`;
  ctx.rowIn = await insertPunch(PIN_UNMAPPED, ctx.punchIn);
  await insertPunch(PIN_UNMAPPED, ctx.punchMid);
  ctx.rowOut = await insertPunch(PIN_UNMAPPED, ctx.punchOut);
});

test.after(async () => {
  // punch_raw FIRST: its FKs are ON DELETE SET NULL, so dropping the users would leave the
  // rows behind pointing at nothing instead of removing them.
  await query(`DELETE FROM punch_raw WHERE device_sn = ANY($1::text[]) OR device_pin = ANY($2::text[])`,
    [fx.serials, fx.pins.map(String)]);
  await query(`DELETE FROM punch_reject WHERE device_sn = ANY($1::text[])`, [fx.serials]);
  await query(`DELETE FROM device_commands WHERE device_sn = ANY($1::text[])`, [fx.serials]);
  await query(`DELETE FROM staff_attendance_records WHERE user_id = ANY($1::uuid[])`, [fx.users]);
  await query(`DELETE FROM staff_device_pins WHERE user_id = ANY($1::uuid[]) OR pin = ANY($2::int[])`,
    [fx.users, fx.pins]);
  await query(`DELETE FROM attendance_devices WHERE serial_number = ANY($1::text[])`, [fx.serials]);
  await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [fx.users]);

  const left = await query(
    `SELECT (SELECT COUNT(*) FROM users WHERE name LIKE $1)
          + (SELECT COUNT(*) FROM punch_raw WHERE device_sn = ANY($2::text[]))
          + (SELECT COUNT(*) FROM attendance_devices WHERE serial_number = ANY($2::text[])) AS n`,
    [`${TAG}%`, fx.serials]
  );
  assert.strictEqual(Number(left.rows[0].n), 0, 'fixture rows left behind');
});

// ───────────────────────────── الأجهزة ─────────────────────────────

test('registering a serial creates it, and it shows up with «لم يتصل بعد» (last_seen_at null)', async () => {
  const created = await call(dev.registerDevice, { body: { serial_number: SN, label_ar: 'جهاز المحل' } });
  assert.strictEqual(created.statusCode, 201);
  assert.strictEqual(created.body.data.serial_number, SN);
  assert.strictEqual(created.body.data.active, true);

  const list = await call(dev.listDevices);
  assert.strictEqual(list.statusCode, 200);
  const row = list.body.data.find((d) => d.serial_number === SN);
  assert.ok(row, 'the registered device must appear in the list');
  assert.strictEqual(row.last_seen_at, null, 'a device that never dialled in has no last_seen_at');
  assert.strictEqual(typeof row.today_punches, 'number');
});

test('the same serial twice is a 409, not a second row', async () => {
  const res = await call(dev.registerDevice, { body: { serial_number: SN } });
  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(res.body.code, 'ERR_DUPLICATE');
  const { rows } = await query(`SELECT COUNT(*)::int n FROM attendance_devices WHERE serial_number = $1`, [SN]);
  assert.strictEqual(rows[0].n, 1);
});

test('a malformed serial is refused with an Arabic message', async () => {
  const res = await call(dev.registerDevice, { body: { serial_number: '  ' } });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.code, 'ERR_VALIDATION');
  assert.match(res.body.error, /[؀-ۿ]/, 'errors are Arabic');
});

test('a device can be renamed and switched off; an unknown serial is 404', async () => {
  const patched = await call(dev.updateDevice, {
    params: { sn: SN }, body: { label_ar: 'جهاز الباب', active: false },
  });
  assert.strictEqual(patched.statusCode, 200);
  assert.strictEqual(patched.body.data.label_ar, 'جهاز الباب');
  assert.strictEqual(patched.body.data.active, false);

  const missing = await call(dev.updateDevice, { params: { sn: 'NOPE-NOPE' }, body: { active: true } });
  assert.strictEqual(missing.statusCode, 404);
  assert.strictEqual(missing.body.code, 'ERR_NOT_FOUND');

  // Back on — the command-queue assertions below need one active device.
  await call(dev.updateDevice, { params: { sn: SN }, body: { active: true } });
});

// ───────────────────────── ربط الأرقام بالموظفين ─────────────────────────

test('the pin roster lists every موظف, with no pin until one is given', async () => {
  const res = await call(dev.listPins);
  assert.strictEqual(res.statusCode, 200);
  const row = res.body.data.find((r) => r.user_id === ctx.workerA.id);
  assert.ok(row, 'a staff user must appear on the roster');
  assert.strictEqual(row.pin, null);
  assert.strictEqual(row.staff_name, ctx.workerA.name);
});

test('allocatePin returns the lowest free number and SKIPS taken ones', async () => {
  const { tx } = require('../lib/db');
  await tx(async (client) => {
    const first = await allocatePin(client);
    assert.ok(Number.isInteger(first) && first >= 1, 'a pin is a positive integer');
    const taken = await client.query(`SELECT 1 FROM staff_device_pins WHERE pin = $1`, [first]);
    assert.strictEqual(taken.rows.length, 0, 'allocatePin must never hand out a taken number');

    await client.query(
      `INSERT INTO staff_device_pins (user_id, pin) VALUES ($1, $2)`,
      [ctx.workerA.id, first]
    );
    fx.pins.push(first);
    const second = await allocatePin(client);
    // «lowest free» means everything below `first` was already taken, so the next free one
    // is necessarily above it. Anything else is the allocator re-issuing a live number.
    assert.ok(second > first, `second allocation ${second} must skip the taken ${first}`);
    throw Object.assign(new Error('rollback'), { rollbackFixture: true });
  }).catch((e) => { if (!e.rollbackFixture) throw e; });
});

test('setting a pin by hand queues the name push to every active device', async () => {
  const res = await call(dev.setPin, {
    params: { userId: ctx.workerB.id },
    body: { pin: PIN_MANUAL, pushed_name: 'Amal' },
  });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.data.pin, PIN_MANUAL);
  assert.strictEqual(res.body.data.push_state, 'pending');
  assert.ok(res.body.meta.queued >= 1, 'the name push must be queued');

  const { rows } = await query(
    `SELECT body, state FROM device_commands WHERE device_sn = $1 ORDER BY id DESC LIMIT 1`, [SN]
  );
  assert.strictEqual(rows[0].state, 'queued');
  assert.ok(rows[0].body.startsWith(`DATA UPDATE USERINFO PIN=${PIN_MANUAL}\tName=Amal\t`), rows[0].body);
});

test('a pin already held by another موظف is a 409, not a silent steal', async () => {
  const res = await call(dev.setPin, {
    params: { userId: ctx.workerC.id }, body: { pin: PIN_MANUAL },
  });
  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(res.body.code, 'ERR_DUPLICATE');
  const { rows } = await query(`SELECT user_id FROM staff_device_pins WHERE pin = $1`, [PIN_MANUAL]);
  assert.strictEqual(rows[0].user_id, ctx.workerB.id, 'the original owner keeps the number');
});

test('setting a pin for a non-staff user is 404', async () => {
  const res = await call(dev.setPin, {
    params: { userId: '00000000-0000-0000-0000-000000000000' }, body: {},
  });
  assert.strictEqual(res.statusCode, 404);
});

// ───────────────────── أرقام جهاز بلا اسم + الاشتقاق ─────────────────────

test('an unclaimed number shows up under «أرقام جهاز بلا اسم» with its counts', async () => {
  const res = await call(dev.listUnmapped);
  assert.strictEqual(res.statusCode, 200);
  const row = res.body.data.find((r) => r.device_pin === String(PIN_UNMAPPED));
  assert.ok(row, 'a punch from an unknown number must be visible, never dropped');
  assert.strictEqual(row.punch_count, 3);
  assert.strictEqual(row.device_sn, SN);
  assert.strictEqual(row.mapped_user_id, null);
  assert.ok(new Date(row.first_seen_at) < new Date(row.last_seen_at));
});

test('⚠️ assigning an unmapped pin REPLAYS its stored punches into attendance', async () => {
  const before = await query(
    `SELECT COUNT(*)::int n FROM staff_attendance_records WHERE user_id = $1`, [ctx.workerC.id]
  );
  assert.strictEqual(before.rows[0].n, 0, 'the worker has no history before the link exists');

  const res = await call(dev.assignUnmapped, {
    params: { pin: String(PIN_UNMAPPED) }, body: { user_id: ctx.workerC.id },
  });
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.data.pin, PIN_UNMAPPED);
  assert.strictEqual(res.body.meta.replayed, 3, 'all three stored punches are replayed');
  assert.strictEqual(res.body.meta.derived.created, 1, 'the first punch opens the day');

  // The whole point: a day of work that existed only as raw punches is now attendance.
  const after = await query(
    `SELECT check_in_at, check_out_at FROM staff_attendance_records WHERE user_id = $1`,
    [ctx.workerC.id]
  );
  assert.strictEqual(after.rows.length, 1, 'one shift → exactly one record');
  assert.strictEqual(
    new Date(after.rows[0].check_in_at).toISOString(),
    new Date(ctx.rowIn.punched_at).toISOString(),
    'check-in is the FIRST punch, not the moment the admin pressed «اربط»'
  );
  assert.strictEqual(
    new Date(after.rows[0].check_out_at).toISOString(),
    new Date(ctx.rowOut.punched_at).toISOString(),
    'check-out is the LAST punch; the lunchtime touch between them changes nothing'
  );

  // And the raw rows are now attributed, so the number leaves the «بلا اسم» list.
  const claimed = await query(
    `SELECT COUNT(*)::int n FROM punch_raw WHERE device_pin = $1 AND user_id = $2`,
    [String(PIN_UNMAPPED), ctx.workerC.id]
  );
  assert.strictEqual(claimed.rows[0].n, 3);
  const list = await call(dev.listUnmapped);
  assert.ok(
    !list.body.data.some((r) => r.device_pin === String(PIN_UNMAPPED)),
    'a claimed number is no longer unmapped'
  );
});

test('assigning to somebody who is not a موظف is refused', async () => {
  const res = await call(dev.assignUnmapped, {
    params: { pin: String(PIN_UNMAPPED) },
    body: { user_id: '00000000-0000-0000-0000-000000000000' },
  });
  assert.strictEqual(res.statusCode, 404);
});

test('assigning with no user_id asks for one instead of throwing', async () => {
  const res = await call(dev.assignUnmapped, { params: { pin: String(PIN_UNMAPPED) }, body: {} });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.code, 'ERR_VALIDATION');
});

test('unlinking queues the device delete and KEEPS the derived history', async () => {
  const res = await call(dev.deletePin, { params: { userId: ctx.workerC.id } });
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.meta.queued >= 1);

  const cmd = await query(
    `SELECT body FROM device_commands WHERE device_sn = $1 ORDER BY id DESC LIMIT 1`, [SN]
  );
  assert.strictEqual(cmd.rows[0].body, `DATA DELETE USERINFO PIN=${PIN_UNMAPPED}`);

  // A mapping ending is a fact about the FUTURE. Payroll still needs the day that happened.
  const kept = await query(
    `SELECT COUNT(*)::int n FROM staff_attendance_records WHERE user_id = $1`, [ctx.workerC.id]
  );
  assert.strictEqual(kept.rows[0].n, 1, 'unlinking must never erase attendance already derived');

  const again = await call(dev.deletePin, { params: { userId: ctx.workerC.id } });
  assert.strictEqual(again.statusCode, 404);
});

// ───────────────────────── نبضات مرفوضة ─────────────────────────

test('a quarantined line is readable, newest first', async () => {
  await query(
    `INSERT INTO punch_reject (device_sn, raw_line, reason) VALUES ($1, $2, $3)`,
    [SN, 'garbage\tline', 'وقت غير صالح']
  );
  const res = await call(dev.listRejects, { query: { limit: '10' } });
  assert.strictEqual(res.statusCode, 200);
  const row = res.body.data.find((r) => r.device_sn === SN);
  assert.ok(row, 'the bad line must be visible — it is the only place a dialect mismatch shows');
  assert.strictEqual(row.reason, 'وقت غير صالح');
});
