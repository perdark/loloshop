'use strict';
// Who may open الخط العربي, and who may push an order out of التصميم with it. The two are
// different questions on purpose: محمد عماد (المطرّز) generates and downloads plates/DST for
// his own station; «تحويل للتطريز» stays the designer's (advanceBlockReason's side door).
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { mayUseTool, mayPushOrder } = require('../lib/calligraphyAccess');

const staff = (...types) => ({ role: 'staff', staff_type: types[0], staff_types: types });

test('1. embroiderer may use the tool', () => {
  assert.equal(mayUseTool(staff('embroiderer')), true);
});
test('2. embroiderer may NOT push an order to التطريز', () => {
  assert.equal(mayPushOrder(staff('embroiderer')), false);
});
test('3. designer and manager may do both; presser neither', () => {
  assert.equal(mayUseTool(staff('designer')), true);
  assert.equal(mayPushOrder(staff('designer')), true);
  assert.equal(mayUseTool(staff('manager')), true);
  assert.equal(mayPushOrder(staff('manager')), true);
  assert.equal(mayUseTool(staff('presser')), false);
  assert.equal(mayPushOrder(staff('presser')), false);
});
test('4. multi-role: presser+embroiderer may use the tool', () => {
  assert.equal(mayUseTool(staff('presser', 'embroiderer')), true);
});
test('5. admin always; retail never', () => {
  assert.equal(mayUseTool({ role: 'admin' }), true);
  assert.equal(mayPushOrder({ role: 'admin' }), true);
  assert.equal(mayUseTool({ role: 'retail' }), false);
});
