import { formatIQD } from "@/lib/format";
import type { PriceLine } from "@/lib/pricing";

interface PriceBreakdownProps {
  lines: PriceLine[];
  total: number;
  compact?: boolean;
}

export function PriceBreakdown({
  lines,
  total,
  compact = false,
}: PriceBreakdownProps) {
  return (
    <div
      className={`rounded-2xl border border-line bg-surface ${compact ? "p-4" : "p-5"}`}
    >
      <p className="mb-3 text-sm font-semibold text-ink">تفاصيل السعر</p>
      <ul className="space-y-2.5 text-sm">
        {lines.map((line) => (
          <li key={line.key} className="flex justify-between gap-2 text-ink-soft">
            <span>{line.label}</span>
            <span className="tabular-nums" dir="ltr">
              {formatIQD(line.amount)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3.5 flex items-center justify-between border-t border-orange/15 pt-3.5 font-bold text-ink">
        <span>المجموع</span>
        <span className="text-lg tabular-nums text-orange-ink" dir="ltr">
          {formatIQD(total)}
        </span>
      </div>
    </div>
  );
}
