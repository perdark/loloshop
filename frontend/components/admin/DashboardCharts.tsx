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
  Legend,
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

/* Pipeline segment colours. The stack is semantic, not per-stage: the question the
   owner asks a stage bar is «how much work is waiting», and the answer splits into
   startable vs blocked — so the colour encodes THAT, not which stage it is. */
const WORKABLE = ORANGE;
const AWAITING_REP = "#C99B6B";
const RETURNED = "#9a6a3a";

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
  /** `count` = every live bundle that day. `billableCount` = the settled subset that
   *  actually produced revenue. Two different populations — see backend/lib/counts.js. */
  daily: { date: string; count: number; billableCount: number }[];
  /** Stage funnel in BOTH units, split by workability — see backend/lib/counts.js. */
  funnel: {
    stage: string;
    pieces: number;
    students: number;
    workable: number;
    awaitingRep: number;
    returned: number;
  }[];
}

export function DashboardCharts({ daily, funnel }: DashboardChartsProps) {
  // 1) Orders trend (bug 10, 2026-08-13). This chart used to plot ONE series — every
  // live bundle — while the revenue that travelled on the same row was filtered to
  // settled bundles only. Anyone dividing the two got an average-per-order off by up
  // to 3× (10 Aug: 32 bars' worth of orders against revenue produced by 18). Both
  // populations are now drawn, so the gap between them IS the pending-approval backlog
  // instead of an invisible modelling error.
  const trend = daily.map((d) => ({
    label: formatDateShort(d.date),
    count: d.count,
    billable: d.billableCount,
  }));
  const trendTotal = daily.reduce((sum, d) => sum + d.count, 0);
  const trendBillable = daily.reduce((sum, d) => sum + d.billableCount, 0);

  // 2) Production pipeline. UNITS MATTER HERE (2026-07-21): only PIECES have a
  // stage — 76% of orders span 2-3 stages at once, so a per-stage ORDER count would
  // overcount by ~79% and could never sum to the order total. The three stacked
  // segments are pieces and sum EXACTLY to the stage total; `students` rides along as
  // a per-stage MEMBERSHIP count (a student with pieces in two stages appears in both)
  // and is labelled so it is never summed.
  //
  // WORKABLE (bug 9, 2026-08-13): a bare stage total mixes work a station can start
  // with work blocked on someone else, which is why /admin read 1,162 at بانتظار التصميم
  // while the designer's own queue showed 797. The staff screens were right; the split
  // is now visible here so the two numbers explain each other.
  const pipeline = funnel
    .map((f) => ({
      name: ORDER_STATUS_LABELS[f.stage as OrderStatus] ?? f.stage,
      value: f.pieces,
      workable: f.workable,
      awaitingRep: f.awaitingRep,
      returned: f.returned,
      students: f.students,
    }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
  const inPipeline = pipeline.reduce((sum, s) => sum + s.value, 0);
  const workableTotal = pipeline.reduce((sum, s) => sum + s.workable, 0);

  return (
    <div dir="rtl" className="grid gap-5 lg:grid-cols-2">
      {/* Orders trend */}
      <ChartCard
        title="حركة الطلبات"
        hint={
          daily.length
            ? `${toArabic(trendBillable)} محتسب من ${toArabic(trendTotal)} · ${toArabic(daily.length)} يوم`
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
                  <linearGradient id="adminTrendAll" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={GOLD} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={GOLD} stopOpacity={0} />
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
                  formatter={(v, n) => [toArabic(Number(v)), String(n)]}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  height={26}
                  iconSize={9}
                  wrapperStyle={{ fontSize: 12, color: SUB, paddingBottom: 4 }}
                />
                {/* Drawn FIRST so the smaller settled series sits on top of it. The
                    band between the two is the pending-approval backlog. */}
                <Area
                  type="monotone"
                  dataKey="count"
                  name="كل الطلبات"
                  stroke={GOLD}
                  strokeWidth={2}
                  fill="url(#adminTrendAll)"
                  dot={false}
                  activeDot={{ r: 3, fill: GOLD }}
                />
                <Area
                  type="monotone"
                  dataKey="billable"
                  name="طلبات محتسبة"
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
        hint={
          inPipeline
            ? `${toArabic(workableTotal)} قابلة للعمل من ${toArabic(inPipeline)} قطعة`
            : undefined
        }
      >
        {pipeline.length ? (
          <div
            className="w-full"
            style={{ height: `${Math.max(pipeline.length * 42 + 16, 170)}px` }}
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
                  formatter={(v, n) => [toArabic(Number(v)), String(n)]}
                />
                {/* Named on sight — the thin bar is a membership count, and the
                    legend says so, so it is never read as a share of the total. */}
                <Legend
                  verticalAlign="top"
                  align="right"
                  height={26}
                  iconSize={9}
                  wrapperStyle={{ fontSize: 12, color: SUB, paddingBottom: 4 }}
                />
                {/* One stack, three segments that sum EXACTLY to the stage total — so
                    the bar still reads as «how many pieces are here» while showing how
                    many of them anybody can actually start. The orange segment is what
                    the station's own queue shows; the rest is what it correctly hides. */}
                <Bar
                  dataKey="workable"
                  stackId="stage"
                  name="قابل للعمل"
                  fill={WORKABLE}
                  barSize={14}
                />
                <Bar
                  dataKey="awaitingRep"
                  stackId="stage"
                  name="بانتظار موافقة الممثل"
                  fill={AWAITING_REP}
                  barSize={14}
                />
                <Bar
                  dataKey="returned"
                  stackId="stage"
                  name="مُرجع للطالب"
                  fill={RETURNED}
                  radius={[0, 8, 8, 0]}
                  barSize={14}
                />
                {/* Membership count, NOT a share of a total — the series name says so
                    outright, so the two bars can never be mistakenly added together. */}
                <Bar
                  dataKey="students"
                  name="طلاب لديهم قطعة هنا"
                  radius={[0, 8, 8, 0]}
                  barSize={6}
                  fill={INK}
                  fillOpacity={0.28}
                />
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
