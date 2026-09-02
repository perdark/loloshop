'use strict';
// الشال الأمريكي كقطعة — the rep-sold American shawl on the production line.
//
// WHY THIS FILE EXISTS. «شال امريكي» is TWO different things wearing one name, and the line
// stopped for one of them. For a تجزئة student it is a real product with its own order row.
// For a rep student it is an ADD-ON PRICE on the وشاح: lib/fullSetOrder.js writes «إضافة:
// شال امريكي» (money) and «شال امريكي» (the note + photo) onto the SASH order and creates no
// shawl order at all — measured on the dev DB, 253 carriers, every one a sash. So الكوي and
// التجهيز saw a row that said «وشاح» while a second physical garment sat in the job, and the
// workers reported it as «الشالات ما دا تطلع، دا تطلع أوشحة».
//
// The owner's rule is that the two are the same on the line — «the stages for shawl for
// wholesaler staff are same for retail staff» — under one hard constraint: «i dont want to
// change anything for wholesalers or wholesalers students». Hence `sash_shawl_pieces`
// (migration 100): the piece's STAGE, and nothing else, outside `orders`.
//
// What these tests pin is exactly the two halves of that: the piece behaves like a piece,
// and the rep's side of the world is untouched.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { query } = require('../lib/db');
const shawlPiece = require('../lib/shawlPiece');
const { advance, revert, getOrder, getQueue } = require('../controllers/productionController');

const TAG = `ZZTEST-shawl-${crypto.randomUUID().slice(0, 8)}`;
const fx = { users: [], students: [], wholesalers: [], orders: [], products: [] };
const ctx = {};

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
  };
  return res;
}
const call = async (handler, req) => { const res = mockRes(); await handler(req, res); return res; };

test('setup', async () => {
  // ⚠️ Users are born `deleted_at`-stamped — same reason repApprovalAdvanceGate.test.js gives:
  // `node --test` runs files concurrently and pushBroadcast.test.js counts the live audience,
  // so two extra live users fail ITS assertion by exactly two. Nothing here reads the flag.
  const repUser = await query(
    `INSERT INTO users (name, phone, password_hash, role, deleted_at)
     VALUES ($1,$2,'x','wholesaler',NOW()) RETURNING id`,
    [`${TAG}-rep`, `0779${(Date.now() + 1) % 10000000}`]
  );
  fx.users.push(repUser.rows[0].id);
  const w = await query(
    `INSERT INTO wholesalers (user_id, university_name, referral_code) VALUES ($1,$2,$3) RETURNING id`,
    [repUser.rows[0].id, `${TAG}-uni`, `${TAG}`.slice(0, 20)]
  );
  ctx.wholesalerId = w.rows[0].id;
  fx.wholesalers.push(ctx.wholesalerId);

  const stuUser = await query(
    `INSERT INTO users (name, phone, password_hash, role, deleted_at)
     VALUES ($1,$2,'x','retail',NOW()) RETURNING id`,
    [`${TAG}-student`, `0789${(Date.now() + 2) % 10000000}`]
  );
  fx.users.push(stuUser.rows[0].id);
  const s = await query(
    `INSERT INTO students (user_id, wholesaler_id, full_name_third, status)
     VALUES ($1,$2,$3,'approved') RETURNING id`,
    [stuUser.rows[0].id, ctx.wholesalerId, `${TAG}-student`]
  );
  ctx.studentId = s.rows[0].id;
  fx.students.push(ctx.studentId);

  ctx.presser = { id: fx.users[0], role: 'staff', staff_type: 'presser', staff_types: ['presser'], order_scope: 'both' };
  ctx.retailOnly = { id: fx.users[0], role: 'staff', staff_type: 'presser', staff_types: ['presser'], order_scope: 'retail' };
});

let seq = 0;
/** A carrier وشاح with the «شال امريكي» spec line the full-set form writes, + its piece. */
async function makeCarrier({ approval = 'approved', returned = false } = {}) {
  const p = await query(
    `INSERT INTO products (name_ar, type, base_price, active) VALUES ($1,'sash',1000,TRUE) RETURNING id`,
    [`${TAG}-sash-${++seq}`]
  );
  fx.products.push(p.rows[0].id);
  // Carriers deliberately STAY at design_complete for the life of this file. adminNumbers.
  // test.js compares two live COUNT queries over `orders`, and a fixture that MOVES between
  // them fails it by one — so the thing that moves here is the shawl piece, which is not an
  // order and therefore cannot be counted by either query. That is not a happy accident; it
  // is the whole point of the table.
  const o = await query(
    `INSERT INTO orders (student_id, product_id, price, status, has_embroidery, needs_pressing,
                         wholesaler_approval, returned_to_customer)
     VALUES ($1,$2,1000,'design_complete',TRUE,TRUE,$3,$4) RETURNING id`,
    [ctx.studentId, p.rows[0].id, approval, returned]
  );
  const oid = o.rows[0].id;
  fx.orders.push(oid);
  await query(
    `INSERT INTO order_items (order_id, label_snapshot, price_snapshot, qty, customer_text)
     VALUES ($1,'شال امريكي',0,1,'نفس الصورة')`,
    [oid]
  );
  const piece = await shawlPiece.syncForOrder(null, oid, true);
  return { orderId: oid, pieceId: piece.id };
}

test('1 — a ticked شال becomes a piece at الكوي; un-ticking removes it', async () => {
  const { orderId, pieceId } = await makeCarrier();
  const row = await query(`SELECT status::text AS s FROM sash_shawl_pieces WHERE id=$1`, [pieceId]);
  assert.equal(row.rows[0].s, 'pressing', 'a شال is born at الكوي, exactly like a plain retail piece');

  await shawlPiece.syncForOrder(null, orderId, false);
  const gone = await query(`SELECT 1 FROM sash_shawl_pieces WHERE order_id=$1`, [orderId]);
  assert.equal(gone.rows.length, 0, 'un-ticking the add-on leaves no piece to press');

  // Re-ticking makes a FRESH piece at الكوي — never a resurrection of the old stage.
  const again = await shawlPiece.syncForOrder(null, orderId, true);
  const back = await query(`SELECT status::text AS s FROM sash_shawl_pieces WHERE id=$1`, [again.id]);
  assert.equal(back.rows[0].s, 'pressing');
});

test('2 — it reaches الكوي as a شال, and carries NO money', async () => {
  const { pieceId } = await makeCarrier();
  const rows = await shawlPiece.queueRows(['pressing']);
  const mine = rows.find((r) => r.id === pieceId);
  assert.ok(mine, 'the piece must appear at الكوي');
  assert.equal(mine.product_type, 'shawl', 'the garment filter finds it by product_type — the whole fix');
  assert.equal(mine.product_name, 'شال امريكي');
  assert.equal(mine.source, 'wholesaler');
  assert.equal(mine.needs_pressing, true);
  // ⚠️ The money is on the carrier وشاح and is reported there. A figure here would read as a
  // second sale of one garment, and lib/counts.js would double it the day anyone joined them.
  assert.equal('price' in mine, false, 'a shawl piece must never carry a price');
  assert.equal('group_price' in mine, false);
});

test('3 — the visibility gate is the CARRIER’s, inherited not copied', async () => {
  const pending = await makeCarrier({ approval: 'pending' });
  const returned = await makeCarrier({ returned: true });
  const ok = await makeCarrier();
  const ids = (await shawlPiece.queueRows(['pressing'])).map((r) => r.id);
  assert.ok(ids.includes(ok.pieceId), 'an approved carrier’s shawl is visible');
  assert.equal(ids.includes(pending.pieceId), false, 'an unapproved طقم must not surface as a shawl');
  assert.equal(ids.includes(returned.pieceId), false, 'a returned طقم must not surface as a shawl');
});

test('4 — تجزئة filter returns none: every carrier is a rep order', async () => {
  await makeCarrier();
  assert.equal((await shawlPiece.queueRows(['pressing'], 'retail')).length, 0);
});

test('5 — it walks الكوي → التجهيز → جاهز, and never delivers itself', async () => {
  const { pieceId } = await makeCarrier();
  const one = await call(advance, { params: { id: pieceId }, user: ctx.presser });
  assert.equal(one.statusCode, 200, JSON.stringify(one.body));
  assert.equal(one.body.data.status, 'preparing');

  const two = await call(advance, { params: { id: pieceId }, user: ctx.presser });
  assert.equal(two.body.data.status, 'ready');

  // ready→delivered is refused: hand-over is captured on the وشاح, and a shawl has no
  // delivery row of its own — it goes home inside its طقم.
  const three = await call(advance, { params: { id: pieceId }, user: ctx.presser });
  assert.equal(three.statusCode, 409);
  assert.equal(three.body.code, 'ERR_INVALID_TRANSITION');

  // One step back, on its own little ladder.
  const back = await call(revert, { params: { id: pieceId }, user: ctx.presser });
  assert.equal(back.statusCode, 200, JSON.stringify(back.body));
  assert.equal(back.body.data.status, 'preparing');
});

test('6 — an unapproved طقم cannot be worked through its shawl', async () => {
  const { pieceId } = await makeCarrier({ approval: 'pending' });
  const res = await call(advance, { params: { id: pieceId }, user: ctx.presser });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'ERR_REP_APPROVAL_PENDING');
  const after = await query(`SELECT status::text AS s FROM sash_shawl_pieces WHERE id=$1`, [pieceId]);
  assert.equal(after.rows[0].s, 'pressing', 'hiding it is not enough — the TRANSITION must refuse');
});

test('7 — a retail-scoped worker cannot touch a rep shawl', async () => {
  const { pieceId } = await makeCarrier();
  const res = await call(advance, { params: { id: pieceId }, user: ctx.retailOnly });
  assert.equal(res.statusCode, 403);
});

test('8 — the وشاح’s own «منو نقلها؟» never shows the shawl’s moves as its own', async () => {
  const { orderId, pieceId } = await makeCarrier();
  await call(advance, { params: { id: pieceId }, user: ctx.presser });

  // The move IS recorded against the carrier (the FK points at `orders`), under its own
  // action name — so it must be filtered out of the sash's stage history or it reads as the
  // SASH having moved to التجهيز, which never happened.
  const logged = await query(
    `SELECT action FROM staff_activity_log WHERE order_id=$1 AND action='advance_shawl'`, [orderId]
  );
  assert.equal(logged.rows.length, 1, 'accountability for the shawl is kept');

  const detail = await call(getOrder, { params: { id: orderId }, user: ctx.presser });
  assert.equal(detail.statusCode, 200);
  const actions = (detail.body.data.stage_history || []).map((h) => h.action);
  assert.equal(actions.includes('advance_shawl'), false, 'a shawl move must not print as a sash move');
  const sash = await query(`SELECT status::text AS s FROM orders WHERE id=$1`, [orderId]);
  assert.equal(sash.rows[0].s, 'design_complete', 'and the sash itself must not have moved');
});

test('9 — the piece has its own detail page, with the student’s note and no money', async () => {
  const { pieceId } = await makeCarrier();
  const res = await call(getOrder, { params: { id: pieceId }, user: ctx.presser });
  assert.equal(res.statusCode, 200);
  const d = res.body.data;
  assert.equal(d.order.product_name, 'شال امريكي');
  assert.equal(d.order.piece_kind, 'shawl_addon');
  assert.equal(d.items.length, 1);
  assert.equal(d.items[0].customer_text, 'نفس الصورة');
  assert.equal('price' in d.order, false);
  // A shawl is not the student's order: it cannot be handed back, edited or deleted on its own.
  assert.equal(d.available_actions.return_to_customer, false);
  assert.equal(d.available_actions.can_delete, false);
  assert.equal(d.available_actions.can_edit_full_set, false);
});

test('10 — a zone filter returns no shawls, because a شال carries no تطريز', async () => {
  const { pieceId } = await makeCarrier();
  // ?zone= matches embroidery positions on order_items. A شال has none, so asking for one
  // and getting shawls back would repeat the exact category error that hid them.
  const res = await call(getQueue, {
    user: ctx.presser,
    query: { stage: 'pressing', zone: 'sash_any' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.some((r) => r.id === pieceId), false);

  // Without the zone filter it IS there — same request, one field different.
  const open = await call(getQueue, { user: ctx.presser, query: { stage: 'pressing' } });
  assert.equal(open.body.data.some((r) => r.id === pieceId), true);
});

test('11 — a cancelled وشاح takes its شال out of the line', async () => {
  // THE BUG THIS PINS. `syncForOrder` is the only writer that deletes a piece, and it runs only
  // for `type === 'sash'` inside persistFullSetOrder's `for (const type of selectedPieces)` loop
  // — so deselecting the وشاح never reaches it. The order is cancelled by the SEPARATE deselect
  // pass (fullSetOrder.js:437-446) and the piece was left pointing at a cancelled carrier:
  // standing in المكوجي's queue forever for a طقم that no longer has a وشاح, and advanceable.
  //
  // Cancelling the order directly is exactly what that pass does, and it also covers the other
  // three cancel paths (the self-heal at :506, and orderController.js:915 / :1258) — which is
  // why the guard is on the READ and not in any one writer.
  const { orderId, pieceId } = await makeCarrier();
  assert.ok((await shawlPiece.queueRows(['pressing'])).some((r) => r.id === pieceId),
    'precondition: the piece is in the line while its carrier lives');

  await query(`UPDATE orders SET status='cancelled' WHERE id=$1`, [orderId]);

  assert.equal((await shawlPiece.queueRows(['pressing'])).some((r) => r.id === pieceId), false,
    'a cancelled وشاح must take its شال out of الكوي');
  assert.equal(await shawlPiece.loadPiece(pieceId), null,
    'and out of every id-addressed path — hiding it from the list alone still accepts a hand-posted id');

  // The console must refuse it too, through the same door a worker would use.
  const res = await call(advance, { user: ctx.presser, params: { id: pieceId }, body: {} });
  assert.equal(res.statusCode, 404, 'advance must not walk a shawl whose garment was cancelled');
  assert.equal(res.body.code, 'ERR_NOT_FOUND');

  // ⚠️ The ROW survives — a read never destroys production history, and re-adding the وشاح is
  // syncForOrder's decision to make, not this query's.
  const still = await query(`SELECT 1 FROM sash_shawl_pieces WHERE id=$1`, [pieceId]);
  assert.equal(still.rows.length, 1, 'the piece row is hidden, not deleted');
});

test('cleanup', async () => {
  // sash_shawl_pieces rows go with their carrier (ON DELETE CASCADE).
  for (const id of fx.orders) {
    await query(`DELETE FROM order_items WHERE order_id = $1`, [id]);
    await query(`DELETE FROM staff_activity_log WHERE order_id = $1`, [id]);
    await query(`DELETE FROM audit_log WHERE entity_id = $1`, [id]);
    await query(`DELETE FROM notifications WHERE user_id = ANY($1)`, [fx.users]);
    await query(`DELETE FROM orders WHERE id = $1`, [id]);
  }
  for (const id of fx.products) await query(`DELETE FROM products WHERE id = $1`, [id]);
  for (const id of fx.students) await query(`DELETE FROM students WHERE id = $1`, [id]);
  for (const id of fx.wholesalers) await query(`DELETE FROM wholesalers WHERE id = $1`, [id]);
  for (const id of fx.users) await query(`DELETE FROM users WHERE id = $1`, [id]);
  const left = await query(
    `SELECT count(*)::int n FROM sash_shawl_pieces sp WHERE sp.order_id = ANY($1)`, [fx.orders]
  );
  assert.equal(left.rows[0].n, 0, 'CASCADE must take the pieces with their carriers');
});
