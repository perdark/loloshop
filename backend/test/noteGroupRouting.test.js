'use strict';
// «ملاحظة» (migration 103) — the optional note on every قبعة/وشاح.
//
// THE ONE THING THIS FILE EXISTS TO PROVE: a note is NOT embroidery. `priceSelections` routes a
// piece to التصميم → التطريز from ANY group carrying customer text (orderController.js:577), and
// `option_groups.is_embroidery` is NULLABLE with **NULL meaning YES**. So the note group is safe
// only while it carries an explicit FALSE — and a single missed flag repeats the شال امريكي
// incident: 468 orders parked at التطريز with zero zones to stitch, for two months.
//
// The second test pins the audience. The owner asked for the note on retail students only, and
// `price_role_restriction` is enforced in the QUERY on both the catalog and the order path
// (migration 092) — a rep-linked student is priced as 'wholesaler', so 'retail' is what «الطلاب
// العاديين فقط» means. Read `test/optionGroupAudience.test.js` beside this one.

const test = require('node:test');
const assert = require('node:assert');
const { query } = require('../lib/db');
const { priceSelections } = require('../controllers/orderController');

/** An active قبعة/وشاح that carries the note group, plus that group's sole option. */
async function noteFixture() {
  const { rows } = await query(
    `SELECT p.id AS product_id, p.type, g.id AS group_id, g.is_embroidery,
            g.required, g.price_role_restriction, o.id AS option_id
       FROM products p
       JOIN option_groups g ON g.product_id = p.id AND g.name_ar = 'ملاحظة'
       JOIN options o       ON o.group_id  = g.id
      WHERE p.active AND p.type IN ('cap', 'sash')
      LIMIT 1`
  );
  return rows[0] || null;
}


/**
 * A valid selection for every OTHER required group on the product — first active option, and a
 * placeholder for any group that demands typed text. Without this the note test fails on an
 * unrelated «يرجى اختيار…», which is not what it is measuring.
 */
async function otherRequired(productId, noteGroupId) {
  const { rows } = await query(
    `SELECT g.id AS group_id, g.requires_customer_text,
            (SELECT o.id FROM options o
              WHERE o.group_id = g.id AND o.active
              ORDER BY o.sort, o.id LIMIT 1) AS option_id
       FROM option_groups g
      WHERE g.product_id = $1 AND g.active AND g.required AND g.id <> $2`,
    [productId, noteGroupId]
  );
  return rows
    .filter((r) => r.option_id)
    .map((r) => ({
      group_id: r.group_id,
      option_id: r.option_id,
      customer_text: r.requires_customer_text ? 'اختبار' : undefined,
    }));
}

test('a ملاحظة does NOT route the piece to التطريز', async (t) => {
  const f = await noteFixture();
  if (!f) return t.skip('migration 103 not applied to this database');

  // The flag itself, first — the behaviour below is only as good as this column.
  assert.strictEqual(f.is_embroidery, false, 'is_embroidery must be an explicit FALSE, not NULL');

  // The product's OTHER required groups have to be satisfied or pricing fails on them and the
  // note is never reached — that says nothing about routing, which is what this test is for.
  const priced = await priceSelections({
    productId: f.product_id,
    role: 'retail',
    selections: [
      ...(await otherRequired(f.product_id, f.group_id)),
      { group_id: f.group_id, option_id: f.option_id, customer_text: 'أريد الاسم أعرض' },
    ],
    studentGender: null,
  });

  assert.ok(priced.ok, `pricing failed: ${priced.error || ''}`);
  assert.strictEqual(
    priced.hasEmbroidery,
    false,
    'a typed note must not count as design work — see migration 096 and orderController.js:577'
  );
  // The note still has to REACH the shop; not routing it must not mean dropping it.
  const line = priced.items.find((i) => i.group_id === f.group_id);
  assert.ok(line, 'the note line is missing from the order items');
  assert.strictEqual(line.customer_text, 'أريد الاسم أعرض');
  assert.strictEqual(line.price, 0, 'a note is never a paid extra');
});

test('the note is optional — a قبعة/وشاح prices fine with no note at all', async (t) => {
  const f = await noteFixture();
  if (!f) return t.skip('migration 103 not applied to this database');
  assert.strictEqual(f.required, false, 'a required note would block checkout for every student');

  // Omitting the group entirely must not trip the `required` check.
  const priced = await priceSelections({
    productId: f.product_id,
    role: 'retail',
    selections: [],
    studentGender: null,
  });
  // Other groups on the product may legitimately be required; this only asserts that when it
  // fails, it is never the note that caused it.
  if (!priced.ok) {
    assert.ok(
      !String(priced.error || '').includes('ملاحظة'),
      `the note blocked checkout: ${priced.error}`
    );
  }
});

test('the note is retail-only, on every active قبعة and وشاح', async (t) => {
  const { rows: groups } = await query(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE g.is_embroidery IS NOT FALSE)::int AS embroidery_leak,
            count(*) FILTER (WHERE g.price_role_restriction IS DISTINCT FROM 'retail')::int AS wrong_audience
       FROM option_groups g
       JOIN products p ON p.id = g.product_id
      WHERE g.name_ar = 'ملاحظة' AND p.active AND p.type IN ('cap', 'sash')`
  );
  const g = groups[0];
  if (!g.n) return t.skip('migration 103 not applied to this database');

  assert.strictEqual(g.embroidery_leak, 0, 'every note group must carry is_embroidery = FALSE');
  assert.strictEqual(g.wrong_audience, 0, 'every note group must be «الطلاب العاديين فقط»');

  // ⚠️ COUNT WHAT THE CONFIGURATOR RENDERS, NOT WHAT THE ROW HOLDS (migration 105).
  // `buildProductFull` loads the PARENT's groups and then the child's own, so a variant with
  // its own note row shows TWO boxes — which is exactly the bug that shipped on 2026-09-06 and
  // was invisible to a per-row count. Every active قبعة/وشاح must see exactly one: its own if
  // it is a parent, its parent's if it is a variant.
  const { rows: seen } = await query(
    `SELECT count(*) FILTER (WHERE n <> 1)::int AS wrong, count(*)::int AS total FROM (
       SELECT (SELECT count(*) FROM option_groups g
                WHERE g.product_id = p.id AND g.name_ar = 'ملاحظة')
            + (SELECT count(*) FROM option_groups pg
                WHERE pg.product_id = p.parent_id AND pg.name_ar = 'ملاحظة') AS n
         FROM products p
        WHERE p.active AND p.type IN ('cap', 'sash')) x`
  );
  assert.strictEqual(
    seen[0].wrong,
    0,
    `${seen[0].wrong} of ${seen[0].total} active قبعة/وشاح render a number of note boxes other than one`
  );
});
