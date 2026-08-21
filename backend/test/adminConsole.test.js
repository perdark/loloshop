// Tests for «لولو الإدارة» — the admin console (2026-08-21).
//
// Everything here is chosen by the same rule the rest of this suite uses: cover the decisions
// that fail SILENTLY and point at the shop's money, an employee's pay, or a write nobody
// authorised. A wrong colour on a chip is not in that set; an AI extending the wrong rep's
// deadline is.
//
// Split in two halves:
//   · PURE — the guard, the proposal signature, the registry's shape. No database, no network.
//   · DB   — the app-open session window, the report's null-vs-zero rule, and the nightly job's
//            idempotency. These need real rows because that is where their bugs live: the
//            session gap is a CASE inside an UPSERT and the idempotency is a NOT EXISTS, and
//            neither can be observed from a mock.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const guard = require('../lib/adminAnswerGuard');
const actions = require('../lib/adminActions');
const { evaluateCaps } = require('../lib/aiChat')._internals;
const { parseJson } = require('../controllers/adminConsoleController')._internals;
const { localParts, fmtShopDate } = require('../lib/shopTime');
const metrics = require('../lib/adminMetrics');
const presence = require('../lib/staffPresence');
const reportJob = require('../lib/staffReportJob');
const { query } = require('../lib/db');

// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE ADMIN ANSWER GUARD
//
// The storefront guard asserts "no price we did not compute". This one asserts the mirror
// image: "no NUMBER we did not compute". They must never be merged — a storefront rule applied
// here gags every correct answer, and this rule applied there permits any price.
// ═══════════════════════════════════════════════════════════════════════════════════════════

const FACTS = [
  'آخر 30 يوم',
  'دخل المحل: 35,160,000 دينار',
  'منها حصة الإدارة من طلبات الممثلين: 6,235,000 دينار',
  'عدد الطلبات: 578',
].join('\n');

test('guard: an answer that only echoes our numbers passes', () => {
  const ans = 'دخل المحل ٣٥,١٦٠,٠٠٠ دينار خلال آخر ٣٠ يوم، منها حصة الإدارة ٦,٢٣٥,٠٠٠ دينار.';
  assert.deepEqual(guard.inspect(ans, FACTS), { ok: true });
});

test('guard: Arabic-Indic digits compare equal to the Latin ones we computed', () => {
  // The model writes ٥٧٨ and the facts say 578. A guard that treated those as different
  // numbers would reject every correct Arabic answer, which is the failure mode that makes
  // people delete guards.
  assert.equal(guard.inspect('عدد الطلبات ٥٧٨ طلب.', FACTS).ok, true);
});

test('guard: an INVENTED figure is refused', () => {
  const v = guard.inspect('دخل المحل 35,160,000 دينار وصافي الربح 12,400,000 دينار.', FACTS);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'NUMBER_NOT_IN_FACTS');
  assert.match(v.detail, /12400000/);
});

test('guard: a DERIVED percentage is refused even though it is a small number', () => {
  // The small-integer exemption exists so «آخر ٣٠ يوم» does not trip the guard. A percentage
  // is by definition ≤ 100, so without a dedicated rule every model-computed share would ride
  // through that exemption — and a share is exactly the arithmetic the prompt forbids.
  const v = guard.inspect('دخل المحل 35,160,000 دينار، وحصة الإدارة تشكل 18% منه.', FACTS);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'DERIVED_PERCENTAGE');
});

test('guard: INVENTED CONTAINMENT is refused — the defect this guard exists for', () => {
  // Observed on this surface: «٨٠ طلبًا بانتظار الموافقة، ومن بينها ١٢٣ طالبًا». Both numbers
  // are ours and correct; the sentence joining them is false. No number check can catch this.
  const facts = 'بانتظار الموافقة\nطلبات: 80\nطلاب: 123';
  const v = guard.inspect('٨٠ طلباً بانتظار الموافقة، ومن بينها ١٢٣ طالباً.', facts);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'INVENTED_CONTAINMENT');
});

test('guard: containment WE stated is still allowed', () => {
  // The rule is not "never say منها" — revenue_summary's own facts say it. Getting this wrong
  // in the strict direction would reject the shop's most-asked money answer.
  assert.equal(guard.inspect('دخل المحل ٣٥,١٦٠,٠٠٠، منها ٦,٢٣٥,٠٠٠ حصة الإدارة.', FACTS).ok, true);
});

test('guard: small ordinals and periods do not trip it', () => {
  assert.equal(guard.inspect('عدد الطلبات 578 خلال آخر 30 يوم، وهذا أفضل من 5 أشهر.', FACTS).ok, true);
});

test('guard: an empty answer is refused rather than shown', () => {
  assert.equal(guard.inspect('', FACTS).reason, 'EMPTY_ANSWER');
  assert.equal(guard.inspect('   ', FACTS).reason, 'EMPTY_ANSWER');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE SIGNED PROPOSAL
//
// The signature is the ENTIRE authorisation for /act. Without it a client could post any
// {action, params} it liked and every validation in adminActions would be advisory.
// ═══════════════════════════════════════════════════════════════════════════════════════════

const ADMIN = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

function sign(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = Buffer.from(
    crypto.createHmac('sha256', process.env.JWT_SECRET).update(payload).digest()
  ).toString('base64url');
  return `${payload}.${sig}`;
}

test('proposal: a token this server signed for this admin verifies', () => {
  const t = actions._internals.signProposal({
    adminId: ADMIN,
    action: 'add_staff_bonus',
    params: { user_id: 'u', amount: 5000 },
  });
  const v = actions.verifyProposal(t, ADMIN);
  assert.equal(v.ok, true);
  assert.equal(v.action, 'add_staff_bonus');
  assert.equal(v.params.amount, 5000);
});

test('proposal: a token minted for ANOTHER admin is refused', () => {
  const t = actions._internals.signProposal({ adminId: ADMIN, action: 'add_staff_bonus', params: {} });
  assert.equal(actions.verifyProposal(t, OTHER).ok, false);
});

test('proposal: TAMPERING with the payload is refused', () => {
  // The whole attack: take a legitimate 5,000 bonus, rewrite it to 5,000,000, keep the
  // signature. If this ever passes, the param bounds in adminActions are decoration.
  const t = actions._internals.signProposal({
    adminId: ADMIN,
    action: 'add_staff_bonus',
    params: { user_id: 'u', amount: 5000 },
  });
  const [payload, sig] = t.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
  decoded.params.amount = 5_000_000;
  const forged = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${sig}`;
  assert.equal(actions.verifyProposal(forged, ADMIN).ok, false);
});

test('proposal: an EXPIRED token is refused, with a distinct message', () => {
  const t = sign({ adminId: ADMIN, action: 'add_staff_bonus', params: {}, exp: Date.now() - 1 });
  const v = actions.verifyProposal(t, ADMIN);
  assert.equal(v.ok, false);
  assert.match(v.error, /انتهت صلاحية/);
});

test('proposal: a token naming an action that is not in the registry is refused', () => {
  // Belt and braces against the registry shrinking: a token signed while an action existed
  // must stop working the moment it is removed.
  const t = sign({ adminId: ADMIN, action: 'delete_everything', params: {}, exp: Date.now() + 60000 });
  assert.equal(actions.verifyProposal(t, ADMIN).ok, false);
});

test('proposal: garbage is refused without throwing', () => {
  for (const junk of ['', 'nope', 'a.b.c', '....', null, undefined, 42, {}]) {
    assert.equal(actions.verifyProposal(junk, ADMIN).ok, false);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE REGISTRY'S SHAPE
//
// These assert what the console CANNOT do. They are the tests most likely to be "fixed" by a
// future session adding a convenient action, which is exactly why they name the reason.
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('registry: NOTHING can approve or reject a rep order', () => {
  // ⛔ HANDOFF ruling 2026-08-14: «بانتظار موافقة الممثل» holds orders parked on unresolved
  // student↔rep disputes. The pending state is deliberate. An AI approving them — one or all —
  // takes a side in someone else's argument, the damage is social, and no revert undoes it.
  // If you are here because you want to add this action: the answer is no.
  const ids = Object.keys(actions.ACTIONS).join(' ');
  assert.equal(/approve_order|reject_order|approve_rep|rep_order|checkout_group/.test(ids), false);

  // Per action, not over a concatenation: `ai_set_order_cost` (entity 'order') and
  // `ai_approve_break` are both legitimate, and a regex run across the joined blob matches
  // "order …approv" ACROSS the two entries and fails a correct registry. Ask the real question
  // instead — does any SINGLE action both approve/reject AND concern an order?
  for (const [id, a] of Object.entries(actions.ACTIONS)) {
    const touchesOrder = /order/i.test(`${id} ${a.audit.entity} ${a.audit.action}`);
    const approves = /approv|reject/i.test(`${id} ${a.audit.action}`);
    assert.equal(touchesOrder && approves, false, `${id} approves or rejects an order`);
  }

  // And no action's SQL may write the approval column at all, whatever it is called.
  for (const [id, a] of Object.entries(actions.ACTIONS)) {
    assert.equal(
      /wholesaler_approval/.test(String(a.run)),
      false,
      `${id} writes orders.wholesaler_approval`
    );
  }
});

test('registry: nothing DELETES, and nothing touches a credential or verification_mode', () => {
  const ids = Object.keys(actions.ACTIONS).join(' ');
  // Deletes are excluded because they are not reversible — the one rule that makes an
  // AI-executable action acceptable at all.
  assert.equal(/delete|remove|drop|purge/.test(ids), false);
  // A credential must never move by model output, however well validated.
  assert.equal(/password|secret|token|money_gate/.test(ids), false);
  // verification_mode off 'none' while the shop coordinates are NULL 403s every بصمة for
  // every worker on every platform. It is an ordering landmine, not a toggle.
  assert.equal(/verification_mode|attendance_settings/.test(ids), false);
});

test('registry: every action declares a validate, a run and an audit target', () => {
  for (const [id, a] of Object.entries(actions.ACTIONS)) {
    assert.equal(typeof a.validate, 'function', `${id} needs validate`);
    assert.equal(typeof a.run, 'function', `${id} needs run`);
    assert.ok(a.audit && a.audit.action && a.audit.entity, `${id} needs an audit target`);
    assert.ok(a.desc && a.desc.length > 5, `${id} needs a description for the router prompt`);
  }
});

test('registry: an unknown action id is rejected before any validation runs', async () => {
  const r = await actions.propose('rm_rf_slash', { x: 1 }, { id: ADMIN });
  assert.equal(r.ok, false);
});

// ── Param bounds. These are OURS, deliberately tighter than the equivalent admin endpoints:
// the manual screen may pay any bonus a human types; a model reading a misheard Arabic
// sentence may not.
test('actions: intIn rejects everything that is not an integer inside the bound', () => {
  const { intIn } = actions._internals;
  assert.equal(intIn(5, 1, 10), 5);
  assert.equal(intIn(0, 1, 10), null);
  assert.equal(intIn(11, 1, 10), null);
  assert.equal(intIn(-3, 1, 10), null);
  assert.equal(intIn(2.5, 1, 10), null);
  assert.equal(intIn('7', 1, 10), 7); // a JSON model output is often a string
  assert.equal(intIn('abc', 1, 10), null);
  assert.equal(intIn(null, 1, 10), null);
  assert.equal(intIn(Infinity, 1, 10), null);
});

test('actions: isoDateWithin refuses the past and the absurd future', () => {
  const { isoDateWithin } = actions._internals;
  const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  assert.ok(isoDateWithin(soon, 365));
  assert.equal(isoDateWithin('2020-01-01', 365), null);
  // A model that reads «باچر» as the year 2126 must fail loudly, not set a century-long goal.
  assert.equal(isoDateWithin('2126-01-01', 365), null);
  assert.equal(isoDateWithin('not-a-date', 365), null);
  assert.equal(isoDateWithin('', 365), null);
  assert.equal(isoDateWithin(null, 365), null);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ROUTING + CATALOGUE
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('router: parseJson survives a ```json fence', () => {
  assert.deepEqual(parseJson('```json\n{"kind":"metric","key":"staff_today"}\n```'), {
    kind: 'metric',
    key: 'staff_today',
  });
  assert.equal(parseJson('sorry, I cannot'), null);
  assert.equal(parseJson(''), null);
});

test('catalogue: the metric prompt names every metric, and the action prompt every action', () => {
  const m = metrics.catalogForPrompt();
  for (const key of Object.keys(metrics.METRICS)) assert.match(m, new RegExp(key));
  const a = actions.catalogForPrompt();
  for (const key of Object.keys(actions.ACTIONS)) assert.match(a, new RegExp(key));
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE BUDGET SLICE
//
// Two AVAILABILITY failures, one in each direction. Both are silent: the surface just goes
// dark and the log says "budget", which reads like working-as-intended.
// ═══════════════════════════════════════════════════════════════════════════════════════════

const zero = { burstMinute: 0, burstWindow: 0, spendToday: 0, anonSpendToday: 0, adminSpendToday: 0 };
const CAPS = {
  burstPerMinute: 10,
  burstPer5Min: 40,
  globalUsdPerDay: 3.0,
  anonUsdPerDay: 1.2,
  adminUsdPerDay: 2.0,
};

test('budget: a flood of student questions cannot switch off the admin console', () => {
  const r = evaluateCaps(
    { ...zero, spendToday: 3.5, anonSpendToday: 1.2, adminSpendToday: 0.01 },
    { userId: ADMIN, surface: 'admin_analytics', caps: CAPS }
  );
  assert.equal(r, null, 'the owner must still be able to use his own instrument');
});

test('budget: a chatty console cannot drain the storefront', () => {
  const r = evaluateCaps(
    { ...zero, spendToday: 2.6, anonSpendToday: 0.05, adminSpendToday: 2.5 },
    { userId: 'student', surface: 'support', caps: CAPS }
  );
  assert.equal(r, null, 'the marketing surface must survive an expensive admin day');
});

test('budget: each surface still has a real ceiling of its own', () => {
  const admin = evaluateCaps(
    { ...zero, spendToday: 2.5, adminSpendToday: 2.5 },
    { userId: ADMIN, surface: 'admin_analytics', caps: CAPS }
  );
  assert.equal(admin.code, 'ERR_AI_ADMIN_BUDGET');

  const pub = evaluateCaps(
    { ...zero, spendToday: 5.0, anonSpendToday: 0.1, adminSpendToday: 1.0 },
    { userId: 'student', surface: 'support', caps: CAPS }
  );
  assert.equal(pub.code, 'ERR_AI_BUDGET');
});

test('budget: a caller that does NOT name its surface keeps the old whole-shop behaviour', () => {
  // Backwards compatibility is load-bearing: every pre-existing caller and test reads
  // spendToday as one total, and quietly changing that meaning would loosen the storefront's
  // ceiling without anyone deciding to.
  assert.equal(evaluateCaps({ ...zero, spendToday: 1.0 }, { userId: 'u', caps: CAPS }), null);
  assert.equal(
    evaluateCaps({ ...zero, spendToday: 3.5 }, { userId: 'u', caps: CAPS }).code,
    'ERR_AI_BUDGET'
  );
});

test('budget: the burst throttle still applies to the admin surface', () => {
  const r = evaluateCaps(
    { ...zero, burstMinute: 10 },
    { userId: ADMIN, surface: 'admin_analytics', caps: CAPS }
  );
  assert.equal(r.code, 'ERR_AI_TOO_FAST');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// STAFF PRESENCE — needs the database
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('shop date: app-opens and بصمة agree on which day it is', () => {
  // THE BUG THIS PREVENTS: the server clock is UTC and the shop is UTC+3, so between 21:00 and
  // midnight Baghdad, CURRENT_DATE and "today at the shop" are different days. An app-open
  // filed under one and a بصمة under the other join to nothing and the report silently reports
  // an empty evening.
  const lateEvening = new Date('2026-08-21T21:30:00Z'); // 00:30 on the 22nd in Baghdad
  assert.equal(presence.shopToday(lateEvening), localParts(lateEvening, 'Asia/Baghdad').date);
  assert.equal(presence.shopToday(lateEvening), '2026-08-22');
  // And the plain UTC answer, which is what a naive CURRENT_DATE would have given:
  assert.equal(lateEvening.toISOString().slice(0, 10), '2026-08-21');
});

test('dates: the console prints numerals, not month names', () => {
  // Owner preference 2026-08-21. `toLocaleDateString('ar-IQ', {month:'long'})` gave
  // «٢ حزيران ٢٠٢٦» — correct Arabic, slower to scan than digits, and on a confirmation card
  // the owner is checking a date against one in his head.
  assert.equal(fmtShopDate('2026-08-30'), '2026/8/30');
  assert.equal(fmtShopDate('2026-06-02'), '2026/6/2', 'no leading zeros');
  assert.equal(fmtShopDate(new Date('2026-01-01T09:00:00Z')), '2026/1/1');
  // Shop time, not UTC — the same off-by-one-day trap localParts exists for. 21:30Z is already
  // tomorrow in Baghdad, and a confirmation card showing yesterday's date is a wrong card.
  assert.equal(fmtShopDate(new Date('2026-08-21T21:30:00Z')), '2026/8/22');
  // A bad value must render as nothing rather than «Invalid Date» in an Arabic sentence.
  assert.equal(fmtShopDate('nope'), '');
  assert.equal(fmtShopDate(null), '');
});

test('app-open: a ping inside the session window does NOT count a second open', async (t) => {
  const staff = await query(
    `SELECT id FROM users WHERE role = 'staff' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`
  );
  if (!staff.rows.length) return t.skip('no staff user in this database');
  const userId = staff.rows[0].id;

  const day = presence.shopToday();
  await query(`DELETE FROM staff_app_opens WHERE user_id = $1 AND work_date = $2`, [userId, day]);
  t.after(() => query(`DELETE FROM staff_app_opens WHERE user_id = $1 AND work_date = $2`, [userId, day]));

  const t0 = new Date();
  const first = await presence.recordAppOpen({ userId, platform: 'android', now: t0 });
  assert.equal(first.opens, 1);

  // Two minutes later — the same person still working, not a new session.
  const same = await presence.recordAppOpen({
    userId,
    platform: 'android',
    now: new Date(t0.getTime() + 2 * 60000),
  });
  assert.equal(same.opens, 1, 'a heartbeat must not inflate the open count');
  assert.ok(new Date(same.last_seen_at) > new Date(first.last_seen_at), 'but last_seen must move');

  // Past the gap — they left and came back.
  const later = await presence.recordAppOpen({
    userId,
    now: new Date(t0.getTime() + (presence.SESSION_GAP_MINUTES + 3) * 60000),
  });
  assert.equal(later.opens, 2);
});

test('app-open: a junk platform is stored as NULL, never echoed back', async (t) => {
  const staff = await query(
    `SELECT id FROM users WHERE role = 'staff' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`
  );
  if (!staff.rows.length) return t.skip('no staff user in this database');
  const userId = staff.rows[0].id;
  const day = presence.shopToday();
  await query(`DELETE FROM staff_app_opens WHERE user_id = $1 AND work_date = $2`, [userId, day]);
  t.after(() => query(`DELETE FROM staff_app_opens WHERE user_id = $1 AND work_date = $2`, [userId, day]));

  await presence.recordAppOpen({ userId, platform: '<script>alert(1)</script>' });
  const { rows } = await query(
    `SELECT platform FROM staff_app_opens WHERE user_id = $1 AND work_date = $2`,
    [userId, day]
  );
  assert.equal(rows[0].platform, null);
});

test('report: worked_minutes is NULL while someone is still checked in, never 0', async () => {
  const rep = await presence.dailyReport();
  for (const row of rep.rows) {
    if (row.still_in) {
      assert.equal(
        row.worked_minutes,
        null,
        '«still at work» and «worked nothing» are different claims'
      );
    }
    // The invariant that makes the two states distinguishable at all.
    assert.equal(row.still_in, Boolean(row.check_in_at) && !row.check_out_at);
  }
});

test('report: an attendance-exempt employee is counted as exempt, not absent', async () => {
  const rep = await presence.dailyReport();
  const exempt = rep.rows.filter((r) => !r.attendance_required);
  assert.equal(rep.totals.not_required, exempt.length);
  // Absence is only meaningful for someone we expect. Counting exempt staff as absent would
  // make every report permanently wrong by a constant, in the alarming direction.
  const absentNames = rep.rows.filter((r) => r.attendance_required && !r.check_in_at);
  assert.equal(rep.totals.absent, absentNames.length);
  assert.ok(rep.totals.absent + rep.totals.checked_in + rep.totals.not_required >= rep.totals.staff - 1);
});

test('report: the totals agree with the rows they summarise', async () => {
  const rep = await presence.dailyReport();
  assert.equal(rep.totals.staff, rep.rows.length);
  assert.equal(rep.totals.opened, rep.rows.filter((r) => r.opened).length);
  assert.equal(rep.totals.not_opened, rep.rows.filter((r) => !r.opened).length);
  assert.equal(rep.totals.opened + rep.totals.not_opened, rep.totals.staff);
  assert.equal(rep.totals.opens, rep.rows.reduce((s, r) => s + r.opens, 0));
});

test('report: an explicit bad date falls back to today rather than throwing', async () => {
  for (const junk of ['not-a-date', '2026-13-45; DROP TABLE users', '', null]) {
    const rep = await presence.dailyReport(junk);
    assert.equal(rep.date, presence.shopToday());
  }
});

test('nightly report: running it twice writes exactly one notification', async (t) => {
  const before = await query(
    `SELECT id FROM notifications WHERE type = 'staff_daily_report' AND created_at > NOW() - INTERVAL '20 hours'`
  );
  if (before.rowCount > 0) return t.skip("today's report already exists in this database");

  t.after(() =>
    query(`DELETE FROM notifications WHERE type = 'staff_daily_report' AND created_at > NOW() - INTERVAL '1 hour'`)
  );

  const first = await reportJob.runDailyReport();
  assert.equal(first.skipped, false);
  assert.ok(first.notified >= 1);

  // A worker restart, a redeploy, or pg-boss redelivering after a crash. The owner would read
  // a second push as a second day.
  const second = await reportJob.runDailyReport();
  assert.equal(second.skipped, true);
  assert.equal(second.notified, 0);

  const rows = await query(
    `SELECT push_state FROM notifications WHERE type = 'staff_daily_report' AND created_at > NOW() - INTERVAL '1 hour'`
  );
  assert.equal(rows.rowCount, first.notified);
  // 'pending' is what lib/pushOutbox.js drains. A row written as anything else never reaches
  // a phone, which is the entire point of the job.
  assert.ok(rows.rows.every((r) => r.push_state === 'pending'));
});

test('nightly report: the push body carries the four numbers the owner asked for', () => {
  const body = reportJob.composeBody({
    date: '2026-08-21',
    totals: { staff: 9, opened: 6, checked_in: 5, worked_minutes: 2400 },
    rows: [
      { name: 'أحمد', attendance_required: true, check_in_at: null, opened: false },
      { name: 'سارة', attendance_required: true, check_in_at: '2026-08-21T06:00:00Z', opened: false },
    ],
  });
  assert.match(body, /فتحوا التطبيق: 6 من 9/);
  assert.match(body, /بصموا حضور: 5/);
  assert.match(body, /40 ساعة/);
  assert.match(body, /غايبين: أحمد/);
  // The row the whole app-open signal exists to surface, and the one an attendance-only
  // report can never show.
  assert.match(body, /بصموا بس ما فتحوا التطبيق: سارة/);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// EVERY METRIC RUNS
//
// Not an assertion about the numbers — an assertion that the SQL is valid. A metric with a
// typo'd column throws only when a model happens to select it, which on a 22-key catalogue
// can be weeks after the deploy. (`orders.wholesaler_id` did not exist; a draft of
// adminSuggestions assumed it did, and only running it found out.)
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('metrics: all 22 run against the real schema without throwing', async () => {
  for (const key of Object.keys(metrics.METRICS)) {
    const out = await metrics.run(key, { days: 30, limit: 5 });
    assert.ok(out, `${key} returned nothing`);
    assert.ok(typeof out.label === 'string' && out.label.length, `${key} has no label`);
    assert.ok(Array.isArray(out.facts) && out.facts.length, `${key} produced no facts`);
  }
});

test('metrics: clampDays bounds the ONLY value that reaches an interpolated SQL interval', () => {
  const { clampDays } = metrics._internals;
  assert.equal(clampDays(30), 30);
  assert.equal(clampDays(0), 30);
  assert.equal(clampDays(-5), 1);
  assert.equal(clampDays(99999), 730);
  assert.equal(clampDays('7; DROP TABLE orders'), 7);
  assert.equal(clampDays(undefined), 30);
});

test('suggestions: the feed never proposes touching the rep-approval queue', async () => {
  // ⛔ Same ruling as the registry test above. This queue looks exactly like a backlog worth
  // clearing («~11.7M IQD stranded!»), which is why the refusal is asserted and not just
  // written down.
  const { build } = require('../lib/adminSuggestions');
  const { suggestions } = await build();
  for (const s of suggestions) {
    assert.equal(
      /موافقة الممثل|بانتظار موافقة/.test(`${s.title} ${s.detail}`),
      false,
      `suggestion ${s.id} points at the rep-approval queue`
    );
  }
  // Every suggestion must end somewhere tappable — one with nothing to tap is a complaint.
  for (const s of suggestions) assert.match(s.href, /^\//);
});
