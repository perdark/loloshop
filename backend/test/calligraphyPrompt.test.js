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
    assert.match(p, /master calligrapher/i, `${label}: nothing asks for artistry — 2026-09-15`);
  }
});

test('every prompt says outright that a font is the wrong answer', () => {
  // The 09-15 failure had no name in the prompt. It does now.
  for (const [label, p] of allPrompts()) {
    assert.match(p, /NOT a computer font/i, `${label}`);
    assert.match(p, /NOT a typeface/i, `${label}`);
  }
});

test('the weight rule never bans thinness — that is the contrast itself', () => {
  // «strong thick/thin contrast» + «never thin, faint, wiry or hairline» is a contradiction,
  // and the model settles it by drawing one flat weight. The thin stroke is what a broad nib
  // MAKES when it turns; only an overall faint or wiry line is forbidden.
  for (const [label, p] of allPrompts()) {
    assert.doesNotMatch(p, /never[^.]*\bthin\b/i, `${label}: thinness is banned again`);
    assert.doesNotMatch(p, /hairline/i, `${label}: hairlines are the fine half of the contrast`);
    assert.match(p, /thick-to-thin|thick\/thin/i, `${label}: no contrast is asked for at all`);
  }
});

test('the heavy-pen rule from 2026-09-14 survives — a wiry stroke has nothing to embroider', () => {
  for (const [label, p] of allPrompts()) {
    assert.match(p, /HEAVY|heavier/i, `${label}: the pen pressure cue is gone`);
  }
});

test('no prompt ever asks for diacritics, and the ban stays enumerated', () => {
  for (const [label, p] of allPrompts()) {
    assert.doesNotMatch(p, /masterful diacritics/i, `${label}: 2026-09-14, 0 of 5 clean`);
    assert.match(p, /NO diacritics at all/i, `${label}: the ban is gone`);
    // The enumerated list is what was measured; a shorter paraphrase was never tested.
    for (const mark of ['harakat', 'fatha', 'damma', 'kasra', 'sukun', 'shadda', 'tanwin']) {
      assert.match(p, new RegExp(`no ${mark}`, 'i'), `${label}: «${mark}» dropped from the ban`);
    }
  }
});

test('limiting ornaments never turns into an instruction about the letters', () => {
  // Owner decision 2026-08-26 (front is as plain as the back) is about the floated motifs.
  // Its old wording — «keep it mostly clean plain letters» — reached the letterforms too, and
  // landed in the same prompt as BASE's «only the letters themselves».
  for (const v of ['front', 'back']) {
    const p = buildSheetPrompt(['ديالى'], v, null);
    assert.match(p, /minimal ornamentation/i, `${v}: the owner's 08-26 limit is gone`);
    assert.doesNotMatch(p, /plain letters/i, `${v}: the ornament limit describes the letters`);
    assert.match(p, /ORNAMENTS only/i, `${v}: nothing scopes the limit`);
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
