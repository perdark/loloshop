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
      className={`rounded-xl border border-ink/10 bg-beige ${compact ? "p-3" : "p-4"}`}
    >
      <p className="mb-3 text-sm font-semibold text-ink">تفاصيل السعر</p>
      <ul className="space-y-2 text-sm">
        {lines.map((line) => (
          <li key={line.key} className="flex justify-between gap-2 text-ink/80">
            <span>{line.label}</span>
            <span dir="ltr">{formatIQD(line.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-between border-t border-neutral pt-3 font-bold text-ink">
        <span>المجموع</span>
        <span className="text-orange" dir="ltr">
          {formatIQD(total)}
        </span>
      </div>
    </div>
  );
}
