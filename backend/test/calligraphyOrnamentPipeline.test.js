// The ornament dial and the photo-reference prompt (migration 112) — pure, no DB, no network.
// What is pinned here is what cannot be seen until a plate is paid for and cropped: every level
// keeps ornaments inside the name's own line band, `null` renders exactly as before the dial
// existed, and the reference prompt never lets the photo's words onto the plate.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/calligraphyPrompt');
const { _internals: { estimate } } = require('../lib/calligraphyPipeline');
const { _internals: { cleanDescription } } = require('../lib/calligraphyPhoto');

test('null ornament renders byte-for-byte what it did before the dial', () => {
  // The zone defaults are what every existing plate was generated with.
  assert.equal(P.buildSinglePrompt('رتاج', 'front'), P.buildSinglePrompt('رتاج', 'front', null, null, null));
  assert.equal(P.buildSheetPrompt(['a', 'b'], 'cap'), P.buildSheetPrompt(['a', 'b'], 'cap', null, null));
});

test('every non-none level keeps ornaments inside the line band (the crop depends on it)', () => {
  for (const level of ['light', 'medium', 'rich']) {
    assert.match(P.buildSheetPrompt(['a', 'b'], 'front', null, level), /SAME horizontal line as its own name/);
  }
});

test('the levels are distinct and none forbids ornaments', () => {
  const texts = ['none', 'light', 'medium', 'rich'].map((l) => P.buildSinglePrompt('x', 'front', null, null, l));
  assert.equal(new Set(texts).size, 4);
  assert.match(texts[0], /NO decorative ornaments/);
});

test('an unknown ornament degrades to the zone default, never into the prompt', () => {
  assert.equal(P.normalizeOrnament('loud'), null);
  assert.equal(P.buildSinglePrompt('x', 'front', null, null, 'loud'), P.buildSinglePrompt('x', 'front'));
});

test('every level binds the space around the name, never the letterforms', () => {
  for (const level of ['light', 'medium', 'rich']) {
    assert.match(P.buildSinglePrompt('x', 'front', null, null, level), /letters themselves stay fully calligraphic/);
  }
});

test('the reference prompt forbids copying words from the photo and names only our text', () => {
  const p = P.buildReferencePrompt('المعالجة النفسية زينب', 'front');
  assert.match(p, /STYLE REFERENCE ONLY/);
  assert.match(p, /Do NOT copy ANY words/);
  assert.match(p, /المعالجة النفسية زينب$/);
  assert.match(p, /ONE centered horizontal line/);
});

test('photo description is forced into the closed lists, and only writing may steer style', () => {
  assert.equal(cleanDescription({ content: 'calligraphy' }).style_reference, true);
  assert.equal(cleanDescription({ content: 'embroidered_text' }).style_reference, true);
  for (const c of ['logo', 'screenshot', 'garment', 'drawing', 'other', 'whatever']) {
    assert.equal(cleanDescription({ content: c }).style_reference, false);
  }
  assert.equal(cleanDescription({ content: 'calligraphy', ornament: 'extreme' }).ornament, null);
  assert.equal(cleanDescription(null).content, 'other');
});

test('the estimate prices sheets per ornament group and references one by one', () => {
  const auto = [
    ...Array.from({ length: 10 }, () => ({ ornament: null })),
    ...Array.from({ length: 6 }, () => ({ ornament: 'rich' })),
    { ornament: null, ref_image_url: 'x' },
  ];
  const e = estimate(auto);
  // 10 default = 2 full sheets; 6 rich = 1 full + a solo; 1 reference.
  assert.equal(e.sheets, 4);
  assert.equal(e.references, 1);
  assert.ok(e.usd > 0.3 && e.usd < 0.6);
});
