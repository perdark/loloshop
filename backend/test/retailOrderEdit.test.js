process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';

const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeRetailMeasurements,
  comparableSelections,
  comparableStoredSelections,
} = require('../controllers/orderEditController');
const { validateRobeMeasurements } = require('../controllers/orderController');

test('retail robe editor uses the same required measurement rules as checkout', () => {
  assert.match(validateRobeMeasurements('robe', {}), /قياسات الروب/);
  assert.strictEqual(validateRobeMeasurements('robe', {
    shoulder_cm: 45,
    robe_length_cm: 120,
    sleeve_length_cm: 60,
  }), null);
  assert.match(validateRobeMeasurements('robe', {
    shoulder_cm: 45,
    chest_cm: 40,
    robe_length_cm: 120,
    sleeve_length_cm: 60,
  }), /60 و 180/);
  assert.strictEqual(validateRobeMeasurements('cap', null), null);
});

test('normalises optional robe fields without turning blank chest into zero', () => {
  assert.deepStrictEqual(normalizeRetailMeasurements('robe', {
    shoulder_cm: '45',
    chest_cm: '',
    robe_length_cm: '120',
    sleeve_length_cm: '60',
    tailor_notes: '  توسيع الصدر  ',
    receipt_image_url: ' /uploads/images/a.jpg ',
  }), {
    shoulder_cm: 45,
    chest_cm: null,
    robe_length_cm: 120,
    sleeve_length_cm: 60,
    tailor_notes: 'توسيع الصدر',
    receipt_image_url: '/uploads/images/a.jpg',
  });
  assert.strictEqual(normalizeRetailMeasurements('cap', {}), null);
});

test('selection comparison includes option, quantity, text and replacement image', () => {
  const normalized = comparableSelections([
    {
      group_id: 'b',
      option_id: '2',
      qty: 2,
      customer_text: '  اسم  ',
      customer_image_url: ' /new.jpg ',
    },
    { group_id: 'a', option_id: '1', qty: 1 },
  ]);
  assert.deepStrictEqual(normalized, [
    {
      group_id: 'a',
      option_id: '1',
      qty: 1,
      customer_text: null,
      customer_image_url: null,
    },
    {
      group_id: 'b',
      option_id: '2',
      qty: 2,
      customer_text: 'اسم',
      customer_image_url: '/new.jpg',
    },
  ]);
});

test('saved cart quantities are compared at their per-piece value', () => {
  assert.deepStrictEqual(comparableStoredSelections([
    { group_id: 'a', option_id: '1', qty: 3 },
    { group_id: 'b', option_id: '2', qty: 6 },
  ], 3), [
    {
      group_id: 'a',
      option_id: '1',
      qty: 1,
      customer_text: null,
      customer_image_url: null,
    },
    {
      group_id: 'b',
      option_id: '2',
      qty: 2,
      customer_text: null,
      customer_image_url: null,
    },
  ]);
});
