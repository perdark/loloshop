"use client";

import { useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fmtIQD,
  fmtNum,
  STAGE_COLORS,
  STAGE_LABELS,
  tickerLine,
  type Range,
  type Source,
  type TvSnapshot,
  type TvStaff,
  type TvTickerItem,
} from "@/lib/tv";

const SUB = "#9a6a3a";

// ─────────────────────────── KPI strip + Δ vs yesterday ───────────────────────
function Delta({ v }: { v: number }) {
  if (!v) return <span className="text-sm text-[#b59673]">—</span>;
  const up = v > 0;
  return (
    <span className={`text-sm font-bold ${up ? "text-green-600" : "text-red-500"}`}>
      {up ? "▲" : "▼"} {Math.abs(v)}٪
    </span>
  );
}
export function KpiStrip({ k, moneyVisible = false }: { k: TvSnapshot["kpis"]; moneyVisible?: boolean }) {
  const cells = [
    { label: "طلبات اليوم", value: fmtNum(k.orders_today), delta: k.orders_delta, money: false },
    { label: "تم التسليم اليوم", value: fmtNum(k.delivered_today), delta: k.delivered_delta, money: false },
    // Money cells appear ONLY when revealed — otherwise the board shows zero money.
    ...(moneyVisible
      ? [
          { label: "إيراد اليوم", value: fmtIQD(k.revenue_today ?? 0), delta: k.revenue_delta, money: true },
          { label: "ربح اليوم", value: fmtIQD(k.profit_today ?? 0), delta: null, money: true },
        ]
      : []),
  ];
  // One flat scoreboard band split by hairlines — reads as a summary bar, not
  // four competing cards. Money values take the accent; counts stay ink.
  return (
    <div className="tv-panel grid" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0,1fr))` }}>
      {cells.map((c) => (
        <div key={c.label} className="tv-kpi-cell px-7 py-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-base font-semibold text-[#9a6a3a]">{c.label}</span>
            {c.delta !== null && <Delta v={c.delta} />}
          </div>
          <div
            className={`mt-2 font-[Cairo] text-[2.1rem] font-extrabold leading-none tabular-nums ${
              c.money ? "text-[#F47B42]" : "text-[#5a3210]"
            }`}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────── Live pipeline funnel ─────────────────────────────
export function Funnel({ pipe }: { pipe: TvSnapshot["pipeline"] }) {
  const stages = pipe.stages;
  const max = Math.max(1, ...stages.map((s) => pipe.wip[s] || 0));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h3 className="font-[Amiri] text-2xl font-bold text-[#5a3210]">خط الإنتاج</h3>
          <span className="text-sm font-semibold text-[#b59673]">قيد التنفيذ الآن</span>
        </div>
        {pipe.bottleneck_active && pipe.bottleneck && (
          <div className="tv-pulse flex items-center gap-2 rounded-full bg-red-50 px-4 py-1.5 font-bold text-red-600 ring-1 ring-red-200">
            <span className="text-lg leading-none">⚠</span>
            <span>اختناق: {STAGE_LABELS[pipe.bottleneck]} · {pipe.wip[pipe.bottleneck]} عالق</span>
          </div>
        )}
      </div>
      <div className="flex items-end gap-2.5">
        {stages.map((s) => {
          const v = pipe.wip[s] || 0;
          const isBottle = pipe.bottleneck === s && pipe.bottleneck_active;
          const h = 30 + (v / max) * 86; // px height
          return (
            <div key={s} className="flex flex-1 flex-col items-center gap-1">
              <span className="font-[Cairo] text-xl font-extrabold text-[#5a3210]">{v}</span>
              <div
                className={`w-full rounded-t-xl transition-all ${isBottle ? "tv-pulse" : ""}`}
                style={{
                  height: `${h}px`,
                  background: isBottle
                    ? "linear-gradient(180deg,#ef4444,#dc2626)"
                    : `linear-gradient(180deg,${STAGE_COLORS[s]},${STAGE_COLORS[s]}cc)`,
                  boxShadow: isBottle ? "0 0 18px rgba(239,68,68,.5)" : "0 4px 10px rgba(244,123,66,.18)",
                }}
              />
              <span className="text-center text-sm font-semibold text-[#7a4e22]">
                {STAGE_LABELS[s]}
              </span>
            </div>
          );
        })}
        {/* tailor parallel track */}
        <div className="ms-2 flex flex-col items-center gap-1 border-s-2 border-dashed border-[#E8C39E] ps-3">
          <span className="font-[Cairo] text-xl font-extrabold text-[#5a3210]">
            {pipe.tailor_pending}
          </span>
          <div
            className="w-full min-w-[44px] rounded-t-xl"
            style={{
              height: `${30 + (pipe.tailor_pending / max) * 86}px`,
              background: "linear-gradient(180deg,#8B5E34,#6f4a28)",
            }}
          />
          <span className="text-center text-sm font-semibold text-[#7a4e22]">الفصال</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── Goal rings ──────────────────────────────────────
export function GoalRing({ done, target }: { done: number; target: number | null }) {
  const pct = target ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const R = 66;
  const C = 2 * Math.PI * R;
  // Shares the rail's height with the revenue panel and centers its content,
  // so the empty "بدون هدف" state reads as balanced negative space, not a void.
  return (
    <div className="tv-panel flex flex-1 flex-col items-center justify-center px-6 py-6">
      <h3 className="mb-3 font-[Amiri] text-2xl font-bold text-[#5a3210]">هدف اليوم</h3>
      <div className="relative">
        <svg width="168" height="168" viewBox="0 0 180 180">
          <circle cx="90" cy="90" r={R} fill="none" stroke="#F0DCC4" strokeWidth="15" />
          <circle
            cx="90"
            cy="90"
            r={R}
            fill="none"
            stroke="#F47B42"
            strokeWidth="15"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C - (C * pct) / 100}
            transform="rotate(-90 90 90)"
            style={{ transition: "stroke-dashoffset .8s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-[Cairo] text-4xl font-extrabold text-[#5a3210]">{fmtNum(done)}</span>
          <span className="text-base text-[#9a6a3a]">
            {target ? `من ${fmtNum(target)}` : "بدون هدف"}
          </span>
        </div>
      </div>
      {target ? (
        <p className="mt-3 text-lg font-bold text-[#F47B42]">
          {pct >= 100 ? "🎯 تحقق الهدف!" : `متبقٍ ${fmtNum(Math.max(0, target - done))}`}
        </p>
      ) : (
        <p className="mt-3 text-sm text-[#b59673]">حدِّد هدفاً من الإعدادات</p>
      )}
    </div>
  );
}

// ─────────────────────────── Revenue odometer ────────────────────────────────
export function RevenueOdometer({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const start = shown;
    const diff = value - start;
    if (!diff) return;
    const t0 = performance.now();
    const dur = 900;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + diff * eased));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  // The rail's hero metric — grows to fill the remaining height so the single
  // shouted number dominates the column.
  return (
    <div className="tv-panel flex flex-1 flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#FFF8F0] to-[#FFEAD0] px-6 py-7">
      <span className="text-lg font-semibold text-[#9a6a3a]">إيراد اليوم</span>
      <span className="font-[Cairo] text-6xl font-black leading-none tabular-nums text-[#F47B42]">
        {fmtNum(shown)}
      </span>
      <span className="text-base text-[#b59673]">دينار عراقي</span>
    </div>
  );
}

// ─────────────────────────── Staff watch grid ────────────────────────────────
const PRESENCE: Record<string, { dot: string; label: string }> = {
  present: { dot: "bg-green-500", label: "حاضر" },
  late: { dot: "bg-amber-500", label: "متأخر" },
  absent: { dot: "bg-gray-300", label: "غائب" },
  exempt: { dot: "bg-sky-400", label: "غير مطلوب" },
};
function StaffCard({ s }: { s: TvStaff }) {
  const p = PRESENCE[s.presence];
  const working = !!s.working_order;
  // Only flag "idle" for someone present who recently stopped — not days-old inactivity.
  const idle =
    !working && s.presence === "present" && s.idle_minutes != null && s.idle_minutes >= 20 && s.idle_minutes <= 600;
  const idleTxt = idle
    ? s.idle_minutes! >= 60
      ? `${Math.floor(s.idle_minutes! / 60)}س`
      : `${s.idle_minutes}د`
    : "";
  return (
    <div
      className={`tv-tile px-4 py-3 ${
        working ? "!border-green-300 ring-1 ring-green-200" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-[Cairo] text-lg font-bold text-[#5a3210]">{s.name}</span>
        <span className="flex items-center gap-1.5 text-sm text-[#9a6a3a]">
          <i className={`h-2.5 w-2.5 rounded-full ${p.dot} ${s.presence === "present" ? "tv-pulse" : ""}`} />
          {p.label}
        </span>
      </div>
      <div className="mt-0.5 text-xs text-[#b59673]">{s.role.map((r) => ROLE_AR[r] || r).join(" · ")}</div>
      <div className="mt-2 flex items-center justify-between">
        {working ? (
          <span className="rounded-md bg-green-50 px-2 py-0.5 text-sm font-semibold text-green-700">
            يعمل الآن • {s.working_status ? STAGE_LABELS[s.working_status] : ""}
          </span>
        ) : idle ? (
          <span className="rounded-md bg-amber-50 px-2 py-0.5 text-sm text-amber-700">
            خامل منذ {idleTxt}
          </span>
        ) : (
          <span className="text-sm text-[#b59673]">—</span>
        )}
        <span className="font-[Cairo] text-base font-extrabold text-[#F47B42]">
          {s.done_today} اليوم
        </span>
      </div>
    </div>
  );
}
const ROLE_AR: Record<string, string> = {
  designer: "تصميم",
  digitizer: "تحويل",
  embroiderer: "تطريز",
  presser: "كوي",
  preparer: "تجهيز",
  tailor: "فصال",
  manager: "مدير إنتاج",
};
export function StaffWatch({ staff, leaderboard }: { staff: TvStaff[]; leaderboard: TvStaff[] }) {
  const maxDone = Math.max(1, ...leaderboard.map((s) => s.done_today));
  return (
    <div className="grid h-full grid-cols-3 gap-4">
      <div className="col-span-2">
        <h3 className="mb-2 font-[Amiri] text-2xl font-bold text-[#5a3210]">متابعة الموظفين</h3>
        <div className="grid grid-cols-2 gap-3">
          {staff.map((s) => (
            <StaffCard key={s.id} s={s} />
          ))}
          {!staff.length && <p className="text-[#b59673]">لا يوجد موظفون.</p>}
        </div>
      </div>
      <div>
        <h3 className="mb-2 font-[Amiri] text-2xl font-bold text-[#5a3210]">🏆 الأكثر إنتاجاً اليوم</h3>
        <div className="flex flex-col gap-2">
          {leaderboard.filter((s) => s.done_today > 0).slice(0, 6).map((s, i) => (
            <div key={s.id} className="tv-tile px-3 py-2">
              <div className="flex items-center justify-between text-[#5a3210]">
                <span className="font-bold">
                  {["🥇", "🥈", "🥉"][i] || `${i + 1}.`} {s.name}
                </span>
                <span className="font-[Cairo] font-extrabold text-[#F47B42]">{s.done_today}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#F0DCC4]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#FFB100] to-[#F47B42]"
                  style={{ width: `${(s.done_today / maxDone) * 100}%` }}
                />
              </div>
            </div>
          ))}
          {!leaderboard.some((s) => s.done_today > 0) && (
            <p className="text-[#b59673]">لا إنتاج بعد اليوم.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── Graphs (recharts) ───────────────────────────────
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="tv-well flex min-h-0 flex-col p-4">
      <h4 className="mb-2 font-[Cairo] text-lg font-bold text-[#5a3210]">{title}</h4>
      <div className="min-h-0 w-full flex-1">{children}</div>
    </div>
  );
}
const AXIS = { fontSize: 12, fill: SUB };
export function Graphs({ g }: { g: TvSnapshot["graphs"] }) {
  const data = g.series;
  // Fill the hero panel exactly — a 2×2 grid that flexes to the available
  // height so the bottom charts never clip.
  return (
    <div className="grid h-full grid-cols-2 grid-rows-2 gap-4">
      <ChartCard title="الطلبات: وارد مقابل مُسلَّم">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#F47B42" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#F47B42" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gDone" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#16A34A" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#16A34A" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0DCC4" />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} />
            <YAxis tick={AXIS} tickLine={false} width={28} />
            <Tooltip />
            <Area type="monotone" dataKey="orders_in" name="وارد" stroke="#F47B42" fill="url(#gIn)" strokeWidth={2} />
            <Area type="monotone" dataKey="done" name="مُسلَّم" stroke="#16A34A" fill="url(#gDone)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="الإيراد والربح">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0DCC4" />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} />
            <YAxis tick={AXIS} tickLine={false} width={44} />
            <Tooltip />
            <Line type="monotone" dataKey="revenue" name="إيراد" stroke="#FFB100" strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="profit" name="ربح" stroke="#F47B42" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="إنتاجية الفريق">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0DCC4" />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} />
            <YAxis tick={AXIS} tickLine={false} width={28} />
            <Tooltip />
            <Bar dataKey="productivity" name="إنجازات" fill="#F47B42" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="حسب الجامعة">
        <ResponsiveContainer>
          <BarChart
            data={g.universities}
            layout="vertical"
            margin={{ top: 4, right: 12, left: 8, bottom: 0 }}
          >
            <XAxis type="number" tick={AXIS} tickLine={false} />
            <YAxis type="category" dataKey="name" tick={AXIS} width={96} tickLine={false} />
            <Tooltip />
            <Bar dataKey="count" name="طلبات" fill="#FFB100" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

// ─────────────────────────── Design spotlight ────────────────────────────────
import { assetUrl } from "@/lib/tv";
export function Spotlight({ items }: { items: TvSnapshot["spotlight"] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % items.length), 4500);
    return () => clearInterval(t);
  }, [items.length]);
  if (!items.length)
    return (
      <div className="flex h-full flex-col items-center justify-center text-[#b59673]">
        <span className="text-5xl">🖼️</span>
        <p className="mt-2 text-xl">لا توجد تصاميم مكتملة بعد</p>
      </div>
    );
  const cur = items[i % items.length];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <h3 className="font-[Amiri] text-2xl font-bold text-[#5a3210]">✨ أحدث التصاميم</h3>
      <div className="relative flex max-h-[70%] flex-1 items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={assetUrl(cur.image)}
          alt={cur.student_name}
          className="max-h-full rounded-2xl border border-[#F0DCC4] object-contain shadow-md"
        />
      </div>
      <div className="text-center">
        <div className="font-[Cairo] text-xl font-bold text-[#5a3210]">{cur.student_name}</div>
        <div className="text-[#9a6a3a]">{cur.university}</div>
      </div>
      <div className="flex gap-1.5">
        {items.slice(0, 10).map((_, j) => (
          <i
            key={j}
            className={`h-2 w-2 rounded-full ${j === i % items.length ? "bg-[#F47B42]" : "bg-[#E8C39E]"}`}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────── Deadline wall (live countdown) ───────────────────
function countdown(deadline: string): { txt: string; danger: boolean; warn: boolean } {
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return { txt: "انتهى الموعد", danger: true, warn: false };
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const txt = d > 0 ? `${d}ي ${h}س ${m}د` : `${h}س ${m}د ${s}ث`;
  return { txt, danger: ms < 86400000, warn: ms < 3 * 86400000 };
}
export function DeadlineWall({ items }: { items: TvSnapshot["deadlines"] }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!items.length)
    return (
      <div className="rounded-2xl border border-[#F0DCC4] bg-[#FFF8F0] px-4 py-3 text-[#b59673]">
        ⏳ لا مواعيد نهائية قادمة
      </div>
    );
  return (
    <div className="flex gap-2 overflow-x-auto">
      {items.map((b) => {
        const c = countdown(b.deadline);
        return (
          <div
            key={b.id}
            className={`min-w-[180px] flex-shrink-0 rounded-2xl border px-4 py-3 shadow-sm ${
              c.danger
                ? "tv-pulse border-red-300 bg-red-50"
                : c.warn
                ? "border-amber-300 bg-amber-50"
                : "border-[#F0DCC4] bg-[#FFF8F0]"
            }`}
          >
            <div className="truncate font-[Cairo] font-bold text-[#5a3210]">{b.name}</div>
            <div
              className={`mt-1 font-[Cairo] text-xl font-extrabold tabular-nums ${
                c.danger ? "text-red-600" : c.warn ? "text-amber-600" : "text-[#F47B42]"
              }`}
            >
              ⏳ {c.txt}
            </div>
            <div className="text-sm text-[#9a6a3a]">{b.open_orders} طلب مفتوح</div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────── Live event ticker ───────────────────────────────
export function Ticker({ items }: { items: TvTickerItem[] }) {
  if (!items.length) return null;
  const line = items.slice(0, 30).map(tickerLine);
  const content = line.join("   •   ");
  return (
    <div className="overflow-hidden rounded-full border border-[#F0DCC4] bg-[#FFF8F0] py-2 shadow-sm">
      <div className="tv-marquee whitespace-nowrap font-[Cairo] text-lg font-semibold text-[#7a4e22]">
        <span className="px-4">🔴 مباشر</span>
        {content}
        <span className="px-8">🔴 مباشر   {content}</span>
      </div>
    </div>
  );
}

// ─────────────────────────── Ambient header (clock + dates) ───────────────────
const HIJRI = new Intl.DateTimeFormat("ar-SA-u-ca-islamic", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const GREG = new Intl.DateTimeFormat("ar-IQ", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
// A rotating NON-money KPI. One chip is spotlighted at a time so the persistent
// header feels alive over a 6-hour watch without ever showing an IQD amount.
function HeaderKpis({
  kpis,
  audienceNow,
  activeBatches,
}: {
  kpis: TvSnapshot["kpis"];
  audienceNow: number;
  activeBatches: number;
}) {
  const chips = [
    { label: "طلبات اليوم", value: fmtNum(kpis.orders_today), delta: kpis.orders_delta, icon: "🧾" },
    { label: "تم التسليم اليوم", value: fmtNum(kpis.delivered_today), delta: kpis.delivered_delta, icon: "✅" },
    { label: "يشاهدون الآن", value: fmtNum(audienceNow), delta: null, icon: "👁", live: true },
    { label: "دفعات نشطة", value: fmtNum(activeBatches), delta: null, icon: "🎓" },
  ];
  const [hi, setHi] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setHi((i) => (i + 1) % chips.length), 3200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="flex items-center gap-2.5">
      {chips.map((c, i) => {
        const on = i === hi;
        return (
          <div
            key={c.label}
            className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 transition-all duration-500 ${
              on
                ? "scale-[1.06] bg-[#FFE7CE] shadow-[0_4px_14px_-6px_rgba(244,123,66,.5)] ring-1 ring-[#F0C99A]"
                : "bg-[#FBF1E1]/70 ring-1 ring-[#F0DCC4]"
            }`}
          >
            <span className={`text-base leading-none ${c.live ? "tv-pulse" : ""}`}>{c.icon}</span>
            <span className="text-sm font-semibold text-[#9a6a3a]">{c.label}</span>
            <span className="font-[Cairo] text-xl font-extrabold tabular-nums text-[#5a3210]">{c.value}</span>
            {c.delta != null && c.delta !== 0 && <Delta v={c.delta} />}
          </div>
        );
      })}
    </div>
  );
}

export function Header({
  source,
  kpis,
  audienceNow,
  activeBatches,
  ownerTitle,
  trigger,
}: {
  source: Source;
  kpis: TvSnapshot["kpis"];
  audienceNow: number;
  activeBatches: number;
  ownerTitle?: string;
  trigger?: React.ReactNode;
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const srcLabel = source === "wholesaler" ? "جملة" : source === "retail" ? "تجزئة" : "كل القنوات";
  return (
    <header className="flex items-center justify-between gap-6">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#FFB100] to-[#F47B42] text-2xl text-white shadow-[0_6px_18px_-8px_rgba(244,123,66,.8)]">
          ◈
        </span>
        <div>
          <div className="flex items-baseline gap-2.5">
            <h1 className="font-[Amiri] text-3xl font-extrabold leading-none text-[#5a3210]">لوحة المتابعة</h1>
            <span className="rounded-full bg-[#FFE4C4] px-2.5 py-0.5 text-sm font-bold text-[#7a4e22]">{srcLabel}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-sm text-[#9a6a3a]">
            <i className="tv-pulse h-2 w-2 rounded-full bg-green-500" />
            <span className="font-semibold">مباشر</span>
            {ownerTitle && <span className="text-[#c39a6a]">·</span>}
            {ownerTitle && <span className="font-[Amiri] font-bold text-[#b5793c]">{ownerTitle}</span>}
          </div>
        </div>
      </div>

      <HeaderKpis kpis={kpis} audienceNow={audienceNow} activeBatches={activeBatches} />

      <div className="flex items-center gap-3">
        <div className="text-end">
          <div className="font-[Cairo] text-4xl font-black leading-none tabular-nums text-[#F47B42]">
            {now ? now.toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
          </div>
          <div className="mt-1 text-sm text-[#7a4e22]">
            {now ? GREG.format(now) : ""} · {now ? HIJRI.format(now) : ""} هـ
          </div>
        </div>
        {trigger}
      </div>
    </header>
  );
}

// ─────────────────────────── Celebration overlay ─────────────────────────────
export function Celebration({ event }: { event: { id: number; student: string; university?: string } | null }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!event) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), 4200);
    return () => clearTimeout(t);
  }, [event]);
  if (!show || !event) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[9998] flex items-center justify-center">
      <div className="tv-pop rounded-3xl border-2 border-[#FFB100] bg-white/95 px-12 py-8 text-center shadow-2xl">
        <div className="text-6xl">🎉</div>
        <div className="mt-2 font-[Amiri] text-4xl font-extrabold text-[#F47B42]">تم التسليم</div>
        <div className="mt-1 font-[Cairo] text-3xl font-bold text-[#5a3210]">{event.student}</div>
        {event.university && <div className="text-xl text-[#9a6a3a]">{event.university}</div>}
      </div>
    </div>
  );
}

// ─────────────────────────── Control sidebar ─────────────────────────────────
export type SceneKey =
  | "pulse"
  | "pipeline"
  | "trend"
  | "map"
  | "reach"
  | "deadlines"
  | "spotlight"
  | "money";
export type HeroView = "auto" | SceneKey;
function SbBtn({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-3 py-2 text-base font-semibold transition ${
        active ? "bg-[#F47B42] text-white shadow" : "bg-[#FFF1E0] text-[#7a4e22] hover:bg-[#FFE4C4]"
      }`}
    >
      {children}
    </button>
  );
}
export function Sidebar({
  open,
  onClose,
  source,
  onSource,
  view,
  onView,
  range,
  onRange,
  settings,
  onSettings,
  onFullscreen,
  revealed = false,
}: {
  open: boolean;
  onClose: () => void;
  source: Source;
  onSource: (s: Source) => void;
  view: HeroView;
  onView: (v: HeroView) => void;
  range: Range;
  onRange: (r: Range) => void;
  settings: TvSnapshot["settings"];
  onSettings: (patch: Partial<TvSnapshot["settings"]>) => void;
  onFullscreen: () => void;
  revealed?: boolean;
}) {
  return (
    <>
      {open && <div className="fixed inset-0 z-[9990] bg-black/20" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 right-0 z-[9991] w-[320px] max-w-[88vw] overflow-y-auto border-l border-[#F0DCC4] bg-[#FFF8F0] p-5 shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        dir="rtl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-[Amiri] text-2xl font-bold text-[#5a3210]">التحكم</h2>
          <button onClick={onClose} className="rounded-full bg-[#FFE4C4] px-3 py-1 text-[#7a4e22]">
            ✕
          </button>
        </div>

        <div className="mb-5">
          <div className="mb-2 text-sm font-bold text-[#9a6a3a]">الفلتر</div>
          <div className="grid grid-cols-3 gap-2">
            <SbBtn active={source === "all"} onClick={() => onSource("all")}>الكل</SbBtn>
            <SbBtn active={source === "wholesaler"} onClick={() => onSource("wholesaler")}>جملة</SbBtn>
            <SbBtn active={source === "retail"} onClick={() => onSource("retail")}>تجزئة</SbBtn>
          </div>
        </div>

        <div className="mb-5">
          <div className="mb-2 text-sm font-bold text-[#9a6a3a]">المشهد</div>
          <div className="grid grid-cols-2 gap-2">
            <SbBtn active={view === "auto"} onClick={() => onView("auto")}>تلقائي ↻</SbBtn>
            <SbBtn active={view === "pulse"} onClick={() => onView("pulse")}>نبض اليوم</SbBtn>
            <SbBtn active={view === "pipeline"} onClick={() => onView("pipeline")}>خط الإنتاج</SbBtn>
            <SbBtn active={view === "trend"} onClick={() => onView("trend")}>التدفّق</SbBtn>
            <SbBtn active={view === "map"} onClick={() => onView("map")}>خريطة العراق</SbBtn>
            <SbBtn active={view === "reach"} onClick={() => onView("reach")}>بصمتنا</SbBtn>
            <SbBtn active={view === "deadlines"} onClick={() => onView("deadlines")}>المواعيد والفريق</SbBtn>
            <SbBtn active={view === "spotlight"} onClick={() => onView("spotlight")}>التصاميم</SbBtn>
            {revealed && (
              <SbBtn active={view === "money"} onClick={() => onView("money")}>الأرباح والإيرادات</SbBtn>
            )}
          </div>
        </div>

        <div className="mb-5">
          <div className="mb-2 text-sm font-bold text-[#9a6a3a]">مدى الرسوم</div>
          <div className="grid grid-cols-3 gap-2">
            <SbBtn active={range === "today"} onClick={() => onRange("today")}>اليوم</SbBtn>
            <SbBtn active={range === "7"} onClick={() => onRange("7")}>7 أيام</SbBtn>
            <SbBtn active={range === "30"} onClick={() => onRange("30")}>30 يوم</SbBtn>
          </div>
        </div>

        <div className="mb-5 space-y-3 border-t border-[#F0DCC4] pt-4">
          <div className="text-sm font-bold text-[#9a6a3a]">الإعدادات</div>
          <label className="block text-[#5a3210]">
            هدف اليوم
            <input
              type="number"
              min={0}
              defaultValue={settings.daily_goal ?? ""}
              onBlur={(e) => onSettings({ daily_goal: e.target.value ? parseInt(e.target.value, 10) : null })}
              className="mt-1 w-full rounded-xl border border-[#E8C39E] bg-white px-3 py-2"
              placeholder="تلقائي"
            />
          </label>
          <label className="block text-[#5a3210]">
            حد الاختناق (عدد الطلبات)
            <input
              type="number"
              min={1}
              defaultValue={settings.bottleneck_threshold}
              onBlur={(e) => onSettings({ bottleneck_threshold: parseInt(e.target.value, 10) || 20 })}
              className="mt-1 w-full rounded-xl border border-[#E8C39E] bg-white px-3 py-2"
            />
          </label>
          <label className="flex items-center justify-between text-[#5a3210]">
            الصوت والاحتفال
            <input
              type="checkbox"
              defaultChecked={settings.sound}
              onChange={(e) => onSettings({ sound: e.target.checked })}
              className="h-5 w-5 accent-[#F47B42]"
            />
          </label>
        </div>

        <button
          onClick={onFullscreen}
          className="w-full rounded-xl bg-[#5a3210] py-3 font-bold text-white"
        >
          ⛶ ملء الشاشة
        </button>
      </aside>
    </>
  );
}
