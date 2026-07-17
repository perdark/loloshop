"use client";

// Money performance scene — slotted into the rotation ONLY when money_visible.
// Warm-cream, matches the rest of the cinema. Because it's gated, revenue/profit
// arrive as real numbers here; we still coerce null → 0 defensively.
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtIQD, fmtNum, type TvSnapshot } from "@/lib/tv";
import { SceneFrame } from "@/components/tv/Scenes";

const INK = "#5a3210";
const SUB = "#9a6a3a";
const ACCENT = "#F47B42";
const GOLD = "#FFB100";
const GREEN = "#16A34A";
const GRID = "#F0DCC4";
const AXIS = { fontSize: 13, fill: SUB };
const TIP = { background: "rgba(255,250,243,.96)", border: "1px solid #ECD7BA", borderRadius: 12, color: INK };

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="tv-panel flex min-h-0 flex-col p-5">
      <div className="mb-2 flex items-baseline gap-2.5">
        <h3 className="font-[Amiri] text-2xl font-bold text-[#5a3210]">{title}</h3>
        {hint && <span className="text-sm font-semibold text-[#b59673]">{hint}</span>}
      </div>
      <div className="min-h-0 w-full flex-1">{children}</div>
    </div>
  );
}

export function MoneyScene({ data }: { data: TvSnapshot }) {
  const k = data.kpis;
  const series = data.graphs.series.map((p) => ({
    label: p.label,
    revenue: p.revenue ?? 0,
    profit: p.profit ?? 0,
  }));
  const cumulative = series.reduce<{ label: string; total: number }[]>(
    (acc, p) => [...acc, { label: p.label, total: (acc.length ? acc[acc.length - 1].total : 0) + p.revenue }],
    []
  );
  const cumTotal = cumulative.length ? cumulative[cumulative.length - 1].total : 0;
  const rangeLabel = data.range === "today" ? "اليوم (بالساعة)" : data.range === "7" ? "آخر ٧ أيام" : "آخر ٣٠ يوم";
  const g = data.growth;
  const yoyRev =
    g && g.last_year_rev != null && g.this_year_rev != null && g.last_year_rev > 0
      ? Math.round(((g.this_year_rev - g.last_year_rev) / g.last_year_rev) * 100)
      : null;

  return (
    <SceneFrame
      kicker="🔓 الأداء المالي · الطلبات الموافق عليها وغير الملغاة فقط"
      title="الإيراد والربح"
      right={
        <div className="flex items-center gap-6">
          <span className="max-w-52 text-sm font-semibold leading-snug text-[#9a6a3a]">
            الربح = الإيراد − التكلفة / حصة الإدارة
          </span>
          <div>
            <div className="text-base font-semibold text-[#9a6a3a]">إيراد اليوم</div>
            <div className="font-[Cairo] text-4xl font-black tabular-nums text-[#F47B42]">{fmtNum(k.revenue_today ?? 0)}</div>
          </div>
          <div>
            <div className="text-base font-semibold text-[#9a6a3a]">ربح اليوم</div>
            <div className="font-[Cairo] text-4xl font-black tabular-nums text-[#16A34A]">{fmtNum(k.profit_today ?? 0)}</div>
          </div>
          <span className="rounded-full bg-[#FFE4C4] px-3 py-1 text-sm font-bold text-[#7a4e22]">{rangeLabel}</span>
        </div>
      }
    >
      <div className="grid h-full grid-cols-2 grid-rows-2 gap-5">
        <Card title="الإيراد والربح" hint={rangeLabel}>
          {series.length ? (
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 8, right: 12, left: -6, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="label" tick={AXIS} tickLine={false} />
                <YAxis tick={AXIS} tickLine={false} width={46} />
                <Tooltip contentStyle={TIP} />
                <Line type="monotone" dataKey="revenue" name="إيراد" stroke={GOLD} strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="profit" name="ربح" stroke={ACCENT} strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </Card>

        <Card title="الإيراد التراكمي" hint={fmtIQD(cumTotal)}>
          {cumulative.length ? (
            <ResponsiveContainer>
              <AreaChart data={cumulative} margin={{ top: 8, right: 12, left: 2, bottom: 0 }}>
                <defs>
                  <linearGradient id="fgCum" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={GREEN} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="label" tick={AXIS} tickLine={false} />
                <YAxis tick={AXIS} tickLine={false} width={54} />
                <Tooltip contentStyle={TIP} />
                <Area type="monotone" dataKey="total" name="إيراد تراكمي" stroke={GREEN} fill="url(#fgCum)" strokeWidth={3} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </Card>

        <div className="tv-panel flex flex-col justify-center gap-4 p-6">
          <h3 className="font-[Amiri] text-2xl font-bold text-[#5a3210]">إجمالي مدى الحياة</h3>
          <div>
            <div className="text-base font-semibold text-[#9a6a3a]">إيراد تراكمي على الإطلاق</div>
            <div className="font-[Cairo] text-6xl font-black leading-none tabular-nums text-[#F47B42]">
              {fmtNum(data.lifetime?.revenue_total ?? 0)}
            </div>
            <div className="text-base text-[#b59673]">دينار عراقي</div>
          </div>
        </div>

        <Card title="الإيراد سنوياً" hint={yoyRev == null ? "لا مقارنة" : `${yoyRev >= 0 ? "▲ +" : "▼ "}${fmtNum(yoyRev)}٪ عن العام الماضي`}>
          <div className="flex h-full flex-col justify-center gap-5 px-2">
            <div className="flex items-center justify-between">
              <span className="text-xl font-semibold text-[#7a4e22]">هذا العام</span>
              <span className="font-[Cairo] text-4xl font-black tabular-nums text-[#F47B42]">{fmtNum(g?.this_year_rev ?? 0)}</span>
            </div>
            <div className="h-4 overflow-hidden rounded-full bg-[#F0DCC4]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#FFB100] to-[#F47B42]"
                style={{
                  width: `${(() => {
                    const t = g?.this_year_rev ?? 0;
                    const l = g?.last_year_rev ?? 0;
                    const m = Math.max(1, t, l);
                    return Math.round((t / m) * 100);
                  })()}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xl font-semibold text-[#9a6a3a]">العام الماضي</span>
              <span className="font-[Cairo] text-3xl font-extrabold tabular-nums text-[#9a6a3a]">{fmtNum(g?.last_year_rev ?? 0)}</span>
            </div>
            <div className="h-4 overflow-hidden rounded-full bg-[#F0DCC4]">
              <div
                className="h-full rounded-full bg-[#c9a877]"
                style={{
                  width: `${(() => {
                    const t = g?.this_year_rev ?? 0;
                    const l = g?.last_year_rev ?? 0;
                    const m = Math.max(1, t, l);
                    return Math.round((l / m) * 100);
                  })()}%`,
                }}
              />
            </div>
          </div>
        </Card>
      </div>
    </SceneFrame>
  );
}

function Empty() {
  return <div className="flex h-full items-center justify-center text-[#b59673]">لا توجد بيانات بعد</div>;
}
