// The understanding layer's trust boundary — pure, no DB, no network, no paid call.
// `guard()` is what decides which lines generate with nobody watching, so every rule that can
// demote a line or rewrite a field is pinned here. The model half is measured separately by
// `scripts/calligraphy-understand-eval.js` against what designers actually generated.
const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals: { guard, droppedLead } } = require('../lib/calligraphyUnderstand');

const line = (text, extra = {}) => ({ id: 'x', text, account_name: 'زينب كاظم جواد', has_photo: false, ...extra });

test('a clean, verified line stays high', () => {
  const out = guard({ kind: 'name', text: 'الأستاذة مريم علي', confidence: 'high' }, line('الأستاذة مريم علي'));
  assert.equal(out.confidence, 'high');
  assert.deepEqual(out.flags, []);
});

test('a word the student never wrote demotes the line', () => {
  const out = guard({ kind: 'name', text: 'الأستاذة مريم علي حسين', confidence: 'high' }, line('الأستاذة مريم علي'));
  assert.equal(out.confidence, 'low');
  assert.match(out.flags.join(), /حسين/);
});

test('account-name words are allowed ONLY when the model says it used the account', () => {
  const asked = guard({ kind: 'name', text: 'زينب', from_account: true, confidence: 'high' }, line('اسمي مزخرف'));
  assert.equal(asked.confidence, 'high');
  const smuggled = guard({ kind: 'name', text: 'زينب', from_account: false, confidence: 'high' }, line('اسمي مزخرف'));
  assert.equal(smuggled.confidence, 'low');
});

test('a letter is stitched as the glyph, even when the model returns its name', () => {
  const out = guard({ kind: 'letter', text: 'غين', confidence: 'high' }, line('حرف الغين'));
  assert.equal(out.text, 'غ');
  assert.equal(out.confidence, 'high');
});

test('a glyph is accepted when the student wrote the letter name', () => {
  assert.equal(guard({ kind: 'letter', text: 'خ', confidence: 'high' }, line('حرف الخاء')).confidence, 'high');
});

test('merged letters are a design decision, never unattended', () => {
  assert.equal(guard({ kind: 'letter', text: 'م ح', confidence: 'high' }, line('دمج حرف م مع ح')).confidence, 'low');
});

test('a dropped title demotes the line', () => {
  const out = guard({ kind: 'name', text: 'زهراء عيدان', confidence: 'high' }, line('الكيميائية زهراء عيدان'));
  assert.equal(out.confidence, 'low');
});

test('words about the order in front of the name are not a dropped title', () => {
  assert.deepEqual(droppedLead('الادارية منار منذر', 'كتابة الادارية منار منذر'), []);
});

test('photo_style needs the student to SAY it, not just to attach a photo', () => {
  const silent = guard({ kind: 'name', text: 'زينة', photo_style: true, confidence: 'high' }, line('زينة', { has_photo: true }));
  assert.equal(silent.photo_style, false);
  const said = guard({ kind: 'name', text: 'زينة', photo_style: true, confidence: 'high' }, line('زينة بنفس الخط الي بالصورة', { has_photo: true }));
  assert.equal(said.photo_style, true);
  const noPhoto = guard({ kind: 'name', text: 'زينة', photo_style: true, confidence: 'high' }, line('زينة مثل الصورة'));
  assert.equal(noPhoto.photo_style, false);
});

test('the ornament dial moves only on the student\'s words — harakat are not a request', () => {
  assert.equal(guard({ kind: 'name', text: 'عَلِيٌّ هَيْثَمٌ', ornament: 'rich', confidence: 'high' }, line('عَلِيٌّ هَيْثَمٌ')).ornament, null);
  assert.equal(guard({ kind: 'name', text: 'رتاج', ornament: 'light', confidence: 'high' }, line('رتاج بزخرفة قليلة')).ornament, 'light');
  assert.equal(guard({ kind: 'name', text: 'رتاج', ornament: 'medium', confidence: 'high' }, line('رتاج مزخرف')).ornament, 'medium');
  assert.equal(guard({ kind: 'name', text: 'رتاج', ornament: 'loud', confidence: 'high' }, line('رتاج مزخرف')).ornament, null);
});

test('pictographs never reach the written text', () => {
  const out = guard({ kind: 'name', text: 'زهراء 🦋', motif: 'فراشة', confidence: 'high' }, line('زهراء 🦋'));
  assert.equal(out.text, 'زهراء');
  assert.equal(out.motif, 'فراشة');
});

test('instruction residue in the text demotes the line', () => {
  assert.equal(guard({ kind: 'name', text: 'الـ ذرى اريد', confidence: 'high' }, line('الـ ذرى اريد فراشة')).confidence, 'low');
});

test('Latin in the text demotes — the generator writes Arabic only', () => {
  assert.equal(guard({ kind: 'name', text: 'علي M', confidence: 'high' }, line('علي M')).confidence, 'low');
});

test('the guard never promotes a low answer', () => {
  assert.equal(guard({ kind: 'name', text: 'علي', confidence: 'low' }, line('علي')).confidence, 'low');
});

test('unclear and photo_only carry no text and are never unattended', () => {
  for (const kind of ['unclear', 'photo_only']) {
    const out = guard({ kind, text: 'شعار شركة', confidence: 'high' }, line('شعار شركة'));
    assert.equal(out.text, null);
    assert.equal(out.confidence, 'low');
  }
});

test('an unverifiable other-side text is dropped, the name stays high', () => {
  const out = guard({ kind: 'name', text: 'علي حسين', side_text: 'كلية الطب', confidence: 'high' }, line('علي حسين قسم المدني'));
  assert.equal(out.side_text, null);
  assert.equal(out.confidence, 'high');
});

test('garbage from the model degrades to a low unclear, never throws', () => {
  const out = guard(null, line('علي'));
  assert.equal(out.kind, 'unclear');
  assert.equal(out.confidence, 'low');
});
