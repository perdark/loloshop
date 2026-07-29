const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeCardNumber,
  normalizeAccountNumber,
  isValidCardNumber,
  isValidAccountNumber,
} = require('../lib/payoutAccount');

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

test('account number normalizes Arabic digits and separators', () => {
  assert.equal(normalizeAccountNumber('١٢٣ ٤٥٦-٧٨٩'), '123456789');
});

test('account number accepts any real length (9, 10, 12 digits)', () => {
  assert.equal(isValidAccountNumber('123456789'), true);
  assert.equal(isValidAccountNumber('123 456 789'), true);
  assert.equal(isValidAccountNumber('1234567890'), true);
  assert.equal(isValidAccountNumber('123456789012'), true);
  assert.equal(isValidCardNumber('123456789'), false);
});

test('account number rejects only empty input and absurd length', () => {
  assert.equal(isValidAccountNumber('1'), true);
  assert.equal(isValidAccountNumber('-'), false);
  assert.equal(isValidAccountNumber('1'.repeat(24)), true);
  assert.equal(isValidAccountNumber('1'.repeat(25)), false);
});

test('a missing value is not a valid number of either kind', () => {
  assert.equal(isValidAccountNumber(undefined), false);
  assert.equal(isValidAccountNumber(''), false);
  assert.equal(isValidCardNumber(null), false);
});
