'use strict';
// Holding an under-full calligraphy sheet (2026-09-15 cost audit).
//
// The measurement this exists for: over 2026-08-01 → 09-12, 283 of 577 sheets carried ONE
// name — 35% of the bill for 14% of the names, at $0.0927 each against $0.0231 on a full
// sheet. Only 25 of those were rerolls; the rest were ordinary generations that found nothing
// to share a sheet with, because the cross-job top-up can only borrow plates that are pending
// at that instant and the shop works one rep at a time.
//
// Pure — no DB, no network.
const test = require('node:test');
const assert = require('node:assert');
const { holdDecision, holdStateFor, FULL_SHEET } = require('../lib/calligraphyBatching');

const NOW = new Date('2026-09-15T12:00:00Z');
const agoMin = (m, over = {}) => ({
  created_at: new Date(NOW.getTime() - m * 60_000).toISOString(),
  variant: 'front', style: null, ...over,
});

test.beforeEach(() => { delete process.env.CALLIG_HOLD_MINUTES; });

test('a lone fresh name waits instead of buying a whole sheet for itself', () => {
  const d = holdDecision([agoMin(0)], { now: NOW });
  assert.equal(d.hold, true);
  assert.equal(d.waitSeconds, 600, 'the default window is ten minutes');
});

test('a full sheet is bought immediately — that is what the waiting was for', () => {
  const full = Array.from({ length: FULL_SHEET }, () => agoMin(0));
  assert.equal(holdDecision(full, { now: NOW }).hold, false);
});

test('the window is measured from the OLDEST name, not the newest', () => {
  // A trickle of arrivals must never push the first student back forever: whoever has waited
  // longest sets the clock for everyone riding with them.
  const batch = [agoMin(9.5), agoMin(0), agoMin(0)];
  const d = holdDecision(batch, { now: NOW });
  assert.equal(d.hold, true);
  assert.ok(d.waitSeconds <= 30, `expected ≤30s left, got ${d.waitSeconds}`);

  const expired = [agoMin(10.1), agoMin(0)];
  assert.equal(holdDecision(expired, { now: NOW }).hold, false, 'the oldest name timed out');
});

test('«ولّدها هسة» always wins', () => {
  assert.equal(holdDecision([agoMin(0)], { force: true, now: NOW }).hold, false);
});

test('CALLIG_HOLD_MINUTES=0 is the kill switch — exactly the old behaviour', () => {
  process.env.CALLIG_HOLD_MINUTES = '0';
  assert.equal(holdDecision([agoMin(0)], { now: NOW }).hold, false);
});

test('a plate with an unreadable timestamp is never made to wait', () => {
  // A missing created_at must fail toward "print it", not toward "hold a real student
  // forever". Any other default turns a data glitch into a silent outage.
  assert.equal(holdDecision([{ created_at: null }], { now: NOW }).hold, false);
  assert.equal(holdDecision([{}], { now: NOW }).hold, false);
});

test('an empty batch is not a hold', () => {
  assert.equal(holdDecision([], { now: NOW }).hold, false);
  assert.equal(holdStateFor([], { now: NOW }).held, false);
});

// ── what the SCREEN says ────────────────────────────────────────────────────────────────
test('the display groups by (variant, style) the way the engine batches', () => {
  // 6 front + 6 back is TWELVE pending plates and TWO under-full sheets. A naive
  // `pending >= 10` would tell the designer «جاري التوليد» while nothing moved for ten
  // minutes — two rules disagreeing about one fact, which is this codebase's favourite bug.
  const split = [
    ...Array.from({ length: 6 }, () => agoMin(0, { variant: 'front' })),
    ...Array.from({ length: 6 }, () => agoMin(0, { variant: 'back' })),
  ];
  assert.equal(split.length, 12);
  assert.equal(holdStateFor(split, { now: NOW }).held, true, 'reported movement that is not happening');
});

test('the job is NOT held when any one group can render right now', () => {
  const mixed = [
    ...Array.from({ length: FULL_SHEET }, () => agoMin(0, { variant: 'front' })),
    agoMin(0, { variant: 'back' }),
  ];
  const st = holdStateFor(mixed, { now: NOW });
  assert.equal(st.held, false, 'a job with a full sheet ready is moving');
});

test('style is part of the sheet identity, not just the variant', () => {
  // One sheet is one prompt and a prompt carries one style clause (migration 083), so ten
  // names in two styles are still two half sheets.
  const styled = [
    ...Array.from({ length: 5 }, () => agoMin(0, { style: 'mad' })),
    ...Array.from({ length: 5 }, () => agoMin(0, { style: null })),
  ];
  assert.equal(holdStateFor(styled, { now: NOW }).held, true);
});

test('the reported wait is the LONGEST of the waiting groups', () => {
  const groups = [
    agoMin(9, { variant: 'front' }),   // ~60s left
    agoMin(1, { variant: 'back' }),    // ~540s left
  ];
  const st = holdStateFor(groups, { now: NOW });
  assert.equal(st.held, true);
  assert.ok(st.waitSeconds >= 500, `expected the longer wait, got ${st.waitSeconds}`);
});
