'use strict';
// رف التجهيز — retail staging bins between الكوي and التجهيز.
//
// WHY THIS EXISTS: a student's pieces do not finish together. Caps/shawls are plain and skip
// الكوي entirely; robes are plain but pressed; the وشاح must pass التصميم → التطريز → الكوي and
// arrives LAST. So robes and caps sit waiting for the sash. These bins are that waiting room,
// and the board's job is to say which sets are finally complete and packable.
//
// Spec: docs/superpowers/specs/2026-07-21-preparation-shelf-design.md (decisions D1–D7).
// Retail only (D1) — enforced in EVERY query here, never trusted from the caller.
const { query, tx } = require('./db');

class ShelfError extends Error {
  constructor(status, code, messageAr) {
    super(messageAr);
    this.status = status;
    this.code = code;
    this.messageAr = messageAr;
  }
}

const PIECE_LABEL_AR = { robe: 'روب', sash: 'وشاح', cap: 'قبعة', shawl: 'شال' };

// Mirrors orderController.STATUS_LABEL_AR for the stages a waiting piece can sit at.
// Only used for the «ينتظر: وشاح — في التطريز» hint, never for authorization.
const STAGE_AR = {
  designing: 'قيد التصميم',
  design_complete: 'بانتظار التصميم',
  converting: 'قيد التحويل',
  embroidery: 'في التطريز',
  pressing: 'في الكوي',
  preparing: 'في التجهيز',
  ready: 'جاهز',
};

function slotCode(shelfCode, slotIndex) {
  return `${shelfCode}${String(slotIndex).padStart(2, '0')}`;
}

function runner(client) {
  return client ? client.query.bind(client) : query;
}

// Sections of a shelf occupy CONSECUTIVE slot indices in sort_order, so shelf C yields
// cap 1..6 then شال 7..7. The range is derived here rather than stored, so editing
// slot_count re-flows the shelf automatically with no data migration.
async function loadSections(client) {
  const { rows } = await runner(client)(
    `SELECT id, shelf_code, piece_type, label_ar, slot_count, max_per_slot, mode, sort_order
       FROM shelf_sections ORDER BY shelf_code, sort_order`
  );
  const cursor = new Map();
  return rows.map((r) => {
    const count = Number(r.slot_count);
    const from = (cursor.get(r.shelf_code) || 0) + 1;
    const to = from + count - 1; // count === 0 → to < from → empty range
    cursor.set(r.shelf_code, Math.max(to, from - 1));
    return {
      ...r,
      slot_count: count,
      max_per_slot: r.max_per_slot == null ? null : Number(r.max_per_slot),
      slot_from: from,
      slot_to: to,
    };
  });
}

// Open bins only, each with how many pieces are still physically in it.
async function loadOpenBins(client) {
  const { rows } = await runner(client)(
    `SELECT so.id, so.shelf_code, so.slot_index, so.student_id, so.section_id, so.opened_at,
            COUNT(sp.order_id) FILTER (WHERE sp.collected_at IS NULL) AS live_count
       FROM shelf_slot_occupancy so
       LEFT JOIN shelf_placements sp ON sp.occupancy_id = so.id
      WHERE so.closed_at IS NULL
      GROUP BY so.id`
  );
  return rows.map((r) => ({
    ...r,
    slot_index: Number(r.slot_index),
    live_count: Number(r.live_count),
  }));
}

// D3: the system proposes, the worker disposes.
//   shared   → the section's single communal bin, no max, never "over".
//   exclusive→ the student's OWN open bin if they have one (over = at/past max), else the
//              lowest free index, else null («بلا خانة»).
// Because a bin belongs to one student, over-stuffing can only ever spill into that
// student's own bin — never a stranger's. That is what makes D4 safe rather than chaotic.
function suggestSlot(section, studentId, openBins) {
  if (section.slot_count < 1) return null;
  const inSection = openBins.filter(
    (b) =>
      b.shelf_code === section.shelf_code &&
      b.slot_index >= section.slot_from &&
      b.slot_index <= section.slot_to
  );

  if (section.mode === 'shared') {
    return { shelf_code: section.shelf_code, slot_index: section.slot_from, over: false };
  }

  const own = inSection.find((b) => b.student_id === studentId);
  if (own) {
    const over = section.max_per_slot != null && own.live_count >= section.max_per_slot;
    return { shelf_code: section.shelf_code, slot_index: own.slot_index, over };
  }

  const taken = new Set(inSection.map((b) => b.slot_index));
  for (let i = section.slot_from; i <= section.slot_to; i += 1) {
    if (!taken.has(i)) return { shelf_code: section.shelf_code, slot_index: i, over: false };
  }
  return null;
}

// ── The shelf epoch ──────────────────────────────────────────────────────────
// The shelf is a PHYSICAL object: it holds what someone actually put on it. But the DB
// carries a large historical backlog of pieces that reached التجهيز long before this
// feature existed (May–June rows that never passed through الكوي in this flow). Showing
// those as «وصلت توّا» would be a lie — nobody staged them, and no set built from them is
// genuinely packable.
//
// So the board only ever shows a piece that EITHER is physically on the shelf, OR arrived
// at التجهيز after the shelf went live. The epoch is stamped once, on first read, and kept
// in site_settings so it survives restarts.
async function getShelfEpoch(client) {
  const run = runner(client);
  const { rows } = await run("SELECT value FROM site_settings WHERE key = 'shelf_epoch'");
  if (rows.length) return String(rows[0].value).replace(/^"|"$/g, '');
  const now = new Date().toISOString();
  await run(
    `INSERT INTO site_settings (key, value) VALUES ('shelf_epoch', to_jsonb($1::text))
     ON CONFLICT (key) DO NOTHING`,
    [now]
  );
  const again = await run("SELECT value FROM site_settings WHERE key = 'shelf_epoch'");
  return String(again.rows[0].value).replace(/^"|"$/g, '');
}

async function loadShelfOrder(orderId, client) {
  const { rows } = await runner(client)(
    `SELECT o.id, o.status, o.student_id, o.checkout_group_id,
            p.type AS piece_type, st.wholesaler_id, u.name AS student_name
       FROM orders o
       JOIN students st ON st.id = o.student_id
       JOIN products p ON p.id = o.product_id
       LEFT JOIN users u ON u.id = st.user_id
      WHERE o.id = $1`,
    [orderId]
  );
  return rows[0] || null;
}

// A bin with nothing live left in it is closed, never deleted — closing preserves the
// collection history while the partial unique index frees the physical slot for reuse.
const CLOSE_EMPTY_BINS_SQL = `
  UPDATE shelf_slot_occupancy so SET closed_at = now()
   WHERE so.closed_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM shelf_placements sp
        WHERE sp.occupancy_id = so.id AND sp.collected_at IS NULL)`;

// Drop a piece's placement and close the bin if that emptied it. Called on move, on
// revert out of التجهيز, and before deletion — otherwise a reverted piece leaves a
// phantom occupied خانة with nothing physically in it.
async function releaseForOrder(orderId, client) {
  const run = runner(client);
  await run('DELETE FROM shelf_placements WHERE order_id = $1', [orderId]);
  await run(CLOSE_EMPTY_BINS_SQL);
}

function guardShelfable(order) {
  if (!order) throw new ShelfError(404, 'ERR_NOT_FOUND', 'القطعة غير موجودة');
  if (order.wholesaler_id != null) {
    throw new ShelfError(403, 'ERR_NOT_RETAIL', 'الرف للطلبات المفردة فقط');
  }
  if (order.status !== 'preparing') {
    throw new ShelfError(409, 'ERR_NOT_IN_PREPARING', 'القطعة ليست في التجهيز');
  }
}

async function placePiece(orderId, user, target = {}) {
  return tx(async (client) => {
    const order = await loadShelfOrder(orderId, client);
    guardShelfable(order);

    const sections = await loadSections(client);
    const section = sections.find((s) => s.piece_type === order.piece_type);
    if (!section) {
      throw new ShelfError(409, 'ERR_NO_SECTION', 'لا يوجد رف لهذا النوع من القطع');
    }

    const openBins = await loadOpenBins(client);
    let want;
    if (target.shelf_code && target.slot_index) {
      want = { shelf_code: String(target.shelf_code), slot_index: Number(target.slot_index) };
      if (
        want.shelf_code !== section.shelf_code ||
        !Number.isInteger(want.slot_index) ||
        want.slot_index < section.slot_from ||
        want.slot_index > section.slot_to
      ) {
        throw new ShelfError(
          400,
          'ERR_WRONG_SECTION',
          `${slotCode(want.shelf_code, want.slot_index)} ليست ضمن رف ${section.label_ar}`
        );
      }
    } else {
      const s = suggestSlot(section, order.student_id, openBins);
      if (!s) throw new ShelfError(409, 'ERR_SHELF_FULL', `رف ${section.label_ar} ممتلئ`);
      want = { shelf_code: s.shelf_code, slot_index: s.slot_index };
    }

    // Release any previous placement FIRST so a move can't insert into a bin this same
    // call is about to close, and so re-placing into the same slot is a clean no-op.
    await releaseForOrder(orderId, client);

    // Serialise concurrent claims on the same physical slot.
    const locked = await client.query(
      `SELECT id, student_id FROM shelf_slot_occupancy
        WHERE shelf_code = $1 AND slot_index = $2 AND closed_at IS NULL
        FOR UPDATE`,
      [want.shelf_code, want.slot_index]
    );

    let occupancyId;
    if (locked.rows.length) {
      const bin = locked.rows[0];
      if (section.mode === 'exclusive' && bin.student_id !== order.student_id) {
        throw new ShelfError(
          409,
          'ERR_SLOT_TAKEN',
          `${slotCode(want.shelf_code, want.slot_index)} مشغولة بطالب آخر`
        );
      }
      occupancyId = bin.id;
    } else {
      const ins = await client.query(
        `INSERT INTO shelf_slot_occupancy (shelf_code, slot_index, student_id, section_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [
          want.shelf_code,
          want.slot_index,
          section.mode === 'shared' ? null : order.student_id,
          section.id,
        ]
      );
      occupancyId = ins.rows[0].id;
    }

    await client.query(
      `INSERT INTO shelf_placements (order_id, occupancy_id, student_id, placed_by)
       VALUES ($1, $2, $3, $4)`,
      [orderId, occupancyId, order.student_id, user.id]
    );

    const after = await client.query(
      `SELECT COUNT(*)::int AS n FROM shelf_placements
        WHERE occupancy_id = $1 AND collected_at IS NULL`,
      [occupancyId]
    );
    // D4: exceeding the max inside the student's own bin is ALLOWED, just flagged.
    const over = section.max_per_slot != null && after.rows[0].n > section.max_per_slot;

    return {
      slot_code: slotCode(want.shelf_code, want.slot_index),
      shelf_code: want.shelf_code,
      slot_index: want.slot_index,
      over,
    };
  });
}

// Set identity: the bundle when there is one, else the student. Bin OWNERSHIP is keyed on
// student_id (D2), so one student with two bundles correctly shares one bin per type while
// their sets stay independently tracked.
function setKeyOf(row) {
  return row.checkout_group_id ? `cg:${row.checkout_group_id}` : `student:${row.student_id}`;
}

async function collectPiece(orderId, user) {
  // Lazy require breaks the cycle: productionController requires THIS module for
  // releaseForOrder, so a top-level require here would hand back a half-built module.
  const { loadAdvanceRow, performAdvance } = require('../controllers/productionController');

  const order = await loadShelfOrder(orderId);
  guardShelfable(order);

  await tx(async (client) => {
    await client.query(
      `UPDATE shelf_placements SET collected_at = now(), collected_by = $2
        WHERE order_id = $1 AND collected_at IS NULL`,
      [orderId, user.id]
    );
    await client.query(CLOSE_EMPTY_BINS_SQL);
  });

  // Advance through the EXISTING state machine — same tx, audit rows and notifications as
  // every other stage transition. No parallel state machine is introduced by this feature.
  const row = await loadAdvanceRow(orderId);
  const advanced = [];
  if (row) {
    await performAdvance(row, user);
    advanced.push(orderId);
  }

  // D5: the set auto-closes when its last piece is ticked.
  const remaining = await query(
    `SELECT COUNT(*)::int AS n FROM orders o
       JOIN students st ON st.id = o.student_id
      WHERE st.wholesaler_id IS NULL
        AND o.status = 'preparing'
        AND ${order.checkout_group_id ? 'o.checkout_group_id = $1' : 'o.student_id = $1'}`,
    [order.checkout_group_id || order.student_id]
  );

  return { advanced_ids: advanced, set_closed: remaining.rows[0].n === 0 };
}

async function closeSet(setKey, user) {
  const isGroup = String(setKey).startsWith('cg:');
  const id = String(setKey).slice(isGroup ? 3 : 8);
  const { rows } = await query(
    `SELECT o.id FROM orders o
       JOIN students st ON st.id = o.student_id
      WHERE st.wholesaler_id IS NULL
        AND o.status = 'preparing'
        AND ${isGroup ? 'o.checkout_group_id = $1' : 'o.student_id = $1'}`,
    [id]
  );
  if (!rows.length) throw new ShelfError(409, 'ERR_SET_EMPTY', 'لا توجد قطع جاهزة للتغليف');

  const advanced = [];
  for (const r of rows) {
    // Sequential on purpose: performAdvance opens its own transaction per piece.
    const res = await collectPiece(r.id, user);
    advanced.push(...res.advanced_ids);
  }
  return { advanced_ids: advanced };
}

async function buildBoard() {
  const sections = await loadSections();
  const openBins = await loadOpenBins();

  const epoch = await getShelfEpoch();

  // A piece is IN SCOPE only if it is physically on the shelf, or it arrived at التجهيز
  // after the shelf went live. Everything older is pre-existing backlog that nobody staged
  // — it stays on the ordinary قائمة التجهيز and must not pollute this screen.
  //
  // Whole SETS are then loaded for the in-scope students (not just their shelved pieces),
  // which is what lets a bin say «ينتظر: وشاح — في التطريز» instead of just "occupied".
  const { rows } = await query(
    `
    WITH arrived AS (
      SELECT DISTINCT order_id
        FROM staff_activity_log
       WHERE to_stage = 'preparing' AND created_at >= $1::timestamptz
    ),
    in_scope AS (
      SELECT sp.student_id
        FROM shelf_placements sp WHERE sp.collected_at IS NULL
      UNION
      SELECT o.student_id
        FROM orders o
        JOIN students s ON s.id = o.student_id
       WHERE s.wholesaler_id IS NULL
         AND o.status = 'preparing'
         AND o.id IN (SELECT order_id FROM arrived)
    )
    SELECT o.id, o.student_id, o.checkout_group_id, o.status, o.created_at,
           p.type AS piece_type, p.name_ar AS product_name,
           u.name AS student_name, st.university_name, st.department,
           sp.collected_at, sp.placed_at, so.shelf_code, so.slot_index,
           (o.id IN (SELECT order_id FROM arrived)) AS arrived_recently
      FROM orders o
      JOIN students st ON st.id = o.student_id
      JOIN products p  ON p.id  = o.product_id
      LEFT JOIN users u ON u.id = st.user_id
      LEFT JOIN shelf_placements sp ON sp.order_id = o.id AND sp.collected_at IS NULL
      LEFT JOIN shelf_slot_occupancy so ON so.id = sp.occupancy_id
     WHERE o.student_id IN (SELECT student_id FROM in_scope)
       AND st.wholesaler_id IS NULL
       AND o.status NOT IN ('cancelled', 'delivered')
     ORDER BY u.name NULLS LAST, o.created_at
  `,
    [epoch]
  );

  // ---- Sets ----
  const setMap = new Map();
  for (const r of rows) {
    const key = setKeyOf(r);
    if (!setMap.has(key)) {
      setMap.set(key, {
        set_key: key,
        student_id: r.student_id,
        student_name: r.student_name || 'طالب',
        university_name: r.university_name || null,
        department: r.department || null,
        pieces: [],
      });
    }
    setMap.get(key).pieces.push({
      order_id: r.id,
      piece_type: r.piece_type,
      piece_label: PIECE_LABEL_AR[r.piece_type] || r.piece_type,
      product_name: r.product_name,
      status: r.status,
      stage_ar: STAGE_AR[r.status] || r.status,
      slot_code: r.shelf_code ? slotCode(r.shelf_code, Number(r.slot_index)) : null,
      placed_at: r.placed_at || null,
    });
  }

  // A set is READY when every piece has ARRIVED at التجهيز (preparing) or moved past it.
  // Placement is an address, not a gate — an un-shelved piece («بلا خانة», D4) is still
  // physically present and must not block packing.
  const sets = [...setMap.values()]
    .map((s) => {
      const waiting = s.pieces.filter((p) => p.status !== 'preparing' && p.status !== 'ready');
      return {
        ...s,
        state: waiting.length === 0 ? 'ready' : 'waiting',
        waiting_for: waiting.map((p) => `${p.piece_label} — ${p.stage_ar}`),
      };
    })
    // A set only belongs on this screen once at least one of its pieces is genuinely on
    // the shelf. Otherwise «جاهز للتغليف» fills with old backlog sets that no one staged
    // and that the preparer has no bin to collect from.
    .filter((s) => s.pieces.some((p) => p.slot_code));
  const setByStudent = new Map();
  for (const s of sets) {
    if (!setByStudent.has(s.student_id)) setByStudent.set(s.student_id, []);
    setByStudent.get(s.student_id).push(s);
  }

  // ---- Inbox: arrived at التجهيز but not on the shelf («وصلت توّا» / «بلا خانة») ----
  // Suggestions are computed against a RUNNING copy of the bins, reserving each one as it is
  // handed out. Computing them all against the same snapshot would tell five different
  // students to use A01 — the server would reject all but the first, but the screen would
  // have lied. Reserving as we go also makes the «بلا خانة» count truthful: it shows how many
  // pieces genuinely have nowhere to go once the shelf is full.
  const projected = openBins.map((b) => ({ ...b }));
  const inbox = rows
    // arrived_recently: only pieces that genuinely came through الكوي/التجهيز since the
    // shelf went live. Historical backlog is never presented as «وصلت توّا».
    .filter((r) => r.status === 'preparing' && !r.shelf_code && r.arrived_recently)
    .map((r) => {
      const section = sections.find((s) => s.piece_type === r.piece_type);
      const suggestion = section ? suggestSlot(section, r.student_id, projected) : null;
      if (suggestion) {
        const existing = projected.find(
          (b) =>
            b.shelf_code === suggestion.shelf_code && b.slot_index === suggestion.slot_index
        );
        if (existing) existing.live_count += 1;
        else
          projected.push({
            shelf_code: suggestion.shelf_code,
            slot_index: suggestion.slot_index,
            student_id: section.mode === 'shared' ? null : r.student_id,
            live_count: 1,
          });
      }
      return {
        order_id: r.id,
        student_id: r.student_id,
        student_name: r.student_name || 'طالب',
        piece_type: r.piece_type,
        piece_label: PIECE_LABEL_AR[r.piece_type] || r.piece_type,
        product_name: r.product_name,
        suggestion: suggestion
          ? { ...suggestion, slot_code: slotCode(suggestion.shelf_code, suggestion.slot_index) }
          : null,
      };
    });

  // ---- Shelves ----
  const byBin = new Map();
  for (const r of rows) {
    if (!r.shelf_code) continue;
    const k = `${r.shelf_code}:${r.slot_index}`;
    if (!byBin.has(k)) byBin.set(k, []);
    byBin.get(k).push(r);
  }

  const shelfCodes = [...new Set(sections.map((s) => s.shelf_code))];
  const shelves = shelfCodes.map((code) => {
    const shelfSections = sections.filter((s) => s.shelf_code === code);
    const slots = [];
    for (const section of shelfSections) {
      for (let i = section.slot_from; i <= section.slot_to; i += 1) {
        const bin = openBins.find((b) => b.shelf_code === code && b.slot_index === i);
        const pieces = byBin.get(`${code}:${i}`) || [];
        const count = pieces.length;
        const over = section.max_per_slot != null && count > section.max_per_slot;

        let state = 'empty';
        let waitingFor = [];
        if (count > 0 || bin) {
          if (section.mode === 'shared') {
            state = 'shared';
          } else {
            const studentSets = setByStudent.get(bin?.student_id) || [];
            const anyWaiting = studentSets.some((s) => s.state === 'waiting');
            state = over ? 'over' : anyWaiting ? 'waiting' : 'ready';
            waitingFor = [...new Set(studentSets.flatMap((s) => s.waiting_for))];
          }
        }

        slots.push({
          index: i,
          slot_code: slotCode(code, i),
          section_id: section.id,
          piece_type: section.piece_type,
          piece_label: section.label_ar,
          mode: section.mode,
          max: section.max_per_slot,
          student_id: bin?.student_id || null,
          student_name: pieces[0]?.student_name || null,
          count,
          over,
          state,
          waiting_for: waitingFor,
          opened_at: bin?.opened_at || null,
          pieces: pieces.map((p) => ({
            order_id: p.id,
            piece_type: p.piece_type,
            piece_label: PIECE_LABEL_AR[p.piece_type] || p.piece_type,
            student_name: p.student_name || 'طالب',
            placed_at: p.placed_at,
          })),
        });
      }
    }
    return { code, sections: shelfSections, slots };
  });

  return { sections, shelves, sets, inbox };
}

module.exports = {
  ShelfError,
  PIECE_LABEL_AR,
  slotCode,
  loadSections,
  loadOpenBins,
  suggestSlot,
  placePiece,
  collectPiece,
  closeSet,
  releaseForOrder,
  buildBoard,
};
