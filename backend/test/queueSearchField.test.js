// The production queue must carry `search_text` (bug 8, part 2).
//
// WHY THIS DESERVES A TEST. The console's search box is client-side over the rows it was
// handed, so the field IS the feature: drop it from the SELECT and search silently stops
// finding pieces by their التطريز text. Nothing throws, no request fails, and the symptom —
// «this piece is not in the system» for a garment the worker is physically holding — reads
// as a data problem, not as a missing column. It is also the kind of line a reviewer tidies
// out of a 40-line SELECT because no screen renders it.
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
  assert.match(sql, /string_agg\(DISTINCT oi3\.customer_text/, 'it is the words the STUDENT typed, deduped');
  assert.match(sql, /FROM order_items oi3/);
});

test('empty and NULL customer_text are excluded, so the field is null rather than blank noise', async () => {
  const sql = await queueSql();
  assert.match(sql, /oi3\.customer_text IS NOT NULL/);
  assert.match(sql, /oi3\.customer_text <> ''/);
});

test('the aggregate is scoped to the row it rides on', async () => {
  const sql = await queueSql();
  assert.match(
    sql,
    /WHERE oi3\.order_id = o\.id/,
    'an unscoped aggregate would hand every piece the whole shop’s text'
  );
});
