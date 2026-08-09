const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC = '۰۱۲۳۴۵۶۷۸۹';

/** SuperQi Mastercard number. */
const CARD_DIGITS = 16;
/**
 * SuperQi account numbers are NOT a fixed length — 9, 10 and 12 digits are all
 * real, so only "digits, not empty" is enforced. The maximum is a storage guard
 * (see migration 074), not a format rule.
 */
const ACCOUNT_MAX_DIGITS = 24;

function normalizeDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_INDIC.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(EASTERN_ARABIC.indexOf(digit)))
    .replace(/\D/g, '');
}

// Both numbers are plain digit strings; the only difference is the length.
const normalizeCardNumber = normalizeDigits;
const normalizeAccountNumber = normalizeDigits;

function isValidCardNumber(value) {
  return normalizeDigits(value).length === CARD_DIGITS;
}

function isValidAccountNumber(value) {
  const digits = normalizeDigits(value).length;
  return digits > 0 && digits <= ACCOUNT_MAX_DIGITS;
}

module.exports = {
  CARD_DIGITS,
  ACCOUNT_MAX_DIGITS,
  normalizeCardNumber,
  normalizeAccountNumber,
  isValidCardNumber,
  isValidAccountNumber,
};
