'use strict';
// Owner change 2026-09-01: «أيادي التصميم» — a member finishes their OWN job and sends it
// straight to التطريز, without waiting for محمد's اعتماد.
//
// WHAT THIS FILE PINS, and why each half needs pinning:
//
//  1. THE GUARD MOVED, AND IT MOVED TO `requireTeamAccess`, NOT `requireTeamWorker`.
//     `requireTeamWorker` demands a membership row and an ADMIN deliberately has none
//     (attachTeamMember lets admin through the module without one), so the obvious guard
//     would have 403'd the admin half of the path this change had to leave working.
//  2. WHICH job a member may finish is decided INSIDE approveJob, not by the route:
//     theirs, or nobody's. A job another member holds is 409 ERR_TASK_UNAVAILABLE — and
//     the order must NOT move on that refusal. That last clause is the sharp edge:
//     `lib/db.tx` COMMITS on a normal return, so a `return {conflict:true}` written after
//     the orders UPDATE would have shipped the piece to التطريز while answering 409.
//  3. The audit row separates a member's self-finish from a lead/admin اعتماد, months
//     later, from the row alone.
//
// ⚠️ THE LEAD IS THE ONE ACTOR THAT IS NOT A REAL ROSTER ROW HERE. `uq_design_team_active_lead`
// permits exactly ONE active lead per team and the database already has محمد هيثم; inserting a
// second would either fail or force the test to deactivate the real one. So the lead's
// `req.designTeamMember` is built by hand — and test 0 proves that hand-built shape is
// byte-for-byte what the real `attachTeamMember` middleware produces for a real roster row,
// so the mock cannot drift away from the thing it stands in for. The two HELPERS and the
// ADMIN are real rows driven through the real middleware.
//
// ⚠️ TWO SEPARATE RULES ABOUT FIXTURES HERE, BOTH ABOUT OTHER FILES' LIVE COUNTS, and
// `node --test test/*.test.js` runs the files CONCURRENTLY, so both are real:
//   · Every order this file MOVES is deleted inside the test that moved it, never only in
//     cleanup — `adminNumbers.test.js` compares two live COUNT queries and a row moving
//     between them straddles them (measured once: off by exactly one).
//   · Every `users` row this file needs is created in ONE burst in test.before and dropped in
//     ONE burst in test.after, never scattered through the test bodies. `resolveAudience`
//     (lib/pushBroadcast.js) answers `{kind:'all'}` with `SELECT u.id FROM users u WHERE
//     u.deleted_at IS NULL` — EVERY account, no role filter — and
//     `anonymousDevicePush.test.js:220` asserts two such calls agree. Any file inserting a
//     user between them makes them differ by one; a fixture that is already there when the
//     first count runs is in both and harmless. Hence the whole job pool below is pre-built.
// What CANNOT be designed away is that finishing a job IS a move, and `adminNumbers.test.js`
// («قابل للعمل» …) counts the whole live `orders` table twice. Measured over four full runs on
// 2026-09-01: the suite throws roughly one random cross-file COUNT flake per run WITH OR
// WITHOUT this file — the baseline run, before this file existed, failed `allocatePin` the same
// way. If you see `adminNumbers` off by exactly one, re-run before you go looking for a bug.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { query } = require('../lib/db');
const c = require('../controllers/designTeamController');

const TAG = `ZZTEST-deskfinish-${crypto.randomUUID().slice(0, 8)}`;
const fx = { products: [], users: [], students: [], orders: [] };
const ctx = {};
// One job per case, in test order. Named so a failure says which case owns the row.
const JOB_LABELS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح', 'ط'];

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
  };
  return res;
}

async function call(handler, req) {
  const res = mockRes();
  await handler(req, res);
  return res;
}

// Run a route guard the way Express would and report what it did.
async function guard(fn, req) {
  const res = mockRes();
  let passed = false;
  await fn(req, res, () => { passed = true; });
  return { passed, statusCode: res.statusCode, body: res.body };
}

const newPhone = () => `079${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function insertUser(name, role) {
  // ⚠️ `users.phone` is UNIQUE and every fixture in the suite mints from the same random
  // 8-digit space against a table that already holds 2,300 real numbers, so a collision is
  // rare but real — one broke a concurrent run on 2026-09-01. Redraw instead of failing.
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { rows } = await query(
        `INSERT INTO users (name, phone, password_hash, role, phone_verified)
         VALUES ($1, $2, 'x', $3::user_role, TRUE) RETURNING id, name, role`,
        [`${TAG} ${name}`, newPhone(), role]
      );
      fx.users.push(rows[0].id);
      return rows[0];
    } catch (err) {
      if (err?.code !== '23505' || attempt >= 4) throw err;
    }
  }
}

// A real roster row + the request the real middleware builds from it.
async function insertMember(name, memberRole) {
  const user = await insertUser(name, memberRole === 'lead' ? 'staff' : 'design_helper');
  await query(
    `INSERT INTO design_team_members (team_id, user_id, member_role, active)
     VALUES (TRUE, $1, $2::design_team_member_role, TRUE)`,
    [user.id, memberRole]
  );
  return user;
}

// Build the request Express would hand a controller: authRequired's `req.user`, then
// attachTeamMember's `req.designTeamMember` — the REAL middleware, so the roster read
// under test is the production one.
async function reqFor(user, params = {}, body = {}) {
  const req = { user: { id: user.id, name: user.name, role: user.role }, params, body };
  await new Promise((resolve, reject) => {
    c.attachTeamMember(req, mockRes(), (err) => (err ? reject(err) : resolve()));
  });
  return req;
}

// A retail order sitting exactly where the desk looks for one: retail student, first
// design stage, no `designs` row, embroidered, not handed back. Its own student, because
// `uq_orders_student_product_nodesign` allows one such order per (student, product).
async function insertJob(label) {
  const user = await insertUser(label, 'retail');
  const s = await query(
    `INSERT INTO students (user_id, full_name_third, status, wholesaler_id, gender)
     VALUES ($1, $2, 'approved', NULL, 'female') RETURNING id`,
    [user.id, `${TAG} ${label}`]
  );
  fx.students.push(s.rows[0].id);
  const o = await query(
    `INSERT INTO orders (student_id, product_id, price, status, has_embroidery, returned_to_customer)
     VALUES ($1, $2, 25000, 'design_complete', TRUE, FALSE) RETURNING id`,
    [s.rows[0].id, ctx.product]
  );
  fx.orders.push(o.rows[0].id);
  return { orderId: o.rows[0].id, studentUserId: user.id };
}

// Take a moved fixture straight back out of the live pipeline — see the header.
async function retire(orderId) {
  await query(`DELETE FROM audit_log WHERE entity = 'order' AND entity_id = $1`, [orderId]);
  await query(`DELETE FROM orders WHERE id = $1`, [orderId]); // cascades design_team_tasks
  fx.orders = fx.orders.filter((id) => id !== orderId);
  const left = await query(
    `SELECT count(*)::int AS n FROM orders WHERE id = $1 AND status::text <> 'cancelled'`,
    [orderId]
  );
  assert.strictEqual(left.rows[0].n, 0, 'the fixture must not be left standing in a live stage');
}

const orderStatus = async (orderId) =>
  (await query(`SELECT status::text AS s FROM orders WHERE id = $1`, [orderId])).rows[0].s;

const taskRow = async (orderId) =>
  (await query(`SELECT * FROM design_team_tasks WHERE order_id = $1`, [orderId])).rows[0] || null;

const approveAudit = async (orderId) =>
  (await query(
    `SELECT actor_id, details FROM audit_log
      WHERE action = 'approve_design' AND entity = 'order' AND entity_id = $1
      ORDER BY created_at DESC LIMIT 1`,
    [orderId]
  )).rows[0] || null;

test.before(async () => {
  const p = await query(
    `INSERT INTO products (name_ar, type, base_price, sort) VALUES ($1, 'sash', 25000, 0) RETURNING id`,
    [`${TAG} وشاح`]
  );
  ctx.product = p.rows[0].id;
  fx.products.push(ctx.product);

  ctx.helperA = await insertMember('عضو أ', 'helper');
  ctx.helperB = await insertMember('عضو ب', 'helper');
  ctx.adminUser = await insertUser('مدير', 'admin');
  // The lead: a real user, but NO roster row — see the header. Test 0 pins the mock's shape
  // against what the real middleware builds, so the two cannot drift apart.
  ctx.leadUser = await insertUser('قائد', 'staff');
  ctx.leadMember = { id: crypto.randomUUID(), team_id: true, member_role: 'lead', active: true };
  ctx.outsider = await insertUser('غريب', 'retail');

  // One order per case, all built here — see the second rule in the header. Each has its own
  // student because `uq_orders_student_product_nodesign` allows one such order per (student,
  // product), and they sit still at design_complete until the test that moves one moves it.
  ctx.jobs = {};
  for (const label of JOB_LABELS) ctx.jobs[label] = await insertJob(`طالبة ${label}`);
});

test.after(async () => {
  await query(`DELETE FROM audit_log WHERE entity = 'order' AND entity_id = ANY($1::uuid[])`, [fx.orders]);
  await query(`DELETE FROM design_team_tasks WHERE order_id = ANY($1::uuid[])`, [fx.orders]);
  await query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [fx.orders]);
  await query(`DELETE FROM orders WHERE student_id = ANY($1::uuid[])`, [fx.students]);
  await query(`DELETE FROM students WHERE id = ANY($1::uuid[])`, [fx.students]);
  await query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [fx.products]);
  // design_team_members + notifications both cascade from users.
  await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [fx.users]);
  const left = await query(`SELECT count(*)::int AS n FROM users WHERE name LIKE $1`, [`${TAG}%`]);
  assert.strictEqual(left.rows[0].n, 0, 'fixture rows left behind');
  // The real roster must be exactly as it was found.
  const lead = await query(
    `SELECT count(*)::int AS n FROM design_team_members WHERE member_role = 'lead' AND active = TRUE`
  );
  assert.strictEqual(lead.rows[0].n, 1, 'the single active lead invariant must survive this file');
});

// ───────────────────────── the actors ─────────────────────────

test('0 — the lead stand-in is the exact shape attachTeamMember builds from a real row', async () => {
  const real = await reqFor(ctx.helperA);
  assert.deepStrictEqual(
    Object.keys(real.designTeamMember).sort(),
    ['active', 'id', 'member_role', 'team_id'],
    'if the middleware starts attaching more, the lead stand-in below must follow'
  );
  assert.strictEqual(real.designTeamMember.active, true);
  assert.strictEqual(real.designTeamMember.member_role, 'helper');
  assert.deepStrictEqual(
    Object.keys(ctx.leadMember).sort(),
    Object.keys(real.designTeamMember).sort(),
    'the hand-built lead row must stay the same shape as a real one'
  );
});

const leadReq = (params = {}, body = {}) => ({
  user: { id: ctx.leadUser.id, name: ctx.leadUser.name, role: 'staff' },
  designTeamMember: ctx.leadMember,
  params,
  body,
});

// ───────────────────────── the route guard ─────────────────────────

test('1 — the OLD guard is what kept a member out, and the new one lets them in', async () => {
  const memberReq = await reqFor(ctx.helperA);
  const adminReq = await reqFor(ctx.adminUser);

  // The guard the approve route used to carry.
  assert.strictEqual((await guard(c.requireTeamLead, memberReq)).passed, false, 'the old guard 403d a member');
  assert.strictEqual((await guard(c.requireTeamLead, memberReq)).statusCode, 403);

  // The guard it carries now: admin OR any active member.
  assert.strictEqual((await guard(c.requireTeamAccess, memberReq)).passed, true);
  assert.strictEqual((await guard(c.requireTeamAccess, adminReq)).passed, true);
  assert.strictEqual((await guard(c.requireTeamAccess, leadReq())).passed, true);

  // …and why it is NOT requireTeamWorker: the admin has no roster row on purpose.
  assert.strictEqual(adminReq.designTeamMember, null, 'the admin is admitted without a membership row');
  assert.strictEqual(
    (await guard(c.requireTeamWorker, adminReq)).passed,
    false,
    'requireTeamWorker would have 403d the admin — this is the regression the choice avoids'
  );

  // A signed-in nobody still gets nothing.
  const outsider = await reqFor(ctx.outsider);
  assert.strictEqual((await guard(c.requireTeamAccess, outsider)).passed, false);
  assert.strictEqual((await guard(c.requireTeamAccess, outsider)).statusCode, 403);
});

// ───────────────────────── the finish itself ─────────────────────────

test('2 — a member finishes their OWN claimed job: it lands in التطريز', async () => {
  const job = ctx.jobs['أ'];
  const claim = await call(c.claimJob, await reqFor(ctx.helperA, { orderId: job.orderId }));
  assert.strictEqual(claim.statusCode, 200, JSON.stringify(claim.body));

  const res = await call(c.approveJob, await reqFor(ctx.helperA, { orderId: job.orderId }));
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.data.approval_status, 'approved');
  assert.strictEqual(res.body.data.self_finished, true);

  assert.strictEqual(await orderStatus(job.orderId), 'embroidery', 'the order must leave the desk');
  const t = await taskRow(job.orderId);
  assert.ok(t, 'the task row must survive the finish');
  assert.ok(t.resolved_at, 'the task must be resolved');
  assert.strictEqual(t.status, 'ready');
  assert.strictEqual(t.assigned_to, ctx.helperA.id, 'it stays the finisher’s job');

  // The student is told, exactly as they are when محمد approves.
  const n = await query(
    `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'design_approved'`,
    [job.studentUserId]
  );
  assert.strictEqual(n.rows[0].n, 1, 'the student must still be notified');

  await retire(job.orderId);
});

test('3 — a member may NOT finish a job another member is holding, and it does not move', async () => {
  const job = ctx.jobs['ب'];
  const claim = await call(c.claimJob, await reqFor(ctx.helperB, { orderId: job.orderId }));
  assert.strictEqual(claim.statusCode, 200, JSON.stringify(claim.body));

  const res = await call(c.approveJob, await reqFor(ctx.helperA, { orderId: job.orderId }));
  assert.strictEqual(res.statusCode, 409, JSON.stringify(res.body));
  assert.strictEqual(res.body.code, 'ERR_TASK_UNAVAILABLE');
  assert.ok(/[\u0600-\u06FF]/.test(res.body.error), 'the message must be Arabic');

  // THE POINT OF THE TEST: `tx` commits on a normal return, so a refusal written after the
  // orders UPDATE would answer 409 and ship the piece anyway.
  assert.strictEqual(await orderStatus(job.orderId), 'design_complete', 'the refused order must not move');
  const t = await taskRow(job.orderId);
  assert.strictEqual(t.assigned_to, ctx.helperB.id, 'the holder must keep the job');
  assert.strictEqual(t.resolved_at, null, 'the refused task must not be resolved');
  assert.strictEqual(await approveAudit(job.orderId), null, 'a refusal writes no approval');

  await retire(job.orderId);
});

test('4 — a member CAN finish a job nobody has claimed, and the desk records who did', async () => {
  const job = ctx.jobs['ج'];
  assert.strictEqual(await taskRow(job.orderId), null, 'this job starts with no task row at all');

  const res = await call(c.approveJob, await reqFor(ctx.helperA, { orderId: job.orderId }));
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(await orderStatus(job.orderId), 'embroidery');

  const t = await taskRow(job.orderId);
  assert.ok(t, 'the task row is created by the finish so the work has an owner in the ledger');
  assert.strictEqual(t.assigned_to, ctx.helperA.id);
  assert.strictEqual(t.ready_by, ctx.helperA.id);
  assert.ok(t.resolved_at);

  await retire(job.orderId);
});

test('5 — the LEAD still finishes a job another member is holding', async () => {
  const job = ctx.jobs['د'];
  const claim = await call(c.claimJob, await reqFor(ctx.helperB, { orderId: job.orderId }));
  assert.strictEqual(claim.statusCode, 200, JSON.stringify(claim.body));

  const res = await call(c.approveJob, leadReq({ orderId: job.orderId }));
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.data.self_finished, false, 'محمد يعتمد، ما ينهي عمله هو');
  assert.strictEqual(await orderStatus(job.orderId), 'embroidery');

  const t = await taskRow(job.orderId);
  assert.ok(t.resolved_at, 'the lead resolves the member’s task');
  assert.strictEqual(t.assigned_to, ctx.helperB.id, 'the lead does not steal the credit');

  await retire(job.orderId);
});

test('6 — the ADMIN, who has no roster row, still finishes any job', async () => {
  const job = ctx.jobs['هـ'];
  const claim = await call(c.claimJob, await reqFor(ctx.helperA, { orderId: job.orderId }));
  assert.strictEqual(claim.statusCode, 200, JSON.stringify(claim.body));

  const req = await reqFor(ctx.adminUser, { orderId: job.orderId });
  assert.strictEqual(req.designTeamMember, null);
  const res = await call(c.approveJob, req);
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.data.self_finished, false);
  assert.strictEqual(await orderStatus(job.orderId), 'embroidery');

  await retire(job.orderId);
});

// ───────────────────────── the audit trail ─────────────────────────

test('7 — the audit row tells a member’s self-finish from a lead/admin اعتماد', async () => {
  const own = ctx.jobs['و'];
  await call(c.claimJob, await reqFor(ctx.helperA, { orderId: own.orderId }));
  await call(c.approveJob, await reqFor(ctx.helperA, { orderId: own.orderId }));
  const selfRow = await approveAudit(own.orderId);
  assert.ok(selfRow, 'a finish must be audited');
  assert.strictEqual(selfRow.actor_id, ctx.helperA.id);
  assert.strictEqual(selfRow.details.design_team, true, 'the desk marker the old rows carry stays');
  assert.strictEqual(selfRow.details.self_finished, true);
  assert.strictEqual(selfRow.details.member_role, 'helper');
  await retire(own.orderId);

  const byLead = ctx.jobs['ز'];
  await call(c.approveJob, leadReq({ orderId: byLead.orderId }));
  const leadRow = await approveAudit(byLead.orderId);
  assert.strictEqual(leadRow.details.design_team, true);
  assert.strictEqual(leadRow.details.self_finished, false, 'this is the flag the owner reads');
  assert.strictEqual(leadRow.details.member_role, 'lead');
  await retire(byLead.orderId);

  const byAdmin = ctx.jobs['ح'];
  await call(c.approveJob, await reqFor(ctx.adminUser, { orderId: byAdmin.orderId }));
  const adminRow = await approveAudit(byAdmin.orderId);
  assert.strictEqual(adminRow.details.self_finished, false);
  assert.strictEqual(adminRow.details.member_role, null, 'null is what tells the admin from the lead');
  await retire(byAdmin.orderId);
});

// ───────────────────────── the boundary is unchanged ─────────────────────────

test('8 — the desk still only reaches a RETAIL order at the first design stage', async () => {
  const job = ctx.jobs['ط'];
  // Anything that takes the order out of the desk's own WHERE takes it out of reach —
  // lockRetailPendingOrder is the second boundary, and it did not move with the guard.
  await query(`UPDATE orders SET returned_to_customer = TRUE WHERE id = $1`, [job.orderId]);
  const res = await call(c.approveJob, await reqFor(ctx.helperA, { orderId: job.orderId }));
  assert.strictEqual(res.statusCode, 404, JSON.stringify(res.body));
  assert.strictEqual(res.body.code, 'ERR_NOT_FOUND');
  assert.strictEqual(await orderStatus(job.orderId), 'design_complete');

  const bad = await call(c.approveJob, await reqFor(ctx.helperA, { orderId: 'not-a-uuid' }));
  assert.strictEqual(bad.statusCode, 400);
  assert.strictEqual(bad.body.code, 'ERR_VALIDATION');

  await retire(job.orderId);
});
