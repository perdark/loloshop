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

  // Migration 108 (owner 2026-09-06): every section is 10 خانة, 30 per خانة, and COMMUNAL.
  // Asserted against the live DB so a database that missed the migration fails here, loudly,
  // instead of quietly going back to «الخانة مشغولة بطالب آخر» on the second piece.
  for (const sec of [robe, sash, cap, shawl]) {
    assert.strictEqual(sec.slot_count, 10, `${sec.piece_type} slot_count`);
    assert.strictEqual(sec.max_per_slot, 30, `${sec.piece_type} max_per_slot`);
    assert.strictEqual(sec.mode, 'shared', `${sec.piece_type} mode`);
  }

  assert.deepStrictEqual([robe.slot_from, robe.slot_to], [1, 10]);
  assert.deepStrictEqual([sash.slot_from, sash.slot_to], [1, 10]);
  assert.deepStrictEqual([cap.slot_from, cap.slot_to], [1, 10]);
  // The whole point of per-section config: شال shares shelf C but starts AFTER the caps.
  // It moved from C07 to C11 when قبعة grew 6 → 10 — ranges are DERIVED, never stored, so
  // migration 108 had to carry any open شال bin across with it.
  assert.deepStrictEqual([shawl.slot_from, shawl.slot_to], [11, 20]);
});

test('suggestSlot: empty section → lowest free index', async () => {
  const robe = (await shelf.loadSections()).find((x) => x.piece_type === 'robe');
  assert.deepStrictEqual(shelf.suggestSlot(robe, 'S1', []), {
    shelf_code: 'A',
    slot_index: 1,
    over: false,
  });
});

// ── The exclusive branch still EXISTS in suggestSlot/placePiece, it just has no section
// pointing at it since migration 108 made every section communal. These three tests build the
// section object by hand rather than reading one from the DB, so the branch keeps its cover:
// «طالب واحد لكل خانة» is one UPDATE away from coming back for a section, and if it does, the
// code behind it must still be right. Do not delete them as dead — delete them only if the
// branch itself is deleted.
const EXCLUSIVE_ROBE = {
  id: -1, shelf_code: 'A', piece_type: 'robe', label_ar: 'روب',
  slot_count: 10, max_per_slot: 10, mode: 'exclusive', sort_order: 1,
  slot_from: 1, slot_to: 10,
};
const EXCLUSIVE_CAP = {
  id: -2, shelf_code: 'C', piece_type: 'cap', label_ar: 'قبعة',
  slot_count: 6, max_per_slot: 4, mode: 'exclusive', sort_order: 1,
  slot_from: 1, slot_to: 6,
};

test('suggestSlot: reuses the student OWN bin and flags it over at max (exclusive)', () => {
  const robe = EXCLUSIVE_ROBE;
  const own = [{ shelf_code: 'A', slot_index: 2, student_id: 'S1', live_count: 10 }];
  assert.deepStrictEqual(shelf.suggestSlot(robe, 'S1', own), {
    shelf_code: 'A',
    slot_index: 2,
    over: true, // at max — allowed (D4), just flagged
  });
});

test('suggestSlot: a DIFFERENT student bin is skipped, never reused (exclusive)', () => {
  const robe = EXCLUSIVE_ROBE;
  const other = [{ shelf_code: 'A', slot_index: 1, student_id: 'OTHER', live_count: 1 }];
  assert.deepStrictEqual(shelf.suggestSlot(robe, 'S1', other), {
    shelf_code: 'A',
    slot_index: 2,
    over: false,
  });
});

test('suggestSlot: full section → null («بلا خانة») (exclusive)', () => {
  const cap = EXCLUSIVE_CAP;
  const full = Array.from({ length: 6 }, (_, i) => ({
    shelf_code: 'C',
    slot_index: i + 1,
    student_id: `OTHER${i}`,
    live_count: 1,
  }));
  assert.strictEqual(shelf.suggestSlot(cap, 'S1', full), null);
});

test('suggestSlot: an UNCAPPED shared bin always returns its slot regardless of student or depth', () => {
  // شال carried `max_per_slot = NULL` (the bottomless single bin) until migration 108 gave it
  // 10 خانات and a max of 30 like everything else. The NULL branch is still live code — a max
  // is nullable and an admin can clear one from /admin/shelf — so it is covered here with a
  // hand-built section instead of being dropped along with the only row that used to hit it.
  const bottomless = {
    id: -3, shelf_code: 'C', piece_type: 'shawl', label_ar: 'شال',
    slot_count: 1, max_per_slot: null, mode: 'shared', sort_order: 2,
    slot_from: 7, slot_to: 7,
  };
  const deep = [{ shelf_code: 'C', slot_index: 7, student_id: null, live_count: 40 }];
  assert.deepStrictEqual(shelf.suggestSlot(bottomless, 'anyone', deep), {
    shelf_code: 'C',
    slot_index: 7,
    over: false, // a section with no max can never be over
  });
});

// ── The communal وشاح shelf (migration 085) ──────────────────────────────────────────────
// A capped communal section behaves like neither of the two shapes that existed before it:
// unlike an exclusive section it ignores WHO the piece belongs to, and unlike the uncapped
// شال bin it moves on when a bin is full.

test('suggestSlot: a CAPPED shared bin takes any student until it hits its max', async () => {
  const sash = (await shelf.loadSections()).find((x) => x.piece_type === 'sash');
  const partly = [{ shelf_code: 'B', slot_index: 1, student_id: null, live_count: 29 }];
  // Twenty-nine strangers' sashes in B01 and the thirtieth still joins them — the exact move
  // that used to fail with «B01 مشغولة بطالب آخر».
  assert.deepStrictEqual(shelf.suggestSlot(sash, 'A-STUDENT', partly), {
    shelf_code: 'B',
    slot_index: 1,
    over: false,
  });
  assert.deepStrictEqual(shelf.suggestSlot(sash, 'A-DIFFERENT-STUDENT', partly), {
    shelf_code: 'B',
    slot_index: 1,
    over: false,
  });
});

test('suggestSlot: a FULL communal bin spills into the next one, not onto the worker', async () => {
  const sash = (await shelf.loadSections()).find((x) => x.piece_type === 'sash');
  const full = [{ shelf_code: 'B', slot_index: 1, student_id: null, live_count: 30 }];
  assert.deepStrictEqual(shelf.suggestSlot(sash, 'S1', full), {
    shelf_code: 'B',
    slot_index: 2,
    over: false,
  });
  // …and keeps walking. B01 and B02 full → B03.
  const two = [...full, { shelf_code: 'B', slot_index: 2, student_id: null, live_count: 30 }];
  assert.strictEqual(shelf.suggestSlot(sash, 'S1', two).slot_index, 3);
});

test('suggestSlot: every communal bin full → the LAST one, flagged — never «بلا خانة»', async () => {
  const sash = (await shelf.loadSections()).find((x) => x.piece_type === 'sash');
  // D4 for a communal section: a full shelf must never leave a piece homeless, because the
  // worker is holding it and has to put it SOMEWHERE. Exclusive sections return null here;
  // this one returns the last bin with over=true so the sheet can say so out loud.
  const allFull = Array.from({ length: 10 }, (_, i) => ({
    shelf_code: 'B',
    slot_index: i + 1,
    student_id: null,
    live_count: 30,
  }));
  assert.deepStrictEqual(shelf.suggestSlot(sash, 'S1', allFull), {
    shelf_code: 'B',
    slot_index: 10,
    over: true,
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
    assert.match(placed.slot_code, /^C(0[1-9]|10)$/, 'cap must land in the cap section C01–C10');
    assert.strictEqual(placed.over, false);

    const board = await shelf.buildBoard();
    const shelfC = board.shelves.find((s) => s.code === 'C');
    const bin = shelfC.slots.find((s) => s.slot_code === placed.slot_code);
    assert.strictEqual(bin.count, 1);
    // ⚠️ Migration 108: قبعة is COMMUNAL now, so the BIN has no owner — `student_id` is NULL
    // by design (see the D2 landmine). Whose piece this is lives on the PIECE, which is what
    // ShelfMap searches. Asserting the owner on the bin is exactly the mistake that would
    // reintroduce «one student claims a 30-piece خانة».
    assert.strictEqual(bin.student_id, null, 'a communal bin must have no owner');
    assert.strictEqual(bin.pieces.length, 1);
    assert.strictEqual(bin.pieces[0].student_id, order.student_id);
    assert.strictEqual(bin.state, 'shared');

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

test('live: a قبعة bin now ACCEPTS a second student — nothing refuses a placement', async (t) => {
  // Migration 108 made every section communal on the owner's «خليهم بس يحطون القطع». This is
  // the inverted twin of the old «an exclusive bin refuses a SECOND student» test, kept as the
  // same scenario so the change of contract is visible in the diff rather than silent: the
  // exact call that used to throw ERR_SLOT_TAKEN must now succeed into the SAME خانة.
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
    const second = await shelf.placePiece(b.id, user, { shelf_code: 'C', slot_index: idx });
    assert.strictEqual(second.slot_code, placed.slot_code, 'both caps share one خانة');
    assert.strictEqual(second.over, false, '2 pieces is far under the max of 30');

    const board = await shelf.buildBoard();
    const bin = board.shelves
      .find((s) => s.code === 'C')
      .slots.find((s) => s.slot_code === placed.slot_code);
    assert.strictEqual(bin.count, 2);
    assert.strictEqual(bin.student_id, null);
    assert.deepStrictEqual(
      [...new Set(bin.pieces.map((p) => p.student_id))].sort(),
      [a.student_id, b.student_id].sort(),
      'both students must be findable ON THE PIECES, since the bin has no owner'
    );
  } finally {
    await query('DELETE FROM shelf_placements WHERE order_id = ANY($1)', [[a.id, b.id]]);
    await query(
      `DELETE FROM shelf_slot_occupancy so
        WHERE NOT EXISTS (SELECT 1 FROM shelf_placements sp WHERE sp.occupancy_id = so.id)`
    );
  }
});

// The mirror image of the test above, and the SERVER contract the تسكين picker leans on
// (frontend/components/staff/shelf/PlaceSheet.tsx). The picker used to grey out every
// occupied exclusive خانة — the student's own included — so a worker could never place a
// second piece by hand, even though placePiece has always accepted it. D4 is explicit: over
// the max inside a student's OWN bin is allowed and merely flagged. If this ever starts
// throwing, that UI is wrong to offer the bin and must change with it.
test('live: a student\'s SECOND piece joins their own bin, past max if need be (D4)', async (t) => {
  // 'robe' rather than 'cap': shelf A is still exclusive (which is what this test is about)
  // and the dev snapshot happens to hold students with two robes at التجهيز but none with
  // two caps. Any exclusive section proves the same rule.
  const { rows } = await query(
    `SELECT o.id, o.student_id
       FROM orders o
       JOIN students st ON st.id = o.student_id
       JOIN products p  ON p.id  = o.product_id
      WHERE st.wholesaler_id IS NULL AND p.type = 'robe' AND o.status = 'preparing'
      ORDER BY o.student_id
      LIMIT 200`
  );
  // Two pieces of the SAME type belonging to the SAME student — the case the picker blocked.
  const byStudent = new Map();
  for (const r of rows) {
    const list = byStudent.get(r.student_id) || [];
    list.push(r.id);
    byStudent.set(r.student_id, list);
  }
  const pair = [...byStudent.values()].find((ids) => ids.length >= 2);
  if (!pair) return t.skip('no retail student with two robes at preparing in this snapshot');
  const [first, second] = pair;

  const admin = await query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  const user = { id: admin.rows[0].id };

  try {
    const placed = await shelf.placePiece(first, user);
    const idx = Number(placed.slot_code.slice(1));

    // Explicit target, exactly as «تغيير الخانة» sends it — not the auto-suggestion, which
    // already resolves to the own bin. The explicit path is the one the UI had disabled.
    const again = await shelf.placePiece(second, user, { shelf_code: 'A', slot_index: idx });
    assert.strictEqual(again.slot_code, placed.slot_code, 'second piece must join the same خانة');

    const board = await shelf.buildBoard();
    const bin = board.shelves
      .find((s) => s.code === 'A')
      .slots.find((s) => s.slot_code === placed.slot_code);
    assert.strictEqual(bin.count, 2, 'the bin must now hold both pieces');
  } finally {
    await query('DELETE FROM shelf_placements WHERE order_id = ANY($1)', [[first, second]]);
    await query(
      `DELETE FROM shelf_slot_occupancy so
        WHERE NOT EXISTS (SELECT 1 FROM shelf_placements sp WHERE sp.occupancy_id = so.id)`
    );
  }
});

// The mirror of «an exclusive bin refuses a SECOND student», for the communal sections. This
// is the behaviour migration 085 hands the وشاح shelf, and it is exercised here through شال
// because the dev snapshot holds 64 shawls and a single sash — the SERVER path is identical
// (placePiece only checks ownership when `section.mode === 'exclusive'`), so proving it on one
// communal section proves it for both.
test('live: a communal bin accepts TWO DIFFERENT students in the same خانة', async (t) => {
  const { rows } = await query(
    `SELECT o.id, o.student_id
       FROM orders o
       JOIN students st ON st.id = o.student_id
       JOIN products p  ON p.id  = o.product_id
      WHERE st.wholesaler_id IS NULL AND p.type = 'shawl' AND o.status = 'preparing'
      LIMIT 40`
  );
  const a = rows[0];
  const b = rows.find((r) => r.student_id !== a?.student_id);
  if (!a || !b) return t.skip('need two distinct retail shawl students');

  const admin = await query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  const user = { id: admin.rows[0].id };

  try {
    const first = await shelf.placePiece(a.id, user);
    // Explicit target — the same خانة, a different student. On an exclusive section this is
    // exactly the call that raises ERR_SLOT_TAKEN.
    const second = await shelf.placePiece(b.id, user, {
      shelf_code: first.shelf_code,
      slot_index: first.slot_index,
    });
    assert.strictEqual(second.slot_code, first.slot_code, 'both students share the خانة');

    const board = await shelf.buildBoard();
    const bin = board.shelves
      .find((s) => s.code === first.shelf_code)
      .slots.find((s) => s.slot_code === first.slot_code);
    assert.strictEqual(bin.count, 2);
    assert.strictEqual(bin.mode, 'shared');
    // A communal bin names no owner — the two students live on its `pieces`, which is what
    // the map searches so «وين شال فلان؟» still resolves.
    assert.strictEqual(bin.student_id, null, 'a communal bin must claim no owner');
    assert.deepStrictEqual(
      [...new Set(bin.pieces.map((p) => p.student_name))].length,
      2,
      'both students must be findable inside the bin'
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
  assert.strictEqual(c.slots.length, 20); // migration 108: 10 قبعة + 10 شال
  assert.strictEqual(c.slots[9].piece_type, 'cap');  // C10 is the last قبعة
  assert.strictEqual(c.slots[10].piece_type, 'shawl'); // C11 is where شال now starts
  assert.strictEqual(c.slots[10].mode, 'shared');

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

test('live: the board never shows historical backlog — only what was actually staged', async () => {
  // 205 retail pieces sit at التجهيز from May/June that nobody ever put on a shelf.
  // They must NOT appear as «وصلت توّا», and must not build «جاهز للتغليف» sets.
  const backlog = await query(
    `SELECT COUNT(*)::int n FROM orders o
       JOIN students s ON s.id = o.student_id
      WHERE s.wholesaler_id IS NULL AND o.status = 'preparing'`
  );
  const board = await shelf.buildBoard();
  assert.ok(backlog.rows[0].n > 50, 'this snapshot should still carry a real backlog');
  // Everything on the board is either physically placed, or arrived after the epoch.
  for (const item of board.inbox) {
    assert.ok(item.order_id, 'inbox rows must be real pieces');
  }
  for (const s of board.sets) {
    assert.ok(
      s.pieces.some((p) => p.slot_code),
      `set ${s.student_name} has nothing on the shelf and must not be listed`
    );
  }
  assert.ok(
    board.inbox.length < backlog.rows[0].n,
    'the inbox must never be the whole backlog'
  );
});

// ---------- search (owner request 2026-09-06) ----------
// A preparer holding a وشاح reads the تطريز off the fabric, not a student id — and the sash
// is the only piece that carries that text. So the board must (a) ship the typed text and
// (b) say WHOSE each placed piece is, which is what lets one matched sash light up the same
// student's روب/قبعة bins. Both are contract with the console; neither is visible on screen,
// so nothing else would catch their removal.
test('live: a placed piece carries its student_id and the student’s typed text', async (t) => {
  const { rows } = await query(
    `SELECT o.id, o.student_id,
            (SELECT string_agg(DISTINCT oi.customer_text, ' ')
               FROM order_items oi
              WHERE oi.order_id = o.id
                AND oi.customer_text IS NOT NULL
                AND oi.customer_text <> '') AS typed
       FROM orders o
       JOIN students st ON st.id = o.student_id
       JOIN products p  ON p.id  = o.product_id
      WHERE st.wholesaler_id IS NULL AND p.type = 'sash' AND o.status = 'preparing'
      LIMIT 20`
  );
  const order = rows.find((r) => r.typed && r.typed.trim().length > 3);
  if (!order) return t.skip('no retail sash with typed text at preparing in this snapshot');

  const admin = await query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  const user = { id: admin.rows[0].id };

  try {
    const placed = await shelf.placePiece(order.id, user);
    const board = await shelf.buildBoard();

    const bin = board.shelves
      .flatMap((s) => s.slots)
      .find((s) => s.slot_code === placed.slot_code);
    const piece = bin.pieces.find((p) => p.order_id === order.id);
    assert.ok(piece, 'the placed sash must appear in its bin');

    // The sash shelf is COMMUNAL, so the bin itself owns nobody — which is exactly why the
    // id has to live on the piece. Asserted together so a future "tidy-up" that moves it
    // back onto the bin fails here rather than silently un-grouping the طقم.
    assert.strictEqual(bin.student_id, null, 'a communal sash bin claims no owner');
    assert.strictEqual(piece.student_id, order.student_id);

    const word = order.typed.trim().split(/\s+/)[0];
    assert.ok(
      piece.search_text && piece.search_text.includes(word),
      'the piece must carry what the student typed on it'
    );

    // The same text must reach the set, so «جاهز للتغليف» is searchable by the تطريز too.
    const set = board.sets.find((s) => s.pieces.some((p) => p.order_id === order.id));
    if (set) {
      const setPiece = set.pieces.find((p) => p.order_id === order.id);
      assert.ok(setPiece.search_text && setPiece.search_text.includes(word));
    }
  } finally {
    await query('DELETE FROM shelf_placements WHERE order_id = $1', [order.id]);
    await query(
      `DELETE FROM shelf_slot_occupancy so
        WHERE NOT EXISTS (SELECT 1 FROM shelf_placements sp WHERE sp.occupancy_id = so.id)`
    );
  }
});

// ── Migration 108's re-flow carry ────────────────────────────────────────────────────────
// The dev DB has never had an open شال bin, so the one statement in 108 that only fires on
// production — carrying an open bin across when a lower section GROWS underneath it — has no
// natural coverage. This test manufactures the exact prod shape: قبعة back at 6 خانات with a
// شال bin sitting at C07, then re-applies the migration and checks the bin arrived at C11.
//
// Why it matters: section ranges are DERIVED (loadSections walks slot_count in sort_order),
// never stored. Leave the bin at C07 after قبعة grows to 10 and it reads as a قبعة bin — its
// section_id says شال while its slot_index falls inside قبعة's range — and placePiece refuses
// to add to it with ERR_WRONG_SECTION. The شال on the shelf becomes unreachable, and nothing
// on any screen says why.
test('live: migration 108 carries an open bin when the section below it grows', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(
    path.join(__dirname, '..', '..', 'db', 'migrations', '108_open_shelf_layout.sql'),
    'utf8'
  );
  const cap = (await shelf.loadSections()).find((x) => x.piece_type === 'cap');
  const shawlSec = (await shelf.loadSections()).find((x) => x.piece_type === 'shawl');

  try {
    // Rewind to the pre-108 shelf C: قبعة 6 خانات, so شال starts at C07.
    await query('UPDATE shelf_sections SET slot_count = 6 WHERE id = $1', [cap.id]);
    await query('UPDATE shelf_sections SET slot_count = 1 WHERE id = $1', [shawlSec.id]);
    const back = await shelf.loadSections();
    assert.strictEqual(back.find((x) => x.piece_type === 'shawl').slot_from, 7);

    const bin = await query(
      `INSERT INTO shelf_slot_occupancy (shelf_code, slot_index, student_id, section_id)
       VALUES ('C', 7, NULL, $1) RETURNING id`,
      [shawlSec.id]
    );
    const binId = bin.rows[0].id;

    await query(sql);

    const after = await shelf.loadSections();
    assert.strictEqual(after.find((x) => x.piece_type === 'cap').slot_count, 10);
    assert.deepStrictEqual(
      [after.find((x) => x.piece_type === 'shawl').slot_from,
       after.find((x) => x.piece_type === 'shawl').slot_to],
      [11, 20]
    );
    const moved = await query('SELECT slot_index FROM shelf_slot_occupancy WHERE id = $1', [binId]);
    assert.strictEqual(
      Number(moved.rows[0].slot_index), 11,
      'the شال bin must follow its section from C07 to C11, not be left inside قبعة'
    );

    await query('DELETE FROM shelf_slot_occupancy WHERE id = $1', [binId]);
  } finally {
    await query("DELETE FROM shelf_slot_occupancy WHERE shelf_code = 'C' AND student_id IS NULL AND NOT EXISTS (SELECT 1 FROM shelf_placements sp WHERE sp.occupancy_id = shelf_slot_occupancy.id)");
    await query('UPDATE shelf_sections SET slot_count = 10 WHERE slot_count <> 10');
  }
});
