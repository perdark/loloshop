import { formatIQD } from "@/lib/format";
import type { OrderBreakdownLine } from "@/lib/types";

interface OrderBreakdownCardProps {
  lines: OrderBreakdownLine[];
  total: number;
  title?: string;
}

export function OrderBreakdownCard({
  lines,
  total,
  title = "تفاصيل السعر (من الخادم)",
}: OrderBreakdownCardProps) {
  return (
    <div className="rounded-xl border border-orange/30 bg-orange/5 p-4">
      <p className="mb-3 text-sm font-semibold text-ink">{title}</p>
      <ul className="space-y-2 text-sm">
        {lines.map((line, i) => (
          <li key={`${line.label}-${i}`} className="flex justify-between gap-2">
            <span className="text-ink/80">{line.label}</span>
            <span dir="ltr">{formatIQD(line.price)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-between border-t border-orange/20 pt-3 font-bold">
        <span>المجموع</span>
        <span className="text-orange" dir="ltr">
          {formatIQD(total)}
        </span>
      </div>
      <p className="mt-2 text-xs text-ink/50">الدفع نقداً عند الاستلام</p>
    </div>
  );
}
