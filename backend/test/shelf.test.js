'use strict';
// رف التجهيز — pure-logic + live-DB tests.
// Runs against the LAPTOP-LOCAL dev PG (:5433). Self-cleaning: every row it creates is
// removed in the finally block. Never point this at prod.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert');
const shelf = require('../lib/shelf');
const { query } = require('../lib/db');

// ---------- pure logic (no DB writes) ----------

test('slotCode pads to two digits', () => {
  assert.strictEqual(shelf.slotCode('A', 3), 'A03');
  assert.strictEqual(shelf.slotCode('C', 7), 'C07');
  assert.strictEqual(shelf.slotCode('B', 15), 'B15');
});

test('sections derive consecutive slot ranges; شال sits after the cap section', async () => {
  const s = await shelf.loadSections();
  const robe = s.find((x) => x.piece_type === 'robe');
  const sash = s.find((x) => x.piece_type === 'sash');
  const cap = s.find((x) => x.piece_type === 'cap');
  const shawl = s.find((x) => x.piece_type === 'shawl');

  assert.deepStrictEqual([robe.slot_from, robe.slot_to], [1, 10]);
  assert.deepStrictEqual([sash.slot_from, sash.slot_to], [1, 15]);
  assert.deepStrictEqual([cap.slot_from, cap.slot_to], [1, 6]);
  // The whole point of per-section config: شال shares shelf C but starts AFTER the caps.
  assert.deepStrictEqual([shawl.slot_from, shawl.slot_to], [7, 7]);
  assert.strictEqual(shawl.mode, 'shared');
  assert.strictEqual(shawl.max_per_slot, null);
});

test('suggestSlot: empty section → lowest free index', async () => {
  const robe = (await shelf.loadSections()).find((x) => x.piece_type === 'robe');
  assert.deepStrictEqual(shelf.suggestSlot(robe, 'S1', []), {
    shelf_code: 'A',
    slot_index: 1,
    over: false,
  });
});

test('suggestSlot: reuses the student OWN bin and flags it over at max', async () => {
  const robe = (await shelf.loadSections()).find((x) => x.piece_type === 'robe');
  const own = [{ shelf_code: 'A', slot_index: 2, student_id: 'S1', live_count: 10 }];
  assert.deepStrictEqual(shelf.suggestSlot(robe, 'S1', own), {
    shelf_code: 'A',
    slot_index: 2,
    over: true, // at max — allowed (D4), just flagged
  });
});

test('suggestSlot: a DIFFERENT student bin is skipped, never reused', async () => {
  const robe = (await shelf.loadSections()).find((x) => x.piece_type === 'robe');
  const other = [{ shelf_code: 'A', slot_index: 1, student_id: 'OTHER', live_count: 1 }];
  assert.deepStrictEqual(shelf.suggestSlot(robe, 'S1', other), {
    shelf_code: 'A',
    slot_index: 2,
    over: false,
  });
});

test('suggestSlot: full section → null («بلا خانة»)', async () => {
  const cap = (await shelf.loadSections()).find((x) => x.piece_type === 'cap');
  const full = Array.from({ length: 6 }, (_, i) => ({
    shelf_code: 'C',
    slot_index: i + 1,
    student_id: `OTHER${i}`,
    live_count: 1,
  }));
  assert.strictEqual(shelf.suggestSlot(cap, 'S1', full), null);
});

test('suggestSlot: shared bin always returns its slot regardless of student or depth', async () => {
  const shawl = (await shelf.loadSections()).find((x) => x.piece_type === 'shawl');
  const deep = [{ shelf_code: 'C', slot_index: 7, student_id: null, live_count: 40 }];
  assert.deepStrictEqual(shelf.suggestSlot(shawl, 'anyone', deep), {
    shelf_code: 'C',
    slot_index: 7,
    over: false, // shared bins have no max
  });
});

// ---------- live DB ----------

async function pickRetailOrder(pieceType) {
  const { rows } = await query(
    `SELECT o.id, o.student_id, o.status
       FROM orders o
       JOIN students st ON st.id = o.student_id
       JOIN products p  ON p.id  = o.product_id
      WHERE st.wholesaler_id IS NULL AND p.type = $1 AND o.status = 'preparing'
      LIMIT 1`,
    [pieceType]
  );
  return rows[0] || null;
}

const USER = { id: null };

test('live: place → board shows the bin → release frees it', async (t) => {
  const order = await pickRetailOrder('cap');
  if (!order) return t.skip('no retail cap at preparing in this snapshot');

  const admin = await query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  USER.id = admin.rows[0].id;

  try {
    const placed = await shelf.placePiece(order.id, USER);
    assert.match(placed.slot_code, /^C0[1-6]$/, 'cap must land in the cap section C01–C06');
    assert.strictEqual(placed.over, false);

    const board = await shelf.buildBoard();
    const shelfC = board.shelves.find((s) => s.code === 'C');
    const bin = shelfC.slots.find((s) => s.slot_code === placed.slot_code);
    assert.strictEqual(bin.count, 1);
    assert.strictEqual(bin.student_id, order.student_id);
    assert.ok(['ready', 'waiting'].includes(bin.state));

    // The piece must have left the inbox now that it has an address.
    assert.ok(!board.inbox.some((i) => i.order_id === order.id));

    await shelf.releaseForOrder(order.id);
    const after = await query(
      'SELECT COUNT(*)::int n FROM shelf_placements WHERE order_id = $1',
      [order.id]
    );
    assert.strictEqual(after.rows[0].n, 0);

    const closed = await query(
      `SELECT closed_at FROM shelf_slot_occupancy
        WHERE shelf_code = 'C' AND slot_index = $1 ORDER BY id DESC LIMIT 1`,
      [Number(placed.slot_code.slice(1))]
    );
    assert.ok(closed.rows[0].closed_at, 'emptied bin must be CLOSED, not left open');
  } finally {
    await query('DELETE FROM shelf_placements WHERE order_id = $1', [order.id]);
    await query(
      `DELETE FROM shelf_slot_occupancy so
        WHERE NOT EXISTS (SELECT 1 FROM shelf_placements sp WHERE sp.occupancy_id = so.id)`
    );
  }
});

test('live: an exclusive bin refuses a SECOND student', async (t) => {
  const { rows } = await query(
    `SELECT o.id, o.student_id
       FROM orders o
       JOIN students st ON st.id = o.student_id
       JOIN products p  ON p.id  = o.product_id
      WHERE st.wholesaler_id IS NULL AND p.type = 'cap' AND o.status = 'preparing'
      LIMIT 20`
  );
  const a = rows[0];
  const b = rows.find((r) => r.student_id !== a?.student_id);
  if (!a || !b) return t.skip('need two distinct retail cap students');

  const admin = await query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  const user = { id: admin.rows[0].id };

  try {
    const placed = await shelf.placePiece(a.id, user);
    const idx = Number(placed.slot_code.slice(1));
    await assert.rejects(
      () => shelf.placePiece(b.id, user, { shelf_code: 'C', slot_index: idx }),
      (err) => err instanceof shelf.ShelfError && err.code === 'ERR_SLOT_TAKEN'
    );
  } finally {
    await query('DELETE FROM shelf_placements WHERE order_id = ANY($1)', [[a.id, b.id]]);
    await query(
      `DELETE FROM shelf_slot_occupancy so
        WHERE NOT EXISTS (SELECT 1 FROM shelf_placements sp WHERE sp.occupancy_id = so.id)`
    );
  }
});

test('live: a rep-linked piece is refused (retail-only, D1)', async (t) => {
  const { rows } = await query(
    `SELECT o.id FROM orders o
       JOIN students st ON st.id = o.student_id
      WHERE st.wholesaler_id IS NOT NULL AND o.status = 'preparing' LIMIT 1`
  );
  if (!rows.length) return t.skip('no rep piece at preparing');
  const admin = await query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  await assert.rejects(
    () => shelf.placePiece(rows[0].id, { id: admin.rows[0].id }),
    (err) => err instanceof shelf.ShelfError && err.code === 'ERR_NOT_RETAIL'
  );
});

test('live: reverting a piece out of التجهيز frees its خانة (no phantom bin)', async (t) => {
  const order = await pickRetailOrder('cap');
  if (!order) return t.skip('no retail cap at preparing in this snapshot');
  const admin = await query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  const user = { id: admin.rows[0].id, role: 'admin' };

  let placed;
  try {
    placed = await shelf.placePiece(order.id, user);
    const idx = Number(placed.slot_code.slice(1));

    // Simulate exactly what productionController.revert does for a piece at preparing.
    await shelf.releaseForOrder(order.id);

    const live = await query(
      'SELECT COUNT(*)::int n FROM shelf_placements WHERE order_id = $1',
      [order.id]
    );
    assert.strictEqual(live.rows[0].n, 0, 'placement must be gone');

    const open = await query(
      `SELECT COUNT(*)::int n FROM shelf_slot_occupancy
        WHERE shelf_code = 'C' AND slot_index = $1 AND closed_at IS NULL`,
      [idx]
    );
    assert.strictEqual(open.rows[0].n, 0, 'bin must be CLOSED — a phantom bin is the bug');

    // And the slot must be re-usable straight away.
    const board = await shelf.buildBoard();
    const slot = board.shelves.find((s) => s.code === 'C').slots.find((s) => s.index === idx);
    assert.strictEqual(slot.state, 'empty');
    assert.strictEqual(slot.count, 0);
  } finally {
    await query('DELETE FROM shelf_placements WHERE order_id = $1', [order.id]);
    await query(
      `DELETE FROM shelf_slot_occupancy so
        WHERE NOT EXISTS (SELECT 1 FROM shelf_placements sp WHERE sp.occupancy_id = so.id)`
    );
  }
});

test('live: board is retail-only and internally consistent', async () => {
  const board = await shelf.buildBoard();
  assert.strictEqual(board.sections.length, 4);
  assert.strictEqual(board.shelves.length, 3);

  const a = board.shelves.find((s) => s.code === 'A');
  const c = board.shelves.find((s) => s.code === 'C');
  assert.strictEqual(a.slots.length, 10);
  assert.strictEqual(c.slots.length, 7); // 6 cap + 1 شال
  assert.strictEqual(c.slots[6].mode, 'shared');
  assert.strictEqual(c.slots[6].piece_type, 'shawl');

  // Every set must classify, and a ready set must have no upstream piece.
  for (const s of board.sets) {
    assert.ok(['ready', 'waiting'].includes(s.state));
    if (s.state === 'ready') assert.strictEqual(s.waiting_for.length, 0);
  }
  // Inbox entries are by definition un-shelved pieces sitting at التجهيز.
  for (const i of board.inbox) {
    assert.ok(i.piece_label);
  }
});
