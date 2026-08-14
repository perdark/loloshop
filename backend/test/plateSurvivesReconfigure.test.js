// The calligraphy plate must survive an order rebuild — 2026-08-14.
//
// WHY THE SOURCE-LEVEL TEST BELOW EXISTS, and why it is not "brittle grep".
//
// The bug is not a wrong value. It is an OMISSION: a `configure*` endpoint rebuilds an order by
// DELETEing every `order_items` row and re-INSERTing from the request payload, and the generated
// plate is server-side so it is never in that payload. Nothing fails, nothing logs — a designer's
// paid-for artwork is simply gone.
//
// A behavioural test can only cover the paths that exist TODAY. The way this defect actually
// spread was by someone adding ANOTHER rebuild path later and not knowing the column existed —
// which is exactly how `fullSetOrder` got fixed in Track B while three sites in `orderController`
// stayed broken. So the guard has to be over the shape of the code, not one path's behaviour:
// every INSERT into `order_items` that can follow a DELETE must carry `plate_image_url`, and any
// exception must be named here with a reason.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { capturePlates, plateFor } = require('../lib/platePreservation');

// ── The helper's contract ─────────────────────────────────────────────────

test('capturePlates keys the plate by the line label', async () => {
  const fakeClient = {
    query: async () => ({
      rows: [
        { label_snapshot: 'اسم الطالب', plate_image_url: '/uploads/calligraphy/plates/a.png' },
        { label_snapshot: 'تطريز القبعة', plate_image_url: '/uploads/calligraphy/plates/b.png' },
      ],
    }),
  };
  const preserved = await capturePlates(fakeClient, 'order-1');
  assert.equal(preserved.get('اسم الطالب'), '/uploads/calligraphy/plates/a.png');
  assert.equal(preserved.get('تطريز القبعة'), '/uploads/calligraphy/plates/b.png');
});

test('capturePlates asks only for lines that actually hold a plate', async () => {
  let sql = '';
  await capturePlates({ query: async (q) => { sql = q; return { rows: [] }; } }, 'order-1');
  assert.match(sql, /plate_image_url IS NOT NULL/);
  assert.match(sql, /WHERE order_id = \$1/);
});

test('plateFor returns null rather than undefined for an unplated line', () => {
  const preserved = new Map([['اسم الطالب', '/uploads/a.png']]);
  assert.equal(plateFor(preserved, 'اسم الطالب'), '/uploads/a.png');
  assert.equal(plateFor(preserved, 'سعر أساسي'), null, 'a line with no plate must insert NULL');
});

test('plateFor tolerates the new-order branch, where nothing was captured', () => {
  // The `else` branch of every configure* endpoint creates a fresh order and never calls
  // capturePlates, so it passes `undefined`. That must not throw at the INSERT.
  assert.equal(plateFor(undefined, 'اسم الطالب'), null);
});

// ── The structural guard ──────────────────────────────────────────────────

const CONTROLLER = path.join(__dirname, '..', 'controllers', 'orderController.js');

/**
 * INSERTs that legitimately omit `plate_image_url`, each with the reason it is safe.
 * Adding a name here is a deliberate decision — if you cannot write a true reason, the INSERT
 * needs the column instead.
 */
const ALLOWED_OMISSIONS = [
  {
    // upgradeToVip's DELETE is scoped to package marker rows
    // (label_snapshot LIKE 'باقة:%' ...) and deliberately keeps the real design lines, so no
    // plated line is ever destroyed. Verified 2026-08-14.
    match: /INSERT INTO order_items \(order_id, label_snapshot, price_snapshot, qty\) VALUES/,
    reason: 'upgradeToVip — scoped DELETE keeps design lines, only marker rows are rebuilt',
  },
];

test('every order_items rebuild carries the plate through', () => {
  const src = fs.readFileSync(CONTROLLER, 'utf8');
  const inserts = src.match(/INSERT INTO order_items[\s\S]{0,400}?VALUES[^`]*/g) || [];
  assert.ok(inserts.length >= 3, `expected to find the rebuild INSERTs, found ${inserts.length}`);

  const offenders = inserts.filter((stmt) => {
    if (stmt.includes('plate_image_url')) return false;
    return !ALLOWED_OMISSIONS.some((a) => a.match.test(stmt));
  });

  assert.deepEqual(
    offenders,
    [],
    'An INSERT into order_items does not carry plate_image_url. If it follows a full ' +
      '`DELETE FROM order_items`, it will destroy the designer\'s generated plate — use ' +
      'capturePlates() before the DELETE and plateFor() in the INSERT (see lib/platePreservation.js). ' +
      'If it genuinely cannot destroy a plate, add it to ALLOWED_OMISSIONS with the reason.'
  );
});

test('every full DELETE of order_items is preceded by a capture', () => {
  const src = fs.readFileSync(CONTROLLER, 'utf8');
  // Full-table deletes for one order — the dangerous shape. The scoped delete in upgradeToVip
  // carries an AND clause and is matched separately below.
  const fullDeletes = src.match(/DELETE FROM order_items WHERE order_id = \$1`/g) || [];
  const captures = src.match(/capturePlates\(/g) || [];
  assert.ok(
    captures.length >= fullDeletes.length,
    `${fullDeletes.length} unscoped DELETE FROM order_items but only ${captures.length} ` +
      'capturePlates() calls — at least one rebuild path drops the plate'
  );
});
