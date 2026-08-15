// GET /production/presence — «يعمل الآن» for the admin dashboard (bug 1).
//
// WHY THIS DESERVES A TEST. The panel existed on /staff and nowhere else; surfacing it on
// /admin added a SECOND reader of the same question, and the three ways that goes wrong are
// all silent:
//
//  1. **Drift.** Two hand-written copies of the working query stop agreeing about who is
//     "working" — /admin and /staff then show different people and neither looks broken.
//     Pinned by asserting both endpoints issue a BYTE-IDENTICAL working query.
//  2. **The guard.** A slice of manager-only data served without the manager-only guard is
//     a leak that no screen displays. Pinned with the REAL requireStaffType.
//  3. **Cost.** The whole reason presence() exists is that the dashboard polls every 30s and
//     on every production event, and monitor() runs a 30-day audit_log aggregation. If
//     someone later "simplifies" presence() into a call to monitor(), the endpoint keeps
//     working and quietly costs 5× — so the query COUNT is asserted, not just the output.
//
// No database: lib/db is stubbed in require.cache before anything loads it, and the stub is
// SQL-aware so each of monitor()'s five queries answers only its own shape.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');

/** Replace a module with a fake BEFORE anything requires it for real. */
function stubModule(request, exports) {
  const filename = require.resolve(request);
  require.cache[filename] = {
    id: filename,
    filename,
    path: path.dirname(filename),
    loaded: true,
    exports,
    children: [],
    paths: [],
  };
}

// The rows the working query "returns". Field names are the BACKEND's — the exact set
// frontend/lib/staff-types.ts declares. /staff once guessed five different names and
// rendered a blank staff name linking to /staff/orders/undefined; that bug is only
// avoidable while both sides read this same list.
const WORKING_ROWS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'embroidery',
    student_name: 'زينب علي',
    product_name: 'وشاح تخرج',
    working_staff_name: 'ابو عبدو',
    working_since: '2026-08-15T09:00:00.000Z',
  },
];

/** Every SQL string the controller sent, in order. */
let captured = [];

stubModule('../lib/db', {
  query: async (sql, params) => {
    captured.push({ sql, params });
    // Answer only the working query with rows; monitor()'s other four get empty sets so a
    // match on `working` cannot come from the stub handing the same rows to everyone.
    if (/working_staff_id/.test(sql)) return { rows: WORKING_ROWS, rowCount: WORKING_ROWS.length };
    return { rows: [], rowCount: 0 };
  },
  tx: async () => ({}),
});

// Load the REAL auth middleware (its lib/db is already stubbed), then re-export it with only
// the token-reading halves faked. requireStaffType — the guard under test — stays real.
const realAuth = require('../middleware/auth');
stubModule('../middleware/auth', {
  ...realAuth,
  // base64, not raw JSON: HTTP headers are ByteStrings and these users have Arabic names.
  authRequired: (req, res, next) => {
    req.user = JSON.parse(Buffer.from(req.headers['x-test-user'], 'base64').toString('utf8'));
    next();
  },
  authQuery: (req, res, next) => next(),
  requireRole: () => (req, res, next) => next(),
});

const express = require('express');
const productionRouter = require('../routes/production');

const ADMIN = { id: 'a1', role: 'admin', name: 'المدير' };
const MANAGER = { id: 'm1', role: 'staff', staff_types: ['manager'], name: 'مدير الإنتاج' };
const DESIGNER = { id: 'd1', role: 'staff', staff_types: ['designer'], name: 'مصمم' };

async function get(pathname, user) {
  const app = express();
  app.use(express.json());
  app.use('/api/production', productionRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/production${pathname}`, {
      headers: { 'x-test-user': Buffer.from(JSON.stringify(user)).toString('base64') },
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** The single working query out of a captured batch. */
const workingSql = (batch) => batch.filter((c) => /working_staff_id/.test(c.sql)).map((c) => c.sql);

test('GET /presence answers with the working rows under the backend field names', async () => {
  captured = [];
  const { status, body } = await get('/presence', ADMIN);
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body.data.working, WORKING_ROWS);
  const row = body.data.working[0];
  for (const field of ['id', 'status', 'student_name', 'product_name', 'working_staff_name', 'working_since']) {
    assert.ok(field in row, `the panel reads ${field} — renaming it breaks /admin and /staff at once`);
  }
});

test('presence costs ONE query; monitor costs five (the reason presence exists)', async () => {
  captured = [];
  await get('/presence', ADMIN);
  assert.strictEqual(
    captured.length,
    1,
    'presence() must not grow past its single query — the admin dashboard polls it every 30s'
  );

  captured = [];
  await get('/monitor', ADMIN);
  assert.strictEqual(captured.length, 5, 'monitor() still answers the full manager console');
  assert.ok(
    captured.some((c) => /audit_log/.test(c.sql)),
    'monitor() carries the 30-day audit_log aggregation that presence() deliberately skips'
  );
});

test('both endpoints issue the SAME working query — they cannot drift apart', async () => {
  captured = [];
  await get('/presence', ADMIN);
  const fromPresence = workingSql(captured);

  captured = [];
  await get('/monitor', ADMIN);
  const fromMonitor = workingSql(captured);

  assert.strictEqual(fromPresence.length, 1);
  assert.strictEqual(fromMonitor.length, 1);
  assert.strictEqual(
    fromPresence[0],
    fromMonitor[0],
    'the admin dashboard and the manager console must ask the same question — share workingNow(), do not copy it'
  );
});

test('«الآن» means a live claim inside a 30-minute window', async () => {
  captured = [];
  await get('/presence', ADMIN);
  const sql = workingSql(captured)[0];
  assert.match(sql, /working_staff_id IS NOT NULL/, 'an unclaimed order is nobody working');
  assert.match(sql, /INTERVAL '30 minutes'/, 'a staff member who claimed and walked away must age out');
  assert.match(sql, /ORDER BY o\.working_since DESC/, 'newest claim first — the panel reads as a feed');
});

test('the guard is the same one /monitor has: manager staff_type or admin only', async () => {
  for (const user of [ADMIN, MANAGER]) {
    const { status } = await get('/presence', user);
    assert.strictEqual(status, 200, `${user.name} may see presence`);
  }
  const denied = await get('/presence', DESIGNER);
  assert.strictEqual(denied.status, 403, 'a designer must not read the whole shop’s presence');
  assert.strictEqual(denied.body.code, 'ERR_FORBIDDEN');
});

test('admin with no ?source sees BOTH retail and representative work', async () => {
  captured = [];
  await get('/presence', ADMIN);
  assert.doesNotMatch(
    workingSql(captured)[0],
    /wholesaler_id IS (NOT )?NULL/,
    'the dashboard is the whole shop — an unasked-for source filter would hide half the team'
  );

  // …and an explicit filter is still honoured, so the parameter is not decorative.
  captured = [];
  await get('/presence?source=retail', ADMIN);
  assert.match(workingSql(captured)[0], /s\.wholesaler_id IS NULL/);
});
