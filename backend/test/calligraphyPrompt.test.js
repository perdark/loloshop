'use strict';
// The calligraphy prompt has now been broken in BOTH directions on consecutive days, and each
// break looked like a fix for the other one. This file pins both ends so the next edit cannot
// trade one for the other silently.
//
//   2026-09-14 — BASE asked for «masterful diacritics». 0 of 5 names came back clean: every
//                one vocalised, and the harakat dragged stray glyphs (ص, ء, مُ, س) in with
//                them. On a sash those are stitched specks nobody ordered.
//   2026-09-15 — the fix for that deleted the only artistry wording in the prompt and replaced
//                it with prohibitions, including «never thin … or hairline» directly against
//                «strong thick/thin contrast». The owner: «يولد صور بخطوط عادية وليس مزخرفة».
//                A prompt that is mostly prohibitions draws a typeface.
//
// Pure — no DB, no network, no paid image. Everything here is string shape.
const test = require('node:test');
const assert = require('node:assert');
const {
  buildSheetPrompt, buildSinglePrompt, buildElementPrompt,
} = require('../lib/calligraphyPrompt');

const VARIANTS = ['front', 'back', 'cap'];
const STYLES = [null, 'extend', 'bold', 'plain'];

// Every prompt a paid image is ever bought with, across both entry points and every knob.
function allPrompts() {
  const out = [];
  for (const v of VARIANTS) {
    for (const s of STYLES) {
      out.push([`sheet/${v}/${s}`, buildSheetPrompt(['مصطفى علي', 'ديالى'], v, s)]);
      out.push([`single/${v}/${s}`, buildSinglePrompt('نور الهدى', v, null, s)]);
    }
  }
  return out;
}

test('every prompt asks for Thuluth calligraphy, not for text', () => {
  for (const [label, p] of allPrompts()) {
    assert.match(p, /THULUTH calligraphy/i, `${label}: the script is never named`);
  }
});

test('the weight rule never bans thinness — that is the contrast itself', () => {
  // «strong thick/thin contrast» + «never thin, faint, wiry or hairline» is a contradiction,
  // and the model settles it by drawing one flat weight. The thin stroke is what a broad nib
  // MAKES when it turns; only an overall faint or wiry line is forbidden.
  for (const [label, p] of allPrompts()) {
    assert.doesNotMatch(p, /never[^.]*\bthin\b/i, `${label}: thinness is banned again`);
    assert.doesNotMatch(p, /hairline/i, `${label}: hairlines are the fine half of the contrast`);
    assert.match(p, /thick-and-thin|thick-to-thin|thick\/thin/i, `${label}: no contrast is asked for at all`);
  }
});

test('the prompt says NOTHING about diacritics, in either direction', () => {
  // ⚠️ THIS TEST HAS NOW BEEN WRITTEN THREE WAYS, ONCE PER OWNER RULING. Read the history in
  // lib/calligraphyPrompt.js before changing it again — each version was a real measurement:
  //
  //   7a7e5ee (09-14)  banned the marks     → clean names, but the prompt became prohibitions
  //                                           and the model drew a TYPEFACE.
  //   21d6ac0 (09-15)  demanded «masterful» → the owner chose these against a cleaner sheet.
  //                                           The marks are the product, not a spelling bug.
  //   this    (09-17)  says nothing at all  → the owner wrote the prompt himself and it is the
  //                                           only version whose marks he accepted («الحركات
  //                                           تراجعت بيهن كانوا افضل» was his verdict on the
  //                                           «few light marks» attempt).
  //
  // The rule that survived all three: name the HAND and let it draw its own marks. Any
  // explicit instruction — praise or ban — pulls them off their natural weight.
  for (const [label, p] of allPrompts()) {
    assert.doesNotMatch(p, /masterful diacritics/i, `${label}: asking for marks over-weights them`);
    assert.doesNotMatch(p, /NO diacritics at all|no harakat/i, `${label}: the ban is back`);
    assert.doesNotMatch(p, /light diacritical marks/i, `${label}: the 09-17 middle ground the owner rejected`);
    // ...and the hand that carries them must be named, or nothing draws marks at all.
    assert.match(p, /Iraqi-school Thuluth/i, `${label}: the named hand is what produces the marks`);
  }
});

test('the canvas is never described as a physical sheet of paper', () => {
  // ⚠️ THE MOST EXPENSIVE FAILURE FOUND SO FAR, BECAUSE NOTHING THROWS. The owner's draft
  // opened with «clean white A4 sheet, portrait» and the model PHOTOGRAPHED a page on a desk:
  // corner pixels 96/49/119/49, 0.0% pure white, 85.9% grey. cropSheet() still happily
  // reported 10 bands, so the pipeline raised nothing — but band 1 of 10 was a patch of
  // blurred desk, and that is what reaches order_items.plate_image_url and the embroiderer.
  // Describe a flat digital canvas; never an object a camera could point at.
  for (const [label, p] of allPrompts()) {
    // ⚠️ MATCH THE ASSERTION, NOT THE WORDS. The guard itself contains «No paper sheet», so a
    // naive /paper sheet/ test fails on the fix it is supposed to protect. What must never
    // appear is the canvas being ASSERTED as paper — «a clean white A4 sheet», «on a sheet of
    // paper» — so the pattern requires an article in front of it.
    assert.doesNotMatch(p, /\b(a|an|the)\s+(clean\s+)?(white\s+)?(A4|paper sheet|sheet of paper)/i,
      `${label}: the canvas is described as paper — the model will photograph it`);
    assert.match(p, /NOT a photograph/i, `${label}: the anti-photo guard is gone`);
    assert.match(p, /#FFFFFF/i, `${label}: the flat-white requirement is gone`);
  }
});

test('the embroidery rule is present and does not forbid interlocking', () => {
  // «NO stroke dropping below its line» is the owner's wording and it is what makes a plate
  // stitchable: it constrains where a stroke may TRAVEL, not how letters relate. The
  // alternative tried on 09-17 — «letters must not overlap, cross or interlock» — produced a
  // readable but plain line that is not Thuluth, and he rejected it.
  for (const [label, p] of allPrompts()) {
    assert.match(p, /NO stroke dropping below its line/i, `${label}: the embroidery rule is gone`);
    assert.doesNotMatch(p, /must not (overlap|interlock)/i, `${label}: this flattens the script`);
  }
});

test('guillemets are banned — element_text puts them IN the prompt', () => {
  // buildSheetPrompt wraps the motif word in «…», so the character is genuinely present in
  // the text the model reads and it will draw it around a name if not told otherwise.
  const p = buildSheetPrompt([{ text: 'ديالى', element: 'وردة' }], 'front', null);
  assert.match(p, /«وردة»/, 'the motif is passed wrapped — that is why the ban is needed');
  assert.match(p, /no guillemets/i, 'the ban must ride in the same prompt');
});

test('limiting ornaments never turns into an instruction about the letters', () => {
  // Owner decision 2026-08-26 (front is as plain as the back) is about the floated motifs.
  // Its old wording — «keep it mostly clean plain letters» — reached the letterforms too, and
  // landed in the same prompt as BASE's «only the letters themselves».
  for (const v of ['front', 'back']) {
    const p = buildSheetPrompt(['ديالى'], v, null);
    assert.match(p, /minimal ornamentation/i, `${v}: the owner's 08-26 limit is gone`);
  }
  // The cap is a separate garment and keeps its ornaments.
  assert.match(buildSheetPrompt(['ديالى'], 'cap', null), /Add small floated decorative ornaments/i);
});

test('«بدون زخرفة» still strips the ornaments without stripping the calligraphy', () => {
  const p = buildSheetPrompt(['ديالى'], 'front', 'plain');
  assert.match(p, /NO decorative ornaments at all/i);
  assert.match(p, /THULUTH calligraphy/i, 'the style knob must not cost the script');
});

test('the element motif prompt is unrelated artwork and carries no calligraphy rules', () => {
  const p = buildElementPrompt('وردة');
  assert.match(p, /line-art drawing/i);
  assert.doesNotMatch(p, /THULUTH/i, 'a motif is a drawing, not a name');
});
