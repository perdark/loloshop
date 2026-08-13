// Tests for the calligraphy text gate — «is this a name to embroider, or a message to us?».
//
// The four instruction strings below are REAL `order_items.customer_text` values measured on
// prod 2026-08-13, from the 27 lines whose text explicitly refers to a photo the generator
// then deleted. The clean names are real too — reps and students off the same live table,
// picked because each one is a trap for a lazy matcher:
//   · «منصور» contains «صور» — the reason this never substring-matches.
//   · «بسمة» «فاطمة» «وليد» «كاظم» «لمياء» all start with a letter that is also a clitic.
// A false positive here means a designer retypes a name for no reason, so the clean list is
// the more important half of this file.
const test = require('node:test');
const assert = require('node:assert');
const {
  isRealName, looksLikeInstruction, instructionMarkers, checkRenderText,
} = require('../lib/calligraphyText');

// ---------------------------------------------------------------------------
// The real instructions that were rendered as calligraphy and billed for
// ---------------------------------------------------------------------------
const REAL_INSTRUCTIONS = [
  'نفس الصوره',
  'تطريز هذه الصورة فقط',
  'نفس الي بالصورة بس اصغر',
  'نبأ اوريد نفس الخط الموجود في الصورة',
];

test('every instruction measured on prod is caught', () => {
  for (const text of REAL_INSTRUCTIONS) {
    assert.strictEqual(looksLikeInstruction(text), true, `missed: ${text}`);
  }
});

test('«نفس الصوره» fires on the PHOTO word, not on «نفس»', () => {
  const markers = instructionMarkers('نفس الصوره');
  assert.ok(markers.includes('الصوره'));
  // «نفس» is deliberately not a marker: ﴿كل نفس ذائقة الموت﴾ is sash text, not a request.
  assert.ok(!markers.includes('نفس'));
});

test('the clitic forms of «صورة» are caught, the name «منصور» is not', () => {
  assert.strictEqual(looksLikeInstruction('بالصورة'), true);
  assert.strictEqual(looksLikeInstruction('الصورة'), true);
  assert.strictEqual(looksLikeInstruction('صوره'), true);
  assert.strictEqual(looksLikeInstruction('منصور'), false);
  assert.strictEqual(looksLikeInstruction('منصور علي حسين'), false);
});

// ---------------------------------------------------------------------------
// Real names that must sail through — a false positive costs a designer's time
// ---------------------------------------------------------------------------
const CLEAN_NAMES = [
  'محمد باقر',
  'عبدالعزيز رعد خضير',
  'مهدي علي حسين',
  'أنس صباح صبري حسن',
  'مصطفى هيثم هادي',
  'طارق زيد علي',
  'فاطمة الزهراء',
  'بسمة',
  'وليد خالد',
  'كاظم جواد',
  'لمياء عبد الحسين',
  'نبأ',
  'زينب',
  'بلاد الرافدين',
  'كلية القانون',
  'دفعة التخرج 2025',
  // Department names that READ like instruction words. These are why «تصميم» «شعار» «حرف»
  // and «حروف» are not markers — students embroider them on the back of a sash.
  'قسم تصميم الأزياء',
  'قسم الحرف اليدوية',
  'كلية الفنون الجميلة',
  // ── REGRESSION LOCKS ──────────────────────────────────────────────────────
  // Every string below is real back-of-sash text from the live table that a WIDER version of
  // this matcher flagged as an instruction on 2026-08-13. Each one cost a marker:
  'الحمدلله هذا ماسعيت له وهذا ماوعدني به ربي',   // «هذا»
  'الى عائلتي انتم حكاية نجاحي',                  // «الى» normalises to «الي»
  'كل نفس ذائقة الموت',                            // «نفس»
  'مَّن كَانَ يُرِيدُ ثَوَابَ الدُّنْيَا فَعِندَ اللَّهِ ثَوَابُ الدُّنْيَا وَالْآخِرَةِ', // «يريد»
];

test('real names and cohort text are never flagged as instructions', () => {
  for (const name of CLEAN_NAMES) {
    assert.strictEqual(looksLikeInstruction(name), false, `false positive: ${name}`);
  }
});

// ---------------------------------------------------------------------------
// isRealName — the pre-existing junk guard, unchanged behaviour after the move
// ---------------------------------------------------------------------------
test('isRealName keeps rejecting junk and keeps accepting names', () => {
  assert.strictEqual(isRealName('علي'), true);
  assert.strictEqual(isRealName('اب'), true);          // exactly two letters is the floor
  assert.strictEqual(isRealName('ا'), false);          // one letter
  assert.strictEqual(isRealName('123'), false);
  assert.strictEqual(isRealName('Ahmed'), false);
  assert.strictEqual(isRealName('...'), false);
  assert.strictEqual(isRealName('🎓'), false);
  assert.strictEqual(isRealName(''), false);
  assert.strictEqual(isRealName(null), false);
  assert.strictEqual(isRealName('ـــ'), false);        // tatweel only — not letters
});

// ---------------------------------------------------------------------------
// checkRenderText — the single call site everything else uses
// ---------------------------------------------------------------------------
test('checkRenderText separates empty, junk and instruction with distinct reasons', () => {
  assert.deepStrictEqual(checkRenderText('   ').reason, 'nonempty');
  assert.deepStrictEqual(checkRenderText('123').reason, 'junk');
  assert.deepStrictEqual(checkRenderText('نفس الصوره').reason, 'instruction');
  assert.strictEqual(checkRenderText('محمد باقر').ok, true);
});

test('checkRenderText messages are Arabic and name the offending words', () => {
  const out = checkRenderText('تطريز هذه الصورة فقط');
  assert.strictEqual(out.ok, false);
  assert.ok(out.message.includes('تعليمات'));
  assert.ok(out.markers.length >= 2);
});
