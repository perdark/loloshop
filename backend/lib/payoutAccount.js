const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC = '۰۱۲۳۴۵۶۷۸۹';

function normalizeCardNumber(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_INDIC.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(EASTERN_ARABIC.indexOf(digit)))
    .replace(/\D/g, '');
}

function isValidCardNumber(value) {
  return /^[0-9]{16}$/.test(normalizeCardNumber(value));
}

module.exports = { normalizeCardNumber, isValidCardNumber };
