import type { ReactNode } from "react";
import type { MoneyCalculation } from "@/lib/admin";
import { formatIQD } from "@/lib/format";

type OrderSource = "retail" | "wholesaler";

export function CalculationDetails({
  summary,
  children,
  className = "",
}: {
  summary: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`group rounded-xl border border-line bg-surface-sink ${className}`}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold text-ink marker:content-none [&::-webkit-details-marker]:hidden">
        <span>{summary}</span>
        <span
          aria-hidden
          className="text-base text-orange-ink transition-transform group-open:rotate-45"
        >
          +
        </span>
      </summary>
      <div className="border-t border-line px-3 py-3 text-xs leading-relaxed text-ink-soft">
        {children}
      </div>
    </details>
  );
}

function Equation({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg bg-ink/[0.04] px-2.5 py-2 tabular-nums text-ink" dir="rtl">
      {children}
    </p>
  );
}

export function OrderMoneyExplanation({
  price,
  cost,
  profit,
  calculation,
  source,
  className = "",
}: {
  price: number;
  cost: number | null | undefined;
  profit: number | null | undefined;
  calculation?: MoneyCalculation;
  source: OrderSource;
  className?: string;
}) {
  const safePrice = Number.isFinite(price) ? price : 0;
  const storedCost = Number.isFinite(Number(cost)) ? Number(cost) : 0;
  const storedProfit =
    profit != null && Number.isFinite(profit) ? profit : safePrice - storedCost;
  const costLabel = source === "wholesaler" ? "حصة الإدارة" : "التكلفة";
  const priceLabel = source === "wholesaler" ? "ما يدفعه الطالب" : "سعر الطلب";
  const hasPriceAdjustment = Boolean(calculation?.priceAdjustment);
  const hasCostAdjustment = Boolean(calculation?.costAdjustment);

  return (
    <CalculationDetails summary="لماذا ظهرت هذه الأرقام؟" className={className}>
      {calculation?.lines.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[360px] border-collapse text-right">
            <thead>
              <tr className="border-b border-line text-[11px] text-muted">
                <th className="pb-1.5 pe-2 font-semibold">البند المحفوظ</th>
                <th className="px-2 pb-1.5 font-semibold">العدد</th>
                <th className="px-2 pb-1.5 font-semibold">{priceLabel}</th>
                {source === "wholesaler" && (
                  <th className="ps-2 pb-1.5 font-semibold">حصة الإدارة</th>
                )}
              </tr>
            </thead>
            <tbody>
              {calculation.lines.map((line, index) => (
                <tr key={`${line.label}-${index}`} className="border-b border-line/60 last:border-0">
                  <td className="py-1.5 pe-2 text-ink">{line.label}</td>
                  <td className="px-2 py-1.5 text-muted" dir="ltr">{line.qty}</td>
                  <td className="px-2 py-1.5 text-ink" dir="ltr">{formatIQD(line.price)}</td>
                  {source === "wholesaler" && (
                    <td className="ps-2 py-1.5 text-ink" dir="ltr">{formatIQD(line.adminPrice)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>لا توجد تفاصيل بنود محفوظة لهذا الطلب؛ لذلك تُشرح النتيجة من المبالغ المحاسبية المخزنة.</p>
      )}

      <div className="mt-3 space-y-2">
        {calculation && (
          <>
            <Equation>
              {priceLabel} = مجموع البنود {formatIQD(calculation.linePriceTotal)}
              {hasPriceAdjustment ? ` + تسوية ${formatIQD(calculation.priceAdjustment)}` : ""}
              {` = ${formatIQD(safePrice)}`}
            </Equation>
            <Equation>
              {costLabel} = {source === "wholesaler" ? "مجموع حصص الإدارة" : "المبلغ المحاسبي"}{" "}
              {formatIQD(calculation.lineAdminTotal)}
              {hasCostAdjustment ? ` + تسوية ${formatIQD(calculation.costAdjustment)}` : ""}
              {` = ${formatIQD(storedCost)}`}
            </Equation>
          </>
        )}
        <Equation>
          {source === "wholesaler" ? "ربح الممثل" : "الربح"} = {formatIQD(safePrice)} − {formatIQD(storedCost)} = {formatIQD(storedProfit)}
        </Equation>
      </div>

      {(hasPriceAdjustment || hasCostAdjustment) && (
        <p className="mt-2 text-[11px] text-amber-800">
          التسوية تعني أن المبلغ النهائي المخزن لا يساوي مجموع تفاصيل البنود، غالباً بسبب سجل تاريخي أو تعديل يدوي. المبلغ النهائي المخزن هو المعتمد في المحاسبة.
        </p>
      )}
      {source === "wholesaler" && (
        <p className="mt-2 text-[11px]">
          في طلب الممثل: السعر هو ما يجمعه من الطالب، وحصة الإدارة هي ما يسلّمه للإدارة، والفرق بينهما هو ربح الممثل.
        </p>
      )}
    </CalculationDetails>
  );
}
