'use strict';

/**
 * ⚠️ A SHEET COSTS THE SAME WHETHER IT CARRIES ONE NAME OR TEN — SO WAIT FOR TEN.
 *
 * Measured on the 2026-09-12 prod restore, over 2026-08-01 → 09-12:
 *
 *   sheet fullness │ sheets │ names │    cost │ per name
 *   ───────────────┼────────┼───────┼─────────┼─────────
 *   7–10 names     │    126 │ 1,219 │  $28.11 │  $0.0231
 *   4–6            │     60 │   282 │   $7.48 │  $0.0265
 *   2–3            │    108 │   244 │  $12.42 │  $0.0509
 *   ONE name       │    283 │   283 │  $26.22 │  $0.0927
 *
 * **Half of every sheet printed carried a single name**, and those 283 names were 35% of the
 * bill for 14% of the output — four times the full-sheet rate. In September it was getting
 * worse, not better: 2.6 names per sheet against 6.9 in July.
 *
 * It was never the rerolls (only 25 of the 283 were regenerations). The cause is structural:
 * the 2026-08-18 cross-job top-up can only borrow plates that are ALREADY PENDING at the
 * instant someone presses «معالجة», and the shop works one rep at a time, so the pool it
 * borrows from is almost always empty. There is nothing wrong with the top-up — there was
 * simply never a queue for it to draw on.
 *
 * This module is that queue: an under-full sheet is HELD instead of bought, and rendered when
 * either enough names have gathered or the oldest one has waited long enough. Nothing is
 * cancelled and nothing is lost — a held plate stays `pending`, which is the one status the
 * whole engine already treats as "someone will pick this up" (the budget ceiling and the
 * 2026-08-28 outage fix both rely on exactly that).
 *
 * ⚠️ THE DEADLINE IS MEASURED FROM THE OLDEST PLATE ON THE SHEET, NOT FROM NOW. Measuring
 * from the latest arrival would let a trickle of new names push an old one back forever — the
 * student whose name arrived first would be the last to be printed. Whoever has waited
 * longest sets the clock for everyone riding with them.
 *
 * ⚠️ AND IT MUST ALWAYS BE POSSIBLE TO SKIP. A designer standing at the machine needs the
 * plate now, and a rule that cannot be overridden turns into a reason to stop using the
 * feature. `force` is that door (the workbench's «ولّدها هسة»), and `CALLIG_HOLD_MINUTES=0`
 * is the shop-wide kill switch if this ever misbehaves — it restores the old
 * buy-immediately behaviour exactly, with no deploy.
 */

/**
 * A sheet holds FIVE bands (was ten until 2026-09-23). Below this it is worth waiting for company.
 *
 * ⚠️ THIS IS THE ONE SHEET SIZE — calligraphyEngine.js imports it as BATCH. Owner report
 * 2026-09-23: «ممثل plates come out as plain text, retail is fine». Measured on the prod
 * restore: 94% of ممثل plates came off 7–10-name sheets, where a 2K 9:16 canvas gives each band
 * ~200px — too small for the model to draw real Thuluth, so it draws a typeface. Retail/typed
 * jobs mostly ride 1–6-name sheets. Five bands ≈ 410px each, ~$0.02/name instead of ~$0.01.
 */
const FULL_SHEET = 5;

/** How long the oldest name on a sheet may be made to wait. 0 disables holding entirely. */
function holdMinutes() {
  const raw = Number(process.env.CALLIG_HOLD_MINUTES);
  return Number.isFinite(raw) && raw >= 0 ? raw : 10;
}

/**
 * Should this sheet wait for more names?
 *
 * @param {object[]} sheetBatch  the plates that would ride this sheet (job's own + hitchhikers)
 * @param {object}   opts
 * @param {boolean}  opts.force  the caller pressed «ولّدها هسة» — never hold
 * @param {Date}     opts.now    injectable clock (tests)
 * @returns {{hold: boolean, waitSeconds: number, readyAt: Date|null, oldestAgeSeconds: number}}
 */
function holdDecision(sheetBatch, { force = false, now = new Date() } = {}) {
  const none = { hold: false, waitSeconds: 0, readyAt: null, oldestAgeSeconds: 0 };
  if (!Array.isArray(sheetBatch) || sheetBatch.length === 0) return none;

  const minutes = holdMinutes();
  // A full sheet is the thing we were waiting for. Buy it.
  if (force || minutes === 0 || sheetBatch.length >= FULL_SHEET) return none;

  // The oldest plate owns the clock — see the header.
  const oldest = sheetBatch.reduce((acc, p) => {
    const t = new Date(p.created_at).getTime();
    return Number.isFinite(t) && t < acc ? t : acc;
  }, Number.POSITIVE_INFINITY);
  // A plate with no readable created_at is treated as "waited forever" rather than "just
  // arrived": a missing timestamp must never be a reason to make a real student wait.
  if (!Number.isFinite(oldest)) return none;

  const deadline = oldest + minutes * 60_000;
  const waitMs = deadline - now.getTime();
  const oldestAgeSeconds = Math.max(0, Math.round((now.getTime() - oldest) / 1000));
  if (waitMs <= 0) return { ...none, oldestAgeSeconds };

  return {
    hold: true,
    waitSeconds: Math.ceil(waitMs / 1000),
    readyAt: new Date(deadline),
    oldestAgeSeconds,
  };
}

/**
 * What a SCREEN should say about a job's pending plates.
 *
 * ⚠️ It groups the way the engine batches — by (variant, style) — and it must keep doing so.
 * One sheet is one prompt, so a job holding 6 فرونت and 6 باك is two under-full sheets, not
 * one full one; a naive `pending >= 10` would tell the designer «جاري التوليد» while nothing
 * moved for ten minutes. Two rules that disagree about the same fact is this codebase's most
 * repeated bug (see the «grant computed from the role, refusal computed from the row»
 * landmine), so the display asks the SAME `holdDecision` the engine does, once per group.
 *
 * `held` is true only when EVERY group is waiting — if any one of them can render now, the
 * job is moving and the screen should say so.
 */
function holdStateFor(pendingPlates, { now = new Date() } = {}) {
  const idle = { held: false, waitSeconds: 0, heldCount: 0 };
  if (!Array.isArray(pendingPlates) || pendingPlates.length === 0) return idle;

  const groups = new Map();
  for (const p of pendingPlates) {
    const key = `${p.variant}|${p.style || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  let waitSeconds = 0;
  for (const plates of groups.values()) {
    const d = holdDecision(plates, { now });
    if (!d.hold) return idle;              // something can render right now
    waitSeconds = Math.max(waitSeconds, d.waitSeconds);
  }
  return { held: true, waitSeconds, heldCount: pendingPlates.length };
}

module.exports = { holdDecision, holdStateFor, holdMinutes, FULL_SHEET };
