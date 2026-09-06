// Tests for viewerStages — «which production stages does the person looking at the rep
// console personally work». This is what lets the console open on the viewer's own station
// instead of every station's finished work (2026-08-13 bug plan, Track C / bug 2: a designer
// opening محمد باقر's console got 402 rows — 276 قيد التطريز, 120 قيد التجهيز, 1 قيد الكوي —
// of which only 5 were a designer's work).
//
// The point of these assertions is that viewerStages is DERIVED from orderController's
// STAGE_AUTHZ (a status is "mine" when I may move an order out of it) rather than being a
// second hand-maintained copy of productionController's QUEUE_STAGES. The expected values
// below are QUEUE_STAGES (productionController.js:60) written out literally, so if anyone
// edits STAGE_AUTHZ and the two definitions drift apart, this test fails instead of the
// console quietly showing a worker the wrong queue.
//
// Pure function, no DB.
const test = require('node:test');
const assert = require('node:assert');
const { viewerStages } = require('../controllers/staffController');

const staff = (...types) => ({ role: 'staff', staff_types: types });
const sorted = (a) => [...a].sort();

// productionController.js:60 — QUEUE_STAGES, verbatim, for the five staff_types that
// actually move orders through the line.
const QUEUE_STAGES = {
  designer: ['design_complete'],
  digitizer: ['converting'],
  embroiderer: ['embroidery'],
  assembler: ['assembly'],
  presser: ['pressing'],
  preparer: ['preparing', 'ready', 'delivered'],
};

for (const [type, expected] of Object.entries(QUEUE_STAGES)) {
  test(`${type} owns exactly its QUEUE_STAGES entry`, () => {
    assert.deepStrictEqual(sorted(viewerStages(staff(type))), sorted(expected));
  });
}

test('preparer keeps جاهز and مُسلّم — stations are not the same thing as can_advance', () => {
  // ready→delivered goes through the delivery modal, so `can_advance` is deliberately false
  // for a `ready` row. Those orders are still the preparer's work, so «مرحلتي» must show
  // them even though «يخصّني الآن» does not. This is why the default view is stage-based
  // and not just a reuse of can_advance.
  const stages = viewerStages(staff('preparer'));
  assert.ok(stages.includes('ready'), 'جاهز للاستلام belongs to the preparer');
  assert.ok(stages.includes('delivered'), 'تم التسليم belongs to the preparer');
});

test('multi-role staff get the UNION of their stations', () => {
  assert.deepStrictEqual(
    sorted(viewerStages(staff('designer', 'embroiderer'))),
    sorted(['design_complete', 'embroidery'])
  );
});

test('manager and admin have no personal station — they get الكل', () => {
  // canStaffTransition passes these two everything, so without the short-circuit they would
  // "own" all eleven live stages and the console would filter to nothing useful.
  assert.deepStrictEqual(viewerStages(staff('manager')), []);
  assert.deepStrictEqual(viewerStages({ role: 'admin' }), []);
  assert.deepStrictEqual(viewerStages(staff('designer', 'manager')), []);
});

test('tailor (مفصل) has no personal station — read-only viewer of the whole line', () => {
  // مفصل holds no transitions by design, so it derives to [] and the console opens on
  // «الكل». That is the correct default for a role whose whole job is to look at everything.
  assert.deepStrictEqual(viewerStages(staff('tailor')), []);
});

test('cancelled is never a station', () => {
  for (const type of Object.keys(QUEUE_STAGES)) {
    assert.ok(!viewerStages(staff(type)).includes('cancelled'), `${type} must not own cancelled`);
  }
});

test('the raw staff_type[] literal from pg is handled, not collapsed', () => {
  // lib/db may hand back "{designer,embroiderer}" if the array parser wasn't registered;
  // staffTypesOf normalizes it. Assert viewerStages inherits that, or a fresh-DB startup
  // race would silently give a multi-role worker the wrong queue.
  assert.deepStrictEqual(
    sorted(viewerStages({ role: 'staff', staff_types: '{designer,embroiderer}' })),
    sorted(['design_complete', 'embroidery'])
  );
});
