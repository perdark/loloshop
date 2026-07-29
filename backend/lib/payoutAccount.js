const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC = '۰۱۲۳۴۵۶۷۸۹';

/** SuperQi Mastercard number. */
const CARD_DIGITS = 16;
/** SuperQi account number used for transfers inside the Qi wallet. */
const ACCOUNT_DIGITS = 9;

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
  return normalizeDigits(value).length === ACCOUNT_DIGITS;
}

module.exports = {
  CARD_DIGITS,
  ACCOUNT_DIGITS,
  normalizeCardNumber,
  normalizeAccountNumber,
  isValidCardNumber,
  isValidAccountNumber,
};
