// Tests for the payout card's money — bugs 2, 3 and 4 of the money audit (2026-08-14).
//
// WHY THESE ASSERTIONS LOOK LIKE THIS. Every defect here had the same shape as bug 11 on
// the admin dashboard: a figure computed over one population, printed under a label
// describing another. «المبلغ المقترح» said "transfer this now" while computing "everything
// this person has ever earned" — a number that is correct exactly once, on the first
// payout, and overpays on every one after it.
//
// So the assertions are IDENTITIES and INVARIANTS, not figures. A fixed number would go
// stale the first time somebody earns a dinar; an identity keeps holding.
//
// The DB tests run read-only against the dev DB (no INSERT/UPDATE/DELETE anywhere here).
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  accruedAmount,
  netDue,
  suggestedTransfer,
  mergeRecipients,
} = require('../lib/payoutMath');
const { listRecipients } = require('../controllers/payoutController');

// ── Bug 2: the suggestion must subtract what was already transferred ────────

test('the suggestion drops by exactly what was already paid', () => {
  const earned = accruedAmount({ base: 500000, bonuses: 50000, deductions: 0 });
  assert.equal(earned, 550000);
  assert.equal(suggestedTransfer(netDue(earned, 0)), 550000);
  assert.equal(suggestedTransfer(netDue(earned, 200000)), 350000);
});

test('THE BUG: paying in full must leave nothing suggested', () => {
  // This is bug 2 stated as an assertion. Before the fix «المبلغ المقترح» still read
  // 550,000 after a 550,000 transfer was recorded, so the second press of the button
  // paid the same salary twice with nothing in the UI to say so.
  const earned = accruedAmount({ base: 500000, bonuses: 50000, deductions: 0 });
  assert.equal(suggestedTransfer(netDue(earned, earned)), 0);
});

test('a part payment leaves exactly the remainder, never the original', () => {
  const earned = accruedAmount({ production: 1008550, bonuses: 0, deductions: 0 });
  const paid = 1000000;
  assert.equal(netDue(earned, paid), 8550);
  assert.notEqual(suggestedTransfer(netDue(earned, paid)), earned);
});

// ── Bug 4: the suggestion must never be an amount the API would refuse ──────

test('deductions beyond the salary suggest nothing, not a negative transfer', () => {
  // Dev repro: مضر محمد, base 250,000 against 1,025,000 of deductions, rendered as
  // «المبلغ المقترح −٧٧٥٬٠٠٠» — an amount recordManualPayout rejects (amount <= 0).
  const earned = accruedAmount({ base: 250000, bonuses: 0, deductions: 1025000 });
  assert.equal(earned, -775000);
  assert.equal(suggestedTransfer(netDue(earned, 0)), 0);
});

test('over-payment never suggests clawing money back', () => {
  assert.equal(suggestedTransfer(netDue(100000, 250000)), 0);
});

test('every suggestion is an amount recordManualPayout would accept', () => {
  // recordManualPayout:336 rejects `amount <= 0` and non-integers. A suggestion the
  // API refuses is a dead-end button, so the two must agree by construction.
  const cases = [
    { base: 500000, bonuses: 0, deductions: 0, paid: 0 },
    { base: 250000, bonuses: 0, deductions: 1025000, paid: 0 },
    { production: 98800, bonuses: 5000, deductions: 200000, paid: 50000 },
    { base: 0, bonuses: 0, deductions: 0, paid: 0 },
  ];
  for (const c of cases) {
    const s = suggestedTransfer(netDue(accruedAmount(c), c.paid));
    assert.ok(Number.isSafeInteger(s), `${JSON.stringify(c)} produced a non-integer`);
    assert.ok(s >= 0, `${JSON.stringify(c)} produced a negative suggestion`);
  }
});

test('BIGINT columns arrive as strings and must not concatenate', () => {
  // pg returns BIGINT as a string. `'500000' + '50000'` is '50000050000', which would
  // read as a plausible-looking salary of fifty billion dinars.
  const earned = accruedAmount({ base: '500000', bonuses: '50000', deductions: '0' });
  assert.equal(earned, 550000);
  assert.equal(suggestedTransfer(netDue(earned, '550000')), 0);
});

// ── Bug 3: one person, one row ─────────────────────────────────────────────

test('someone on both rosters is listed once, on the workshop basis', () => {
  // ابو عبدو holds role=staff AND sits on workshop_workers (payoutController.js:96-100).
  // He was offered twice, with two different amounts, and nothing said which was real.
  const staff = [{ user_id: 'u1', name: 'ابو عبدو', recipient_kind: 'staff', suggested_amount: 0 }];
  const workshop = [{ user_id: 'u1', name: 'ابو عبدو', recipient_kind: 'workshop', suggested_amount: 354500 }];
  const merged = mergeRecipients(staff, workshop);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].recipient_kind, 'workshop', 'active workshop pay is production-based');
  assert.equal(merged[0].suggested_amount, 354500);
});

test('an inactive workshop member keeps his staff row instead of vanishing', () => {
  // workshopRecipients filters `w.active = TRUE`. Dropping every staff user who appears
  // anywhere on the roster would make a retired member unpayable — worse than the duplicate.
  const staff = [{ user_id: 'u1', name: 'ابو عبدو', recipient_kind: 'staff', suggested_amount: 0 }];
  const merged = mergeRecipients(staff, []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].recipient_kind, 'staff');
});

test('unrelated people are never merged', () => {
  const staff = [{ user_id: 'u1', recipient_kind: 'staff', suggested_amount: 1 }];
  const workshop = [{ user_id: 'u2', recipient_kind: 'workshop', suggested_amount: 2 }];
  assert.equal(mergeRecipients(staff, workshop).length, 2);
});

// ── Against the real dev DB (read-only) ────────────────────────────────────

test('no human is offered a payout twice', async () => {
  const recipients = await listRecipients();
  const seen = new Map();
  for (const r of recipients) {
    assert.ok(
      !seen.has(r.user_id),
      `${r.name} is listed twice (${seen.get(r.user_id)} and ${r.recipient_kind})`
    );
    seen.set(r.user_id, r.recipient_kind);
  }
});

test('every recipient reconciles: استُحق − حُوِّل = المتبقي', async () => {
  const recipients = await listRecipients();
  for (const r of recipients) {
    assert.equal(
      Number(r.net_due),
      Number(r.accrued_amount) - Number(r.paid_total),
      `${r.name}'s breakdown does not tie out`
    );
  }
});

test('no live recipient is offered a negative or fractional transfer', async () => {
  const recipients = await listRecipients();
  for (const r of recipients) {
    assert.ok(
      Number.isSafeInteger(r.suggested_amount) && r.suggested_amount >= 0,
      `${r.name} is offered ${r.suggested_amount}`
    );
  }
});

test('nobody is suggested more than they are still owed', async () => {
  const recipients = await listRecipients();
  for (const r of recipients) {
    assert.ok(
      r.suggested_amount <= Math.max(0, Number(r.net_due)),
      `${r.name} is offered more than remains owed`
    );
  }
});
