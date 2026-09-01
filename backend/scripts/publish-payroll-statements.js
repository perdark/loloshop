#!/usr/bin/env node
'use strict';
/**
 * Publish a month's «حصيلة شهرك وراتبك» statements from a decided JSON file.
 *
 *   node scripts/publish-payroll-statements.js <file.json>            # dry run, writes nothing
 *   node scripts/publish-payroll-statements.js <file.json> --write    # upsert as DRAFTS
 *   node scripts/publish-payroll-statements.js <file.json> --write --publish
 *   node scripts/publish-payroll-statements.js <file.json> --write --publish --notify
 *
 * ⚠️ THIS SCRIPT DOES NOT COMPUTE A SALARY, AND THAT IS DELIBERATE. What a day is worth, how
 * many absences are forgiven, what a late minute costs and which punches were device errors are
 * OWNER DECISIONS that changed between months and will change again. Encoding them here would
 * make next month quietly inherit last month's policy under a command that looks neutral. The
 * arithmetic is decided outside; this script's whole job is to write it down faithfully,
 * idempotently, and to tell the worker.
 *
 * ⚠️ `--publish` IS THE MOMENT A NUMBER BECOMES A PROMISE. Without it rows land as drafts and
 * `GET /payroll/me/statement` refuses to serve them, which is the point: publish only after the
 * figures have been read by a human. `--notify` is separate again, because a push cannot be
 * recalled — see the broadcast landmines in HANDOFF.md.
 *
 * Re-running is safe: the upsert is keyed on (user_id, month_key) and `--notify` skips anyone
 * who already has a `payroll_statement` notification for that month.
 */

const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { query, tx } = require('../lib/db');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const WRITE = args.includes('--write');
const PUBLISH = args.includes('--publish');
const NOTIFY = args.includes('--notify');

if (!file) {
  console.error('usage: publish-payroll-statements.js <file.json> [--write] [--publish] [--notify]');
  process.exit(1);
}

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

async function main() {
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const month = payload.month;
  const rows = payload.statements;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw new Error('bad or missing "month"');
  if (!Array.isArray(rows) || !rows.length) throw new Error('"statements" must be a non-empty array');

  console.log(`\nشهر ${month} — ${rows.length} كشف`);
  console.log('─'.repeat(78));

  for (const r of rows) {
    const u = await query(
      `SELECT id, name, role FROM users WHERE id = $1`, [r.userId]
    );
    if (!u.rows.length) throw new Error(`no such user: ${r.userId}`);
    r._name = u.rows[0].name;
    if (u.rows[0].role !== 'staff') throw new Error(`${r._name} is not staff`);

    // The one arithmetic check worth making here: the line items must reach the net, or a
    // typo in the decided file becomes a wrong number in somebody's hand.
    const derived =
      r.fullShifts * r.dayRate + r.halfShifts * r.halfRate + r.leaveDays * r.dayRate;
    if (derived !== r.gross) {
      throw new Error(`${r._name}: line items total ${fmt(derived)} but gross says ${fmt(r.gross)}`);
    }
    if (r.gross - r.lateDeduction - (r.otherDeduction || 0) !== r.net) {
      throw new Error(`${r._name}: gross − deductions does not equal net`);
    }
    if (r.lateMinutes * r.minuteRate !== r.lateDeduction) {
      throw new Error(`${r._name}: ${r.lateMinutes} min × ${fmt(r.minuteRate)} ≠ ${fmt(r.lateDeduction)}`);
    }

    console.log(
      `${String(r._name).padEnd(12)} ` +
      `${String(r.fullShifts).padStart(2)} كامل · ${r.halfShifts} نص · ${r.leaveDays} إجازة · ${String(r.unpaidDays).padStart(2)} غياب  ` +
      `قبل ${fmt(r.gross).padStart(9)}  تأخير −${fmt(r.lateDeduction).padStart(7)}  ` +
      `آخر −${fmt(r.otherDeduction || 0).padStart(5)}  →  ${fmt(r.net).padStart(9)}`
    );
  }
  console.log('─'.repeat(78));
  console.log(`المجموع ${fmt(rows.reduce((a, r) => a + r.net, 0))}\n`);

  if (!WRITE) {
    console.log('DRY RUN — nothing written. Add --write.\n');
    return;
  }

  await tx(async (client) => {
    for (const r of rows) {
      await client.query(
        `INSERT INTO staff_payroll_statements
           (user_id, month_key, day_rate, half_rate, minute_rate, grace_minutes,
            full_shifts, half_shifts, leave_days, unpaid_days,
            late_days, late_minutes, waived_minutes,
            gross, late_deduction, other_deduction, other_reason_ar, net, note_ar, days,
            published_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,
                 ${PUBLISH ? 'NOW()' : 'NULL'}, $21)
         ON CONFLICT (user_id, month_key) DO UPDATE SET
           day_rate = EXCLUDED.day_rate, half_rate = EXCLUDED.half_rate,
           minute_rate = EXCLUDED.minute_rate, grace_minutes = EXCLUDED.grace_minutes,
           full_shifts = EXCLUDED.full_shifts, half_shifts = EXCLUDED.half_shifts,
           leave_days = EXCLUDED.leave_days, unpaid_days = EXCLUDED.unpaid_days,
           late_days = EXCLUDED.late_days, late_minutes = EXCLUDED.late_minutes,
           waived_minutes = EXCLUDED.waived_minutes,
           gross = EXCLUDED.gross, late_deduction = EXCLUDED.late_deduction,
           other_deduction = EXCLUDED.other_deduction, other_reason_ar = EXCLUDED.other_reason_ar,
           net = EXCLUDED.net, note_ar = EXCLUDED.note_ar, days = EXCLUDED.days,
           published_at = COALESCE(staff_payroll_statements.published_at, EXCLUDED.published_at),
           updated_at = NOW()`,
        [
          r.userId, month, r.dayRate, r.halfRate, r.minuteRate, r.graceMinutes,
          r.fullShifts, r.halfShifts, r.leaveDays, r.unpaidDays,
          r.lateDays, r.lateMinutes, r.waivedMinutes,
          r.gross, r.lateDeduction, r.otherDeduction || 0, r.otherReasonAr || null,
          r.net, r.noteAr || null, JSON.stringify(r.days || []),
          payload.createdBy || null,
        ]
      );
    }
  });
  console.log(`✓ ${rows.length} كشف ${PUBLISH ? 'منشور' : 'مسودة (بلا نشر)'}`);

  if (!NOTIFY) {
    console.log('  (no notification sent — add --notify)\n');
    return;
  }
  if (!PUBLISH) {
    console.log('  ⚠ refusing to notify about drafts — the worker would tap through to nothing.\n');
    return;
  }

  let sent = 0;
  for (const r of rows) {
    const { rowCount } = await query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       SELECT $1, 'payroll_statement', $2, $3, '/staff/me'
        WHERE NOT EXISTS (
          SELECT 1 FROM notifications
           WHERE user_id = $1 AND type = 'payroll_statement' AND title_ar = $2)`,
      [r.userId, payload.notifyTitleAr, (payload.notifyBodyAr || '').replace('{net}', fmt(r.net))]
    );
    if (rowCount) sent += 1;
  }
  console.log(`✓ ${sent} إشعار (${rows.length - sent} موجود من قبل، ما انعاد)\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('✗', err.message); process.exit(1); });
