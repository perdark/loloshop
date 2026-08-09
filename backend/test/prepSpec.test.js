// Tests for buildPieceSpec — the التجهيز piece spec, i.e. «which garment do I pull off the
// shelf for this student». Spec lines live in order_items alongside embroidery lines and
// pricing bookkeeping, and the three have to be told apart correctly or the preparer's card
// is either empty or noise.
//
// Every label below is a REAL value measured off the preparing+ready queue on 2026-08-05
// (483 orders: 310 robes · 105 caps · 65 shawls · 3 sashes), not an invented fixture. The
// counts in the comments are that measurement.
//
// Pure function, no DB: these assert the partitioning rules, not the shop's data.
const test = require('node:test');
const assert = require('node:assert');
const { buildPieceSpec } = require('../controllers/productionController');

const item = (label, extra = {}) => ({
  label_snapshot: label,
  customer_text: null,
  customer_image_url: null,
  group_ar: null,
  ...extra,
});

test('a chosen option becomes a label/value pair with the group prefix stripped', () => {
  // 85 robes in the queue carry all three of these.
  const spec = buildPieceSpec([
    item('لون الروب: أسود', { group_ar: 'لون الروب' }),
    item('قماش الروب: ياباني', { group_ar: 'قماش الروب' }),
    item('فصال الروب: ملكي', { group_ar: 'فصال الروب' }),
  ]);
  assert.deepStrictEqual(
    spec.map((s) => [s.label, s.value]),
    [
      ['لون الروب', 'أسود'],
      ['قماش الروب', 'ياباني'],
      ['فصال الروب', 'ملكي'],
    ]
  );
});

test('pricing and packaging lines are dropped — they are not a spec', () => {
  // 'السعر الأساسي' (209 lines) and 'قطعة: روب' (222) are bookkeeping; the card already
  // names the product, so repeating it costs a row and says nothing.
  const spec = buildPieceSpec([
    item('السعر الأساسي'),
    item('قطعة: روب'),
    item('طقم كامل'),
    item('لون القبعة: أسود', { group_ar: 'لون القبعة' }),
  ]);
  assert.deepStrictEqual(spec.map((s) => s.label), ['لون القبعة']);
});

test("the student's free-text instruction survives even with no option group", () => {
  // «كسرة الكتف» is the single most common line in the whole queue — 225 of them, every one
  // carrying text and NO group. An ungrouped-lines-are-noise rule would delete all 225.
  const spec = buildPieceSpec([
    item('كسرة الكتف', { customer_text: 'كسرتين من فوك' }),
    item('نوع القبعة', { customer_text: 'ملكية' }),
  ]);
  assert.deepStrictEqual(
    spec.map((s) => [s.label, s.value, s.text]),
    [
      ['كسرة الكتف', null, 'كسرتين من فوك'],
      ['نوع القبعة', null, 'ملكية'],
    ]
  );
});

test('whitespace-only text does not qualify an ungrouped line', () => {
  assert.deepStrictEqual(buildPieceSpec([item('كسرة الكتف', { customer_text: '   ' })]), []);
});

test('embroidery lines are dropped — they already render as artwork in `zones`', () => {
  // Showing the same zone twice pads a card that has to stay fast to read.
  const spec = buildPieceSpec([
    item('تطريز يمين: تطريز يمين', {
      group_ar: 'تطريز يمين',
      customer_text: 'اسم الطالبة',
    }),
    item('القبعة من الجانب: بكتابة', {
      group_ar: 'القبعة من الجانب',
      customer_text: 'دفعة 2026',
    }),
    item('لون الروب: أسود', { group_ar: 'لون الروب' }),
  ]);
  assert.deepStrictEqual(spec.map((s) => s.label), ['لون الروب']);
});

test('a zone-NAMED line with no content is still a spec row, not a zone', () => {
  // «القبعة من الجانب: سادة» (60 in the queue) matches the cap_side zone test by name, but
  // سادة means plain — nothing is stitched. The zone detector requires content and correctly
  // ignores it; the preparer still needs to know the cap is plain, so it must land here.
  const spec = buildPieceSpec([
    item('القبعة من الجانب: سادة', { group_ar: 'القبعة من الجانب' }),
    item('القبعة من الأعلى: سادة', { group_ar: 'القبعة من الأعلى' }),
  ]);
  assert.deepStrictEqual(
    spec.map((s) => [s.label, s.value]),
    [
      ['القبعة من الجانب', 'سادة'],
      ['القبعة من الأعلى', 'سادة'],
    ]
  );
});

test('a non-zone image is carried, not silently dropped', () => {
  // 'اللون: لون الوشاح' carries a photo and matches no zone. Dropping it would lose artwork
  // the student uploaded — the same failure ZoneThumb guards against on the render side.
  const spec = buildPieceSpec([
    item('اللون: لون الوشاح', {
      group_ar: 'اللون',
      customer_text: 'نفس لون الوشاح',
      customer_image_url: '/uploads/images/abc.jpg',
    }),
  ]);
  assert.deepStrictEqual(spec, [
    { label: 'اللون', value: 'لون الوشاح', text: 'نفس لون الوشاح', image_url: '/uploads/images/abc.jpg' },
  ]);
});

test('the full label is kept when the snapshot does not match its group name', () => {
  // A snapshot taken before the group was renamed cannot be split safely. Showing the whole
  // stored label is the honest fallback; slicing by length would corrupt it.
  const spec = buildPieceSpec([
    item('اللون القديم: أسود', { group_ar: 'لون الروب' }),
  ]);
  assert.deepStrictEqual(spec, [
    { label: 'لون الروب', value: 'اللون القديم: أسود', text: null, image_url: null },
  ]);
});

test('a repeated group prints once — first occurrence wins', () => {
  const spec = buildPieceSpec([
    item('لون الروب: أسود', { group_ar: 'لون الروب' }),
    item('لون الروب: كحلي', { group_ar: 'لون الروب' }),
  ]);
  assert.deepStrictEqual(spec.map((s) => s.value), ['أسود']);
});

test('an order with nothing but bookkeeping yields an empty spec, never null', () => {
  // The card distinguishes "no spec" from "not fetched"; the builder must not blur that by
  // returning a nullish value the frontend would have to guess about.
  assert.deepStrictEqual(buildPieceSpec([item('السعر الأساسي')]), []);
  assert.deepStrictEqual(buildPieceSpec([]), []);
});
