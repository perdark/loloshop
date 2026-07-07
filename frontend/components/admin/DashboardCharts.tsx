"use client";

// Non-money analytics for the admin dashboard — stays useful even when the
// financial figures are masked behind the money-gate. Both charts derive ONLY
// from order COUNTS (never revenue/profit), so nothing here needs masking.
//
// Rendered client-only (recharts + ResponsiveContainer); the page imports this
// via next/dynamic with ssr:false, mirroring DailyOrdersChart.

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDateShort } from "@/lib/format";
import { ORDER_STATUS_LABELS } from "@/lib/constants";
import type { OrderStatus } from "@/lib/types";

/* Brand-warm palette (matches the TV graphs + storefront). */
const ORANGE = "#F47B42";
const GOLD = "#FFB100";
const INK = "#5a3210";
const SUB = "#9a6a3a";
const GRID = "#EAD9C0";
const AXIS = { fontSize: 12, fill: SUB } as const;
const TIP = {
  background: "rgba(255,248,240,.97)",
  border: "1px solid #ECD7BA",
  borderRadius: 12,
  color: INK,
  fontFamily: "var(--font-cairo)",
  fontSize: 13,
} as const;

/* Cool→warm ladder used to tint pipeline bars so the eye reads flow. */
const STAGE_TINTS = ["#C99B6B", "#E0A25A", GOLD, ORANGE, "#E86A3A", "#16A34A"];

const toArabic = (n: number | string) =>
  String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-beige p-5 shadow-[var(--shadow-soft)]">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
        {hint && (
          <span className="shrink-0 text-xs font-medium text-[var(--shop-muted)]">
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Empty() {
  return (
    <div className="flex h-56 items-center justify-center text-sm text-[var(--shop-muted)]">
      لا توجد بيانات بعد
    </div>
  );
}

export interface DashboardChartsProps {
  daily: { date: string; count: number }[];
  ordersByStatus: Record<string, number>;
}

export function DashboardCharts({ daily, ordersByStatus }: DashboardChartsProps) {
  // 1) Orders trend — daily counts as a soft area (money-free).
  const trend = daily.map((d) => ({
    label: formatDateShort(d.date),
    count: d.count,
  }));
  const trendTotal = daily.reduce((sum, d) => sum + d.count, 0);

  // 2) Production pipeline — order counts per status, biggest first.
  const pipeline = Object.entries(ordersByStatus)
    .map(([status, value]) => ({
      name: ORDER_STATUS_LABELS[status as OrderStatus] ?? status,
      value,
    }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
  const inPipeline = pipeline.reduce((sum, s) => sum + s.value, 0);

  return (
    <div dir="rtl" className="grid gap-5 lg:grid-cols-2">
      {/* Orders trend */}
      <ChartCard
        title="حركة الطلبات"
        hint={
          daily.length
            ? `${toArabic(trendTotal)} طلب · ${toArabic(daily.length)} يوم`
            : undefined
        }
      >
        {trend.length ? (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={trend}
                margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="adminTrend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ORANGE} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={ORANGE} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={AXIS}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  minTickGap={16}
                />
                <YAxis
                  tick={AXIS}
                  tickLine={false}
                  axisLine={false}
                  width={34}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={TIP}
                  cursor={{ stroke: ORANGE, strokeOpacity: 0.3 }}
                  labelStyle={{ color: SUB, fontWeight: 700 }}
                  formatter={(v) => [toArabic(Number(v)), "طلبات"]}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  name="طلبات"
                  stroke={ORANGE}
                  strokeWidth={3}
                  fill="url(#adminTrend)"
                  dot={false}
                  activeDot={{ r: 4, fill: ORANGE }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Empty />
        )}
      </ChartCard>

      {/* Production pipeline */}
      <ChartCard
        title="مراحل الإنتاج"
        hint={inPipeline ? `${toArabic(inPipeline)} طلب` : undefined}
      >
        {pipeline.length ? (
          <div
            className="w-full"
            style={{ height: `${Math.max(pipeline.length * 34 + 16, 160)}px` }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={pipeline}
                layout="vertical"
                margin={{ top: 0, right: 28, left: 8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis
                  type="number"
                  tick={AXIS}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 12, fill: INK }}
                  tickLine={false}
                  axisLine={false}
                  width={104}
                />
                <Tooltip
                  contentStyle={TIP}
                  cursor={{ fill: "rgba(244,123,66,.08)" }}
                  formatter={(v) => [toArabic(Number(v)), "طلبات"]}
                />
                <Bar dataKey="value" name="طلبات" radius={[0, 8, 8, 0]} barSize={18}>
                  {pipeline.map((s, i) => (
                    <Cell key={s.name} fill={STAGE_TINTS[i % STAGE_TINTS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Empty />
        )}
      </ChartCard>
    </div>
  );
}

export default DashboardCharts;
