// ───────────────────────────────────────────────────────────────────────────
// <Count> — a number that cannot be rendered without saying what it counts.
//
// Spec: docs/superpowers/specs/2026-07-21-counts-units-design.md
//
// The bug this prevents: an `orders` row is one PIECE, but a student's order is a
// BUNDLE of pieces. Both were rendered under the bare word «طلب», so the same shop
// read as 1727 «طلب» on the TV and 578 «طلب» on /admin. `unit` is a REQUIRED prop —
// TypeScript rejects a unitless count, so a new screen physically cannot invent a
// fourth meaning for the word.
//
//   قطعة   piece   = one order row      → production, stage funnels, workload
//   طلب    order   = one checkout_group → admin totals, money, rank ladder
//   طالب   student = one person         → people counts
// ───────────────────────────────────────────────────────────────────────────

export type CountUnit = "piece" | "order" | "student";

/** Singular / dual / plural. Arabic needs all three or the number reads wrong. */
const FORMS: Record<CountUnit, { one: string; two: string; few: string }> = {
  piece: { one: "قطعة", two: "قطعتان", few: "قطعة" },
  order: { one: "طلب", two: "طلبان", few: "طلب" },
  student: { one: "طالب", two: "طالبان", few: "طالب" },
};

/** Arabic-Indic digits with thousands separators — matches the rest of the app. */
export function formatCount(n: number): string {
  return new Intl.NumberFormat("ar-IQ").format(n);
}

export function unitLabel(n: number, unit: CountUnit): string {
  const f = FORMS[unit];
  if (n === 1) return f.one;
  if (n === 2) return f.two;
  return f.few;
}

interface CountProps {
  value: number;
  /** Required on purpose — see the header comment. */
  unit: CountUnit;
  /** Hide the unit noun when a column header already states it (tables). */
  bare?: boolean;
  className?: string;
  /** Style just the unit noun, e.g. smaller/dimmer than the digits. */
  unitClassName?: string;
}

export function Count({ value, unit, bare, className, unitClassName }: CountProps) {
  const n = Number.isFinite(value) ? value : 0;
  if (bare) return <span className={className}>{formatCount(n)}</span>;
  return (
    <span className={className}>
      {formatCount(n)}{" "}
      <span className={unitClassName ?? "text-[0.8em] font-medium opacity-70"}>
        {unitLabel(n, unit)}
      </span>
    </span>
  );
}
