'use strict';
// «التجميع» — the stage between التطريز and الكوي for a ممثل SASH (owner, 2026-09-02 / 06).
//
// WHY. التطريز produces a rep sash as two sub-pieces (من الخلف, من الأمام) that برزان sews into
// one garment before it can be pressed. Before this stage the piece jumped straight from the
// embroiderer to المكوجي and the sewing had no home on the board. The owner narrowed it on
// 2026-09-06 to SASHES ONLY — «no cap and robe» — and «there is no sash without تطريز», so the
// only real entry is embroidery → assembly. A retail sash, a rep robe and a rep cap never see it.
//
// `isAssemblyPiece` is the ONLY fork between the two routes (forward AND backward). A second
// copy is how a piece gets advanced into a station it can never be reverted into.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextStageFor, resolveRevertTarget, ADVANCE_LABEL_AR, isAssemblyPiece, QUEUE_STAGES, LINE_VIEW_STAGES } = require('../controllers/productionController');
const { canStaffTransition, TRANSITIONS, STATUS_LABEL_AR } = require('../controllers/orderController');

const repSash = (o) => ({ product_type: 'sash', design_id: null, has_embroidery: true, needs_pressing: true, wholesaler_id: 'w1', ...o });
const retailSash = (o) => ({ product_type: 'sash', design_id: null, has_embroidery: true, needs_pressing: true, wholesaler_id: null, ...o });
const repRobe = (o) => ({ product_type: 'robe', design_id: null, has_embroidery: true, needs_pressing: true, wholesaler_id: 'w1', ...o });
const repCap = (o) => ({ product_type: 'cap', design_id: null, has_embroidery: true, needs_pressing: false, wholesaler_id: 'w1', ...o });
const staff = (t) => ({ role: 'staff', staff_type: t, staff_types: [t] });

test('1. only a rep SASH is an assembly piece — by wholesaler_id or by queue-row source', () => {
  assert.equal(isAssemblyPiece(repSash()), true);
  assert.equal(isAssemblyPiece({ product_type: 'sash', source: 'wholesaler' }), true);
  assert.equal(isAssemblyPiece(retailSash()), false);
  assert.equal(isAssemblyPiece({ product_type: 'sash', source: 'retail' }), false);
  assert.equal(isAssemblyPiece(repRobe()), false);
  assert.equal(isAssemblyPiece(repCap()), false);
  assert.equal(isAssemblyPiece({ product_type: 'shawl', wholesaler_id: 'w1' }), false);
});

test('2. a rep sash leaves التطريز for التجميع; retail sash, rep robe and rep cap still go where they went', () => {
  assert.equal(nextStageFor(repSash({ status: 'embroidery' })), 'assembly');
  assert.equal(nextStageFor(retailSash({ status: 'embroidery' })), 'pressing');
  assert.equal(nextStageFor(retailSash({ status: 'embroidery', needs_pressing: false })), 'preparing');
  assert.equal(nextStageFor(repRobe({ status: 'embroidery' })), 'pressing');
  assert.equal(nextStageFor(repCap({ status: 'embroidery' })), 'preparing');
});

test('3. after التجميع: الكوي if needs_pressing, else التجهيز', () => {
  assert.equal(nextStageFor(repSash({ status: 'assembly' })), 'pressing');
  assert.equal(nextStageFor(repSash({ status: 'assembly', needs_pressing: false })), 'preparing');
});

test('4. revert lands where the piece came from — same fork, asked backwards', () => {
  assert.equal(resolveRevertTarget(repSash({ status: 'pressing' })), 'assembly');
  assert.equal(resolveRevertTarget(repSash({ status: 'preparing', needs_pressing: false })), 'assembly');
  assert.equal(resolveRevertTarget(repSash({ status: 'preparing' })), 'pressing');
  assert.equal(resolveRevertTarget(repSash({ status: 'assembly' })), 'embroidery');
  assert.equal(resolveRevertTarget(retailSash({ status: 'pressing' })), 'embroidery');
  assert.equal(resolveRevertTarget(repRobe({ status: 'pressing' })), 'embroidery');
  // A plain rep sash (the code path exists even if the shop never sells one) is born at
  // التجميع and has nothing behind it.
  assert.equal(resolveRevertTarget(repSash({ status: 'assembly', has_embroidery: false })), null);
  assert.equal(resolveRevertTarget(repSash({ status: 'pressing', has_embroidery: false })), 'assembly');
  // A plain rep robe: الكوي is its first stage, as before.
  assert.equal(resolveRevertTarget(repRobe({ status: 'pressing', has_embroidery: false })), null);
});

test('5. every new edge is open to the line, closed to the tailor, and never reaches the design desk', () => {
  const edges = [['embroidery', 'assembly'], ['assembly', 'pressing'], ['assembly', 'preparing'],
                 ['assembly', 'embroidery'], ['pressing', 'assembly'], ['preparing', 'assembly']];
  for (const [from, to] of edges) {
    assert.ok(TRANSITIONS[from].includes(to), `${from}→${to} in TRANSITIONS`);
    for (const t of ['assembler', 'presser', 'embroiderer', 'preparer', 'designer', 'digitizer']) {
      assert.equal(canStaffTransition(staff(t), from, to), true, `${t} ${from}→${to}`);
    }
    assert.equal(canStaffTransition(staff('tailor'), from, to), false, `tailor ${from}→${to}`);
  }
  assert.equal(canStaffTransition(staff('assembler'), 'design_complete', 'embroidery'), false);
  assert.equal(canStaffTransition(staff('assembler'), 'assembly', 'cancelled'), false);
});

test('6. labels exist for every new edge and for the status itself', () => {
  for (const k of ['embroidery→assembly', 'assembly→pressing', 'assembly→preparing']) assert.ok(ADVANCE_LABEL_AR[k], k);
  assert.equal(STATUS_LABEL_AR.assembly, 'قيد التجميع');
});

test('7. «مرحلتي» for the assembler is التجميع and only that; the whole line may look at it', () => {
  assert.deepEqual(QUEUE_STAGES.assembler, ['assembly']);
  assert.ok(LINE_VIEW_STAGES.includes('assembly'));
  assert.ok(QUEUE_STAGES.tailor.includes('assembly'));
});
