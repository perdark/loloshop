'use strict';
// «رجّع خطوة» FROM التجهيز — which station is actually one step back?
//
// WHY THIS FILE EXISTS. `resolveRevertTarget` had the الكوي rule inside its `plain` branch
// (no design AND no embroidery), so an EMBROIDERED piece at التجهيز fell through to
// REVERT_MAP.preparing = 'embroidery' and jumped over الكوي entirely — landing at a station it
// had already finished instead of the one it had just come from.
//
// It was not theoretical. Measured on prod 2026-09-01: 7 orders reverted preparing→embroidery
// while carrying needs_pressing = TRUE, and محمد عادل (المكوجي) hit it live at 18:23 on وشاح
// مثلث صغير `115150c0`. `staff_activity_log` shows him undoing it by hand 55 seconds later:
//
//   18:23:12  revert   preparing  → embroidery   (what he pressed)
//   18:24:07  advance  embroidery → pressing     (what he had to do to get back)
//   18:24:37  advance  pressing   → preparing
//
// THE INVARIANT: `needs_pressing` decides what sits before التجهيز, and it decides it the same
// way in both directions. `nextStageFor` has always keyed the forward edge on that column
// (embroidery → needs_pressing ? pressing : preparing); the backward edge now asks the same
// question. If these two ever disagree again, a piece can be advanced into a station it can
// never be reverted into, which is exactly the shape of the bug above.
//
// ⚠️ A plain piece at التجهيز with needs_pressing = FALSE reverts to NOWHERE, and that is not
// the same statement as «it has no history». It is a cap (caps skip الكوي by design), or one of
// the 293 legacy rows opened directly at التجهيز before 2026-07-15 — for those, التجهيز IS the
// first stage and there is genuinely nothing behind it.
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRevertTarget, nextStageFor } = require('../controllers/productionController');

const order = (o) => ({
  design_id: null, has_embroidery: false, needs_pressing: false, ...o,
});

test('1. an EMBROIDERED pressed piece at التجهيز reverts to الكوي, not التطريز', () => {
  // The regression. A وشاح: design-less full-set sash rows carry has_embroidery, and rep sashes
  // carry a design_id — both must land on الكوي.
  assert.equal(
    resolveRevertTarget(order({ status: 'preparing', has_embroidery: true, needs_pressing: true })),
    'pressing'
  );
  assert.equal(
    resolveRevertTarget(order({ status: 'preparing', design_id: 'd1', needs_pressing: true })),
    'pressing'
  );
});

test('2. a PLAIN pressed piece at التجهيز still reverts to الكوي (unchanged)', () => {
  assert.equal(
    resolveRevertTarget(order({ status: 'preparing', needs_pressing: true })),
    'pressing'
  );
});

test('3. a piece that SKIPS الكوي reverts to التطريز when it was embroidered', () => {
  // A cap: needs_pressing = false, so التطريز really is the station before التجهيز.
  assert.equal(
    resolveRevertTarget(order({ status: 'preparing', has_embroidery: true, needs_pressing: false })),
    'embroidery'
  );
});

test('4. a plain piece whose FIRST stage is التجهيز reverts to nothing', () => {
  // Plain cap, and the 293 pre-2026-07-15 legacy rows. Offering «رجّع خطوة» here would invent
  // a stage the piece never visited and blame a worker for a routing change.
  assert.equal(
    resolveRevertTarget(order({ status: 'preparing', needs_pressing: false })),
    null
  );
});

test('5. a plain piece at الكوي is at its first stage — nothing behind it', () => {
  assert.equal(resolveRevertTarget(order({ status: 'pressing', needs_pressing: true })), null);
});

test('6. an embroidered piece at الكوي reverts to التطريز', () => {
  assert.equal(
    resolveRevertTarget(order({ status: 'pressing', has_embroidery: true, needs_pressing: true })),
    'embroidery'
  );
});

test('7. forward and backward agree — advancing into a stage means you can revert out of it', () => {
  // The contract that keeps the two edges from drifting apart again. Only pieces that actually
  // VISIT التطريز are in scope — a plain piece is never at 'embroidery' to begin with, which is
  // why `resolveRevertTarget` answers null for it there and must keep doing so.
  for (const shape of [
    { has_embroidery: true, design_id: null },
    { has_embroidery: false, design_id: 'd1' },
    { has_embroidery: true, design_id: 'd1' },
  ]) {
    for (const needs_pressing of [true, false]) {
      const at = order({ status: 'embroidery', needs_pressing, ...shape });
      const forward = nextStageFor(at);
      assert.equal(forward, needs_pressing ? 'pressing' : 'preparing');
      // Leaving التطريز lands on الكوي or التجهيز; one step back from wherever it landed is
      // التطريز, the station it just left. Then the SECOND step back down the chain is what the
      // bug broke: from التجهيز it must reach الكوي before it reaches التطريز again.
      assert.equal(
        resolveRevertTarget(order({ ...at, status: forward })),
        'embroidery',
        `${forward} must revert to the station it came from — ${JSON.stringify({ ...shape, needs_pressing })}`
      );
      if (needs_pressing) {
        assert.equal(
          resolveRevertTarget(order({ ...at, status: 'preparing' })),
          'pressing',
          `التجهيز must step back through الكوي — ${JSON.stringify({ ...shape, needs_pressing })}`
        );
      }
    }
  }
});

test('8. RED/GREEN — the old rule is what produced the 7 prod rows', () => {
  // The pre-fix implementation, kept verbatim so the regression cannot come back as a "tidy-up"
  // without this failing. It answered التطريز for the exact order shape محمد عادل was holding.
  const REVERT_MAP_preparing = 'embroidery';
  function oldResolve(o) {
    const plain = !o.design_id && !o.has_embroidery;
    if (plain) {
      if (o.status === 'pressing') return null;
      if (o.status === 'preparing') return o.needs_pressing ? 'pressing' : null;
    }
    return o.status === 'preparing' ? REVERT_MAP_preparing : null;
  }
  const sash = order({ status: 'preparing', has_embroidery: true, needs_pressing: true });
  assert.equal(oldResolve(sash), 'embroidery', 'old rule jumped over الكوي');
  assert.equal(resolveRevertTarget(sash), 'pressing', 'new rule lands on الكوي');
});
