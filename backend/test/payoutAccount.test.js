const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCardNumber, isValidCardNumber } = require('../lib/payoutAccount');

test('normalizes grouped Latin digits', () => {
  assert.equal(normalizeCardNumber('1234 5678-9012 3456'), '1234567890123456');
});

test('normalizes Arabic and Eastern Arabic digits', () => {
  assert.equal(normalizeCardNumber('١٢٣٤ ٥٦٧٨ ۹۰۱۲ ۳۴۵۶'), '1234567890123456');
});

test('requires exactly sixteen digits', () => {
  assert.equal(isValidCardNumber('1234 5678 9012 3456'), true);
  assert.equal(isValidCardNumber('1234 5678'), false);
  assert.equal(isValidCardNumber('1234 5678 9012 3456 7'), false);
});
