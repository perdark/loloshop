#!/usr/bin/env node
// backend/scripts/calligraphy-reroll-audit.js
//
// «أي خصائص اللوحة تتنبأ بأن تحتاج إعادة توليد مدفوعة؟»
//
// Every reroll buys a fresh image, so a plate that needs one costs the shop twice. This
// report ranks the plate's own properties — name length, تشكيل, word count, variant, style —
// by how much the reroll rate actually moves across them, so the next prompt or batching
// change is aimed at the thing that moves it instead of at a hunch.
//
// ⚠️ READ-ONLY, AND THAT IS ENFORCED TWICE: the only statement is a SELECT, and it runs
// inside `BEGIN READ ONLY` so Postgres itself refuses a write on this connection. There is
// no INSERT/UPDATE/DELETE/ALTER anywhere in this file or in `lib/calligraphyRerollAudit.js`,
// which is pure and touches neither the database nor the disk.
//
//   node scripts/calligraphy-reroll-audit.js [--min-sample=N] [--json]
//
// `--min-sample` (default 30) is the smallest slice worth believing: anything thinner is
// still PRINTED — a rare style nobody noticed is a finding — but it is marked «عيّنة ضعيفة»
// and left out of the spread, because one plate that happened to reroll is a 100% bucket
// and would otherwise lead the whole report.

const { pool } = require('../lib/db');
const { analyze } = require('../lib/calligraphyRerollAudit');

const DEFAULT_MIN_SAMPLE = 30;
const USAGE = 'Usage: node scripts/calligraphy-reroll-audit.js [--min-sample=N] [--json]';

function parseArgs(argv) {
  const args = { json: false, minSample: DEFAULT_MIN_SAMPLE, help: false };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--min-sample=')) {
      const value = Number(arg.slice('--min-sample='.length));
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('--min-sample must be a positive number');
      }
      args.minSample = Math.ceil(value);
    } else throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
  }
  return args;
}

// One SELECT, inside a read-only transaction. `style` is nullable (the shop default) and is
// deliberately NOT coalesced here — the library labels it, so the JSON and the text report
// cannot disagree about what a null style is called.
async function readPlates() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(`
      SELECT render_text, reroll_count, variant, style, status
        FROM calligraphy_plates
       ORDER BY created_at
    `);
    await client.query('ROLLBACK');
    return rows;
  } finally {
    // The transaction is read-only, so a rollback here can only be tidying up after a
    // failed SELECT; never let that mask the original error.
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    client.release();
  }
}

const pct = (rate) => `${(rate * 100).toFixed(1)}%`;

function signedPct(delta) {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  return `${sign}${(Math.abs(delta) * 100).toFixed(1)}%`;
}

function printReport(report, minSample) {
  const { total, rerolled, overallRate, dimensions } = report;

  console.log('');
  console.log('تدقيق إعادة التوليد المدفوعة — قراءة فقط، ما ينكتب شي');
  console.log('='.repeat(64));
  console.log(`اللوحات: ${total}   احتاجت إعادة توليد مرة على الأقل: ${rerolled}  (${pct(overallRate)})`);
  console.log(`أصغر شريحة معتبرة: n ≥ ${minSample}`);

  if (total === 0) {
    console.log('\nما في ولا لوحة — ما في شي ينقاس.');
    return;
  }

  console.log('');
  console.log('الأبعاد مرتّبة بالأثر: الفرق بين أعلى وأوطأ نسبة داخل البُعد (الشرائح الضعيفة مستثناة).');
  console.log('«Δ» = فرق الشريحة عن النسبة العامة.');
  console.log('');

  for (const dim of dimensions) {
    const flat = dim.spread === 0 ? '   (ما يفرّق)' : '';
    console.log(`▸ ${dim.dimension} — الأثر ${pct(dim.spread)}${flat}`);
    for (const b of dim.buckets) {
      const label = `${b.bucket}`.padEnd(26, ' ');
      const weak = b.underpowered ? `  ⚠ عيّنة ضعيفة (n < ${minSample}) — مو داخلة بالحساب` : '';
      console.log(
        `    ${label} ${pct(b.rate).padStart(6)}   ` +
        `${String(b.rerolled).padStart(4)}/${String(b.n).padEnd(5)} ` +
        `Δ ${signedPct(b.rate - overallRate).padStart(7)}${weak}`
      );
    }
    // `status` is in the report because it is in the data, but it is the one dimension
    // whose effect is MECHANICAL: a plate that failed to render never reached a human who
    // could press «إعادة التوليد», so its 0% is an artefact of never having had the chance —
    // not evidence that failing prevents rerolls. Say so where it is printed.
    if (dim.dimension === 'status') {
      console.log('    ⓘ «failed» ما وصلت لأحد يضغط إعادة التوليد — صفرها ميكانيكي، مو اكتشاف.');
    }
    console.log('');
  }

  // The headline. Printed from the same numbers above so it can never disagree with them.
  const top = dimensions[0];
  console.log('='.repeat(64));
  if (!top || top.spread === 0) {
    console.log('الخلاصة: ما في خاصية من هذي تتنبأ بإعادة التوليد — كل الفروق داخل الضجيج.');
    console.log('الخطوة الجاية: زيد خصائص للقياس، مو تغيّر البرومبت على أساس هذا التقرير.');
    return;
  }
  const usable = top.buckets.filter((b) => !b.underpowered);
  const worst = usable.reduce((a, b) => (b.rate > a.rate ? b : a));
  const best = usable.reduce((a, b) => (b.rate < a.rate ? b : a));
  console.log(`الخلاصة: أقوى ما يتنبأ بإعادة التوليد هو «${top.dimension}».`);
  console.log(`  الأسوأ: ${worst.bucket} — ${pct(worst.rate)} (${worst.rerolled}/${worst.n})`);
  console.log(`  الأفضل: ${best.bucket} — ${pct(best.rate)} (${best.rerolled}/${best.n})`);
  console.log(`  الفرق ${pct(top.spread)} مقابل نسبة عامة ${pct(overallRate)}.`);
  console.log('⚠️ هذا ارتباط، مو سبب: الأبعاد متداخلة (الاسم الطويل غالباً أكثر كلمات).');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return; }

  const rows = await readPlates();
  const report = analyze(rows, { minSample: args.minSample });

  if (args.json) {
    console.log(JSON.stringify({ minSample: args.minSample, ...report }, null, 2));
  } else {
    printReport(report, args.minSample);
  }
}

main()
  .then(async () => { await pool.end(); })
  .catch(async (err) => {
    console.error('✗', err.message);
    try { await pool.end(); } catch { /* nothing to close */ }
    process.exit(1);
  });
