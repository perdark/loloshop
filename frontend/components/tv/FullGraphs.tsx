"use client";

// Fullscreen "graphs takeover" for the auto-cinema. The whole board fades to
// THIS page for a while, then fades back. Deliberately NEW charts (donut / map
// bars / year-over-year / cumulative) — NOT the small ones already on the board.
// Warm-cream + soft glass to match the old design; fluid so it fills the screen
// edge-to-edge (no side letterbox).
import { useEffect, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  GOVS, STAGE_COLORS, STAGE_LABELS, fmtIQD, fmtNum, type TvSnapshot,
} from "@/lib/tv";

const INK = "#5a3210";
const SUB = "#9a6a3a";
const ACCENT = "#F47B42";
const GOLD = "#FFB100";
const GREEN = "#16A34A";
const GRID = "#F0DCC4";
const AXIS = { fontSize: 13, fill: SUB };
const TIP = { background: "rgba(255,250,243,.95)", border: "1px solid #ECD7BA", borderRadius: 12, color: INK };

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="tv-panel flex min-h-0 flex-col p-5" style={{ background: "rgba(255,250,243,.72)", backdropFilter: "blur(10px)" }}>
      <div className="mb-2 flex items-baseline gap-2.5">
        <h3 className="font-[Amiri] text-2xl font-bold text-[#5a3210]">{title}</h3>
        {hint && <span className="text-sm font-semibold text-[#b59673]">{hint}</span>}
      </div>
      <div className="min-h-0 w-full flex-1">{children}</div>
    </div>
  );
}

export function FullGraphs({ data }: { data: TvSnapshot }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 1) pipeline distribution — donut (new viz)
  const pipe = data.pipeline;
  const donut = [
    ...pipe.stages.map((s) => ({ name: STAGE_LABELS[s] ?? s, value: pipe.wip[s] || 0, color: STAGE_COLORS[s] || ACCENT })),
    { name: "الفصال", value: pipe.tailor_pending || 0, color: "#8B5E34" },
  ].filter((d) => d.value > 0);
  const wipTotal = donut.reduce((a, b) => a + b.value, 0);

  // 2) orders by governorate — top provinces (new)
  const provinces = Object.entries(data.map.gov)
    .map(([k, v]) => ({ name: GOVS[k]?.name ?? k, value: v }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 9);

  // 3) year over year — this year vs last (new)
  const yoy = data.growth?.series ?? [];
  const pct = data.growth?.orders_pct;
  const yoyHint = pct === null || pct === undefined
    ? (data.growth ? "عام جديد" : "")
    : `${pct >= 0 ? "▲ +" : "▼ "}${fmtNum(pct)}٪ مقارنة بالعام الماضي`;

  // 4) cumulative revenue across the range (new — board shows it non-cumulative)
  const cumulative = data.graphs.series.reduce<{ label: string; total: number }[]>(
    (acc, p) => [...acc, { label: p.label, total: (acc.length ? acc[acc.length - 1].total : 0) + p.revenue }],
    []
  );

  const rangeLabel = data.range === "today" ? "اليوم (بالساعة)" : data.range === "7" ? "آخر ٧ أيام" : "آخر ٣٠ يوم";

  return (
    <div dir="rtl" className="absolute inset-0 flex flex-col px-[3vw] py-[3vh] font-[Cairo]"
      style={{ background: "linear-gradient(135deg,#F4E6CF,#FAEEDB 55%,#EFDABE)" }}>
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-3xl">📊</span>
          <div>
            <h1 className="font-[Amiri] text-4xl font-extrabold text-[#5a3210]">لوحة الأداء</h1>
            <div className="flex items-center gap-2 text-[#9a6a3a]">
              <i className="tv-pulse h-2.5 w-2.5 rounded-full bg-green-500" />
              <span className="font-semibold">مباشر · {rangeLabel}</span>
            </div>
          </div>
        </div>
        <div className="text-end">
          <div className="font-[Cairo] text-5xl font-black tabular-nums text-[#F47B42]">
            {now ? now.toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
          </div>
          <div className="mt-1 flex items-center justify-end gap-2 text-[#9a6a3a]">
            <i className="tv-pulse h-2 w-2 rounded-full bg-green-500" />
            <span className="font-[Cairo] text-lg font-extrabold tabular-nums text-[#5a3210]">{fmtNum(data.audience?.now ?? 0)}</span>
            <span className="text-sm font-semibold">يشاهدون متجرك الآن</span>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-5">
        {/* 1 — pipeline distribution donut */}
        <Card title="توزيع الإنتاج حسب المرحلة" hint={`${fmtNum(wipTotal)} قيد التنفيذ`}>
          {donut.length ? (
            <ResponsiveContainer>
              <PieChart>
                <Pie data={donut} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="82%" paddingAngle={2} stroke="none"
                  label={(p: { name?: string; value?: number }) => `${p.name}: ${p.value}`} labelLine={false} style={{ fontSize: 13, fontWeight: 700, fill: INK }}>
                  {donut.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={TIP} />
              </PieChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Card>

        {/* 2 — orders by governorate */}
        <Card title="الطلبات حسب المحافظة" hint={`${data.map.reached} محافظة`}>
          {provinces.length ? (
            <ResponsiveContainer>
              <BarChart data={provinces} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={AXIS} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={AXIS} width={88} tickLine={false} />
                <Tooltip contentStyle={TIP} cursor={{ fill: GRID }} />
                <Bar dataKey="value" name="طلبات" fill={GOLD} radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Card>

        {/* 3 — year over year */}
        <Card title="هذا العام مقابل العام الماضي" hint={yoyHint}>
          {yoy.length ? (
            <ResponsiveContainer>
              <AreaChart data={yoy} margin={{ top: 10, right: 10, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="fgThis" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={ACCENT} stopOpacity={0.5} /><stop offset="100%" stopColor={ACCENT} stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="label" tick={AXIS} tickLine={false} interval={0} />
                <YAxis tick={AXIS} tickLine={false} width={30} />
                <Tooltip contentStyle={TIP} />
                <Area type="monotone" dataKey="last_year" name="العام الماضي" stroke={SUB} strokeDasharray="5 4" fill="transparent" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="this_year" name="هذا العام" stroke={ACCENT} fill="url(#fgThis)" strokeWidth={3} dot={{ r: 2, fill: ACCENT }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Card>

        {/* 4 — cumulative revenue */}
        <Card title="الإيراد التراكمي" hint={fmtIQD(cumulative.length ? cumulative[cumulative.length - 1].total : 0)}>
          {cumulative.length ? (
            <ResponsiveContainer>
              <AreaChart data={cumulative} margin={{ top: 10, right: 10, left: -2, bottom: 0 }}>
                <defs>
                  <linearGradient id="fgCum" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={GREEN} stopOpacity={0.45} /><stop offset="100%" stopColor={GREEN} stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="label" tick={AXIS} tickLine={false} />
                <YAxis tick={AXIS} tickLine={false} width={52} />
                <Tooltip contentStyle={TIP} />
                <Area type="monotone" dataKey="total" name="إيراد تراكمي" stroke={GREEN} fill="url(#fgCum)" strokeWidth={3} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Card>
      </div>
    </div>
  );
}

function Empty() {
  return <div className="flex h-full items-center justify-center text-[#b59673]">لا توجد بيانات بعد</div>;
}
