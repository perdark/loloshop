// The production queue must carry `search_text` (bug 8, part 2).
//
// WHY THIS DESERVES A TEST. The console's search box is client-side over the rows it was
// handed, so the field IS the feature: drop it from the SELECT and search silently stops
// finding pieces by their التطريز text. Nothing throws, no request fails, and the symptom —
// «this piece is not in the system» for a garment the worker is physically holding — reads
// as a data problem, not as a missing column. It is also the kind of line a reviewer tidies
// out of a 40-line SELECT because no screen renders it.
//
// ⚠️ THE FIELD MOVED FROM A CORRELATED SUBQUERY TO A GROUPED CTE (2026-09-08, perf) and the
// assertions below moved with it. What is being guarded did NOT change: the field exists, it
// is the student's own words deduped, blanks are excluded, and it is SCOPED TO ONE ORDER. The
// scoping is now carried by `GROUP BY order_id` plus the join predicate instead of a WHERE
// inside the SELECT list — same guarantee, different shape, and an unscoped version would
// still hand every piece the whole shop's text. Measured on prod: 186ms/55,678 buffers →
// 117ms/23,601, byte-identical output across all 4,961 rows.
//
// No database: lib/db is stubbed in require.cache and the SQL is inspected as text.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

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

let captured = [];
stubModule('../lib/db', {
  query: async (sql, params) => {
    captured.push({ sql, params });
    return { rows: [], rowCount: 0 };
  },
  tx: async () => ({}),
});

const production = require('../controllers/productionController');

const MANAGER = { id: 'm1', role: 'staff', staff_types: ['manager'], name: 'manager' };

/** Run getQueue with a fake req/res and hand back the SQL it issued. */
async function queueSql(query = {}) {
  captured = [];
  const req = { user: MANAGER, query };
  const res = { json() {}, status() { return this; } };
  await production.getQueue(req, res);
  return captured.map((c) => c.sql).join('\n');
}

test('the queue SELECT carries search_text, aggregated from order_items', async () => {
  const sql = await queueSql();
  assert.match(sql, /AS search_text/, 'the console searches this field — without it the box goes blind');
  assert.match(sql, /oi\.search_text/, 'the row must actually select it from the aggregate');
  assert.match(sql, /string_agg\(DISTINCT customer_text/, 'it is the words the STUDENT typed, deduped');
  assert.match(sql, /FROM order_items/);
});

test('empty and NULL customer_text are excluded, so the field is null rather than blank noise', async () => {
  const sql = await queueSql();
  assert.match(sql, /customer_text IS NOT NULL/);
  assert.match(sql, /customer_text <> ''/);
});

test('the aggregate is scoped to the row it rides on', async () => {
  const sql = await queueSql();
  // Two halves, and BOTH are required: the CTE collapses order_items per order, and the join
  // hands each queue row only its own group. Drop either and every piece gets everyone's text.
  assert.match(
    sql,
    /GROUP BY order_id/,
    'an unscoped aggregate would hand every piece the whole shop\u2019s text'
  );
  assert.match(
    sql,
    /LEFT JOIN oi ON oi\.order_id = o\.id/,
    'the aggregate must be joined back on the order it belongs to'
  );
});

test('group_price is aggregated once per checkout group, not per row', async () => {
  const sql = await queueSql();
  // Same rewrite, same trap: a طقم's bundle total must come from the group, and the LEFT JOIN
  // is what keeps a solo piece (checkout_group_id IS NULL) at NULL rather than 0.
  assert.match(sql, /GROUP BY checkout_group_id/);
  assert.match(sql, /LEFT JOIN gp ON gp\.checkout_group_id = o\.checkout_group_id/);
  assert.match(sql, /status::text <> 'cancelled'/, 'a cancelled piece must not inflate the bundle total');
});
