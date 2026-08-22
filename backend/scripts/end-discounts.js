#!/usr/bin/env node
// End a storefront discount round from the command line (or from CI over SSH).
//
//   node scripts/end-discounts.js                 # REPORT ONLY — reads, writes nothing
//   node scripts/end-discounts.js --restore       # put the prices back, clear the old price
//   node scripts/end-discounts.js --clear-only    # clear the old price, touch NO price
//
//   --scopes=retail        restore ONLY these cells (csv: product,retail,wholesaler)
//   --include-wholesaler   also restore سعر الجملة rows (see the warning below)
//   --keep-promo           leave the promo banner switch alone
//
// WHY THIS EXISTS ALONGSIDE THE /admin PANEL: the panel (components/admin/
// DiscountRestorePanel.tsx) is the normal way to do this and shows the same numbers. This
// script is for the case the panel cannot serve — nobody has an admin session in front of
// them. Both call the SAME lib/discountRestore.js, so they cannot disagree about what a
// restore means.
//
// ⚠️ THE DEFAULT IS A REPORT, ON PURPOSE. Ending a discount is the only catalogue edit that
// RAISES a live price, and the database cannot say which of two rounds was run:
//   A. the prices were LOWERED and compare_at_price kept the old one   → --restore
//   B. the prices never moved, compare_at_price is a strike-through    → --clear-only
// Both look identical (compare_at_price above base_price by the same amount). Read the report
// and decide; there is no safe default between those two.
//
// ⚠️ WHOLESALER ROWS ARE EXCLUDED UNLESS ASKED FOR. سعر الجملة sits below the retail old price
// by the normal margin whether or not a discount ran, so it LOOKS discounted when it is not —
// restoring it would raise what every ممثل pays. --include-wholesaler is the deliberate opt-in.
//
// Every write is logged to discount_restore_log (migration 085) keyed by batch_id, so any run
// is reversible with a single UPDATE. Orders are never touched: their prices are checkout
// snapshots.

require('dotenv').config();
const {
  buildReport,
  readPromo,
  planFrom,
  applyPlan,
  deactivatePromo,
} = require('../lib/discountRestore');
const { pool } = require('../lib/db');

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);

const RESTORE = has('--restore');
const CLEAR_ONLY = has('--clear-only');
const INCLUDE_WHOLESALER = has('--include-wholesaler');
const KEEP_PROMO = has('--keep-promo');

// --scopes=retail  ·  --scopes=product,retail
// Restore ONLY these price cells. Measured on prod 2026-08-22, this is not a nicety: the round
// there discounted the `retail` cell of 51 products by exactly 5,000 each, but FOUR products
// also had a product-level base_price sitting below the compare-at by 20,000 / 15,000 / 10,000
// / 5,000. Those gaps are not the discount — they are the ordinary distance between a
// product-level fallback price and the retail price — and `products.base_price` is what a
// REP-LINKED student pays when the product has no wholesaler row. Restoring them would have
// raised real order prices by up to 20,000 on a round the owner described as "5000".
// So: when the round touched one kind of cell, restore that kind and leave the rest alone.
const SCOPES_ARG = argv.find((a) => a.startsWith('--scopes='));
const SCOPES = SCOPES_ARG
  ? SCOPES_ARG.slice('--scopes='.length).split(',').map((s) => s.trim()).filter(Boolean)
  : null;

// Which price cells this run is allowed to write. --scopes wins outright when given;
// otherwise the default is product-level + retail, with wholesaler behind its own opt-in.
function wanted(scope) {
  if (SCOPES) return SCOPES.includes(scope);
  return scope !== 'wholesaler' || INCLUDE_WHOLESALER;
}

const iqd = (n) => `${Number(n).toLocaleString('en-US')} IQD`;
const pad = (s, n) => String(s).padEnd(n);

async function main() {
  if (RESTORE && CLEAR_ONLY) {
    console.error('Pick one of --restore or --clear-only, not both.');
    process.exit(1);
  }

  const report = await buildReport();
  const promo = await readPromo();

  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  DISCOUNT ROUND — CURRENT STATE');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`  promo banner : ${promo.active ? 'ON' : 'OFF'}${promo.live ? ' (live — customers see the badges)' : ' (not live)'}`);
  console.log(`  products with an old price : ${report.summary.products}`);
  console.log(`  price cells actually discounted : ${report.summary.discounted_cells}`);
  console.log(
    `  same gap on every cell : ${
      report.summary.uniform_delta != null ? iqd(report.summary.uniform_delta) : 'no — mixed round'
    }`
  );
  console.log('');

  if (!report.products.length) {
    console.log('  Nothing carries a «السعر قبل الخصم». No discount to end.');
    console.log('');
    if (!KEEP_PROMO && promo.active) {
      const off = await deactivatePromo();
      console.log(`  Promo banner switched OFF (was ${off.changed ? 'on' : 'off'}).`);
    }
    return;
  }

  for (const p of report.products) {
    console.log(`  ${p.name_ar}${p.active ? '' : '   [غير مفعّل]'}`);
    for (const c of p.cells) {
      const line = c.discounted
        ? `${pad(iqd(c.current_price), 16)} -> ${pad(iqd(c.compare_at_price), 16)} (+${iqd(c.delta)})`
        : `${pad(iqd(c.current_price), 16)}    (no discount on this price)`;
      const mark = c.discounted && wanted(c.scope) ? '*' : ' ';
      console.log(`   ${mark} ${pad(c.scope, 12)} ${line}`);
    }
    console.log('');
  }

  if (!RESTORE && !CLEAR_ONLY) {
    console.log('  REPORT ONLY — nothing was written.');
    console.log('  Lines marked * are the ones --restore would put back.');
    console.log('');
    console.log('  Next:  node scripts/end-discounts.js --restore      (prices were lowered)');
    console.log('         node scripts/end-discounts.js --clear-only   (prices never moved)');
    console.log('');
    return;
  }

  // Build the selection the same way the panel does: product-level + retail, wholesaler only
  // when explicitly asked for. planFrom drops anything not genuinely discounted.
  const selection = report.products.map((p) => ({
    id: p.id,
    expected_compare_at_price: p.compare_at_price,
    scopes: CLEAR_ONLY
      ? []
      : p.cells.filter((c) => c.discounted && wanted(c.scope)).map((c) => c.scope),
  }));

  const planned = planFrom(selection, report);
  if (!planned.ok) {
    console.error(`  REFUSED: ${planned.error} (${planned.code})`);
    process.exit(1);
  }

  const result = await applyPlan(planned.plan, {
    adminId: null,
    note: `end-discounts.js ${CLEAR_ONLY ? '--clear-only' : '--restore'}`,
  });

  console.log('════════════════════════════════════════════════════════════════');
  console.log('  APPLIED');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`  batch_id : ${result.batch_id}`);
  console.log(`  products cleared of «السعر قبل الخصم» : ${planned.plan.length}`);
  console.log(`  prices restored : ${result.written.length}`);
  for (const w of result.written) {
    console.log(`    ${pad(w.scope, 12)} ${iqd(w.from)} -> ${iqd(w.to)}`);
  }
  console.log('');

  // A discounted cell we did NOT write still has its old price cleared from the product a
  // moment ago, so this log line is the only human-readable record left of it (the machine
  // copy is discount_restore_log.old_compare_at_price). Print it, always.
  const skipped = [];
  for (const p of report.products) {
    for (const c of p.cells) {
      if (c.discounted && !wanted(c.scope)) {
        skipped.push(`    ${pad(p.name_ar, 28)} ${pad(c.scope, 12)} left at ${pad(iqd(c.current_price), 16)} (old price was ${iqd(c.compare_at_price)})`);
      }
    }
  }
  if (skipped.length) {
    console.log(`  DELIBERATELY NOT RESTORED — ${skipped.length} discounted cell(s) outside this run's scope:`);
    skipped.forEach((l) => console.log(l));
    console.log('');
  }

  if (!KEEP_PROMO) {
    const off = await deactivatePromo();
    console.log(`  Promo banner switched OFF (was ${off.changed ? 'on' : 'already off'}).`);
  }

  // Read back, so the log proves the end state rather than asserting it.
  const after = await buildReport();
  console.log(`  Re-read: ${after.summary.products} products still carry an old price.`);
  console.log('');
  // Two statements, because a price lives in two tables. Printing only the products one — as
  // this did first — silently fails to undo a --scopes=retail run, which is the common case.
  console.log('  UNDO: every old value is in discount_restore_log for this batch_id.');
  console.log(`    -- product-level prices`);
  console.log(`    UPDATE products p SET base_price = l.old_price`);
  console.log(`      FROM discount_restore_log l`);
  console.log(`     WHERE l.batch_id = '${result.batch_id}'`);
  console.log(`       AND l.scope = 'product' AND p.id = l.product_id;`);
  console.log(`    -- per-role prices (retail / wholesaler)`);
  console.log(`    UPDATE product_price_roles r SET base_price = l.old_price`);
  console.log(`      FROM discount_restore_log l`);
  console.log(`     WHERE l.batch_id = '${result.batch_id}'`);
  console.log(`       AND l.scope <> 'product' AND r.product_id = l.product_id`);
  console.log(`       AND r.role::text = l.scope;`);
  console.log(`    -- and the old price itself, if you want the badges back`);
  console.log(`    UPDATE products p SET compare_at_price = l.old_compare_at_price`);
  console.log(`      FROM discount_restore_log l`);
  console.log(`     WHERE l.batch_id = '${result.batch_id}' AND p.id = l.product_id;`);
  console.log('');
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error('FAILED:', e.message);
    console.error(e.stack);
    await pool.end().catch(() => {});
    process.exit(1);
  });
