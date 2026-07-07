"use client";

// Scene cinema for the wall board. Each scene fills the whole stage; the board
// cross-fades between them so it stays alive over a 6-hour watch. Warm brand
// only (cream / orange / peach / ink) — luxury-fashion editorial, no obsidian.
// Every DEFAULT scene is money-free; money scenes live in FullGraphs and are
// only slotted into the rotation when money_visible === true.

import { useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  GOVS,
  STAGE_COLORS,
  STAGE_LABELS,
  dmToAr,
  fmtNum,
  ymToAr,
  type TvSnapshot,
} from "@/lib/tv";
import { IraqMap } from "@/components/tv/IraqMap";
import { DeadlineWall, StaffWatch, Spotlight } from "@/components/tv/Panels";

const INK = "#5a3210";
const SUB = "#9a6a3a";
const ACCENT = "#F47B42";
const GOLD = "#FFB100";
const GREEN = "#16A34A";
const GRID = "#F0DCC4";
const AXIS = { fontSize: 14, fill: SUB };
const TIP = { background: "rgba(255,250,243,.96)", border: "1px solid #ECD7BA", borderRadius: 12, color: INK };

// ─────────────────────────── shared scene chrome ─────────────────────────────
export function SceneFrame({
  kicker,
  title,
  right,
  children,
}: {
  kicker: string;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-5 flex items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 font-[Cairo] text-base font-bold text-[#c39a6a]"><span className="inline-block h-px w-8 bg-[#dcb789]" aria-hidden />{kicker}</div>
          <h2 className="mt-1 font-[Amiri] text-[2.6rem] font-extrabold leading-none text-[#5a3210]">{title}</h2>
        </div>
        {right && <div className="shrink-0 text-end">{right}</div>}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

// Count-up animation for the big brag numbers.
function CountUp({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const start = shown;
    const diff = value - start;
    if (!diff) {
      setShown(value);
      return;
    }
    const t0 = performance.now();
    const dur = 850;
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
  return <span className={className}>{fmtNum(shown)}</span>;
}

function DeltaPill({ v }: { v: number | null }) {
  if (v == null || v === 0) return null;
  const up = v > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-lg font-bold ${
        up ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
      }`}
    >
      {up ? "▲" : "▼"} {Math.abs(v)}٪
    </span>
  );
}

// ─────────────────────────── 1) Pulse (today) ────────────────────────────────
export function PulseScene({ data }: { data: TvSnapshot }) {
  const k = data.kpis;
  const audience = data.audience?.now ?? 0;
  const batches = data.deadlines.length;
  const goal = data.goal;
  const pct = goal.target ? Math.min(100, Math.round((goal.done_today / goal.target) * 100)) : 0;
  return (
    <SceneFrame
      kicker="نبض اليوم"
      title="حركة الإنتاج الآن"
      right={
        <div className="flex items-center gap-2 rounded-full bg-[#FFF3E6] px-4 py-2 ring-1 ring-[#F0C99A]">
          <i className="tv-pulse h-2.5 w-2.5 rounded-full bg-green-500" />
          <span className="font-[Cairo] text-2xl font-extrabold tabular-nums text-[#5a3210]">{fmtNum(audience)}</span>
          <span className="text-base font-semibold text-[#9a6a3a]">يشاهدون متجرك</span>
        </div>
      }
    >
      <div className="grid h-full grid-cols-[1.5fr_1fr] gap-6">
        <div className="grid grid-rows-2 gap-6">
          {[
            { label: "طلبات اليوم", value: k.orders_today, delta: k.orders_delta, tint: "from-[#FFF8F0] to-[#FFE7CE]", accent: ACCENT },
            { label: "تم التسليم اليوم", value: k.delivered_today, delta: k.delivered_delta, tint: "from-[#FBFDF7] to-[#E6F5E3]", accent: GREEN },
          ].map((c) => (
            <div
              key={c.label}
              className={`tv-panel flex items-center justify-between bg-gradient-to-br ${c.tint} px-10`}
            >
              <div>
                <div className="text-2xl font-semibold text-[#9a6a3a]">{c.label}</div>
                <div className="mt-2">
                  <DeltaPill v={c.delta} />
                </div>
              </div>
              <span style={{ color: c.accent }}>
                <CountUp value={c.value} className="font-[Cairo] text-[8rem] font-black leading-none tabular-nums" />
              </span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-6">
          <div className="tv-panel flex flex-1 flex-col items-center justify-center gap-3 px-6">
            <h3 className="font-[Amiri] text-2xl font-bold text-[#5a3210]">هدف اليوم</h3>
            <div className="relative">
              <svg width="180" height="180" viewBox="0 0 180 180">
                <circle cx="90" cy="90" r="66" fill="none" stroke="#F0DCC4" strokeWidth="16" />
                <circle
                  cx="90"
                  cy="90"
                  r="66"
                  fill="none"
                  stroke="#F47B42"
                  strokeWidth="16"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 66}
                  strokeDashoffset={2 * Math.PI * 66 - (2 * Math.PI * 66 * pct) / 100}
                  transform="rotate(-90 90 90)"
                  style={{ transition: "stroke-dashoffset .8s ease" }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-[Cairo] text-5xl font-black text-[#5a3210]">{fmtNum(goal.done_today)}</span>
                <span className="text-base text-[#9a6a3a]">{goal.target ? `من ${fmtNum(goal.target)}` : "بدون هدف"}</span>
              </div>
            </div>
            {goal.target ? (
              <p className="text-lg font-bold text-[#F47B42]">
                {pct >= 100 ? "🎯 تحقق الهدف!" : `متبقٍ ${fmtNum(Math.max(0, goal.target - goal.done_today))}`}
              </p>
            ) : (
              <p className="text-sm text-[#b59673]">حدِّد هدفاً من الإعدادات</p>
            )}
          </div>
          <div className="tv-tile flex items-center justify-between px-7 py-6">
            <span className="text-xl font-semibold text-[#9a6a3a]">دفعات نشطة</span>
            <span className="font-[Cairo] text-5xl font-black tabular-nums text-[#F47B42]">{fmtNum(batches)}</span>
          </div>
        </div>
      </div>
    </SceneFrame>
  );
}

// ─────────────────────────── 2) Pipeline (WIP funnel) ─────────────────────────
export function PipelineScene({ data }: { data: TvSnapshot }) {
  const P = data.pipeline;
  const rows = [
    ...P.stages.map((s) => ({
      key: s,
      label: STAGE_LABELS[s] ?? s,
      v: P.wip[s] || 0,
      color: STAGE_COLORS[s] || ACCENT,
      bottle: P.bottleneck === s && P.bottleneck_active,
    })),
    { key: "tailor", label: "الفصال", v: P.tailor_pending || 0, color: "#8B5E34", bottle: false },
  ];
  const max = Math.max(1, ...rows.map((r) => r.v));
  const total = rows.reduce((a, r) => a + r.v, 0);
  return (
    <SceneFrame
      kicker="خط الإنتاج"
      title="قيد التنفيذ الآن"
      right={
        P.bottleneck_active && P.bottleneck ? (
          <div className="tv-pulse inline-flex items-center gap-2 rounded-full bg-[#fff1ec] px-5 py-2.5 text-xl font-bold text-[#d4541e] ring-1 ring-[#f4c4ad]">
            <span className="text-2xl leading-none">⚠</span>
            اختناق: {STAGE_LABELS[P.bottleneck] ?? P.bottleneck} · {P.wip[P.bottleneck]} عالق
          </div>
        ) : (
          <div>
            <span className="font-[Cairo] text-5xl font-black tabular-nums text-[#F47B42]">{fmtNum(total)}</span>
            <span className="ms-2 text-lg font-semibold text-[#9a6a3a]">قطعة قيد العمل</span>
          </div>
        )
      }
    >
      <div className="flex h-full items-end gap-4">
        {rows.map((r) => {
          const h = 14 + (r.v / max) * 86; // % of column height
          return (
            <div key={r.key} className="flex h-full flex-1 flex-col items-center justify-end gap-3">
              <span
                className="font-[Cairo] text-4xl font-black tabular-nums"
                style={{ color: r.bottle ? "#d4541e" : "#5a3210" }}
              >
                {r.v}
              </span>
              <div className="flex w-full flex-1 items-end">
                <div
                  className={`w-full rounded-t-2xl transition-all duration-700 ${r.bottle ? "tv-pulse" : ""}`}
                  style={{
                    height: `${h}%`,
                    background: r.bottle
                      ? "linear-gradient(180deg,#ef4444,#d4541e)"
                      : `linear-gradient(180deg,${r.color},${r.color}cc)`,
                    boxShadow: r.bottle
                      ? "0 0 26px rgba(239,68,68,.5)"
                      : "0 8px 22px -10px rgba(244,123,66,.5)",
                  }}
                />
              </div>
              <span className="text-center text-lg font-bold text-[#7a4e22]">{r.label}</span>
            </div>
          );
        })}
      </div>
    </SceneFrame>
  );
}

// ─────────────────────────── 3) Orders trend (counts only) ────────────────────
export function TrendScene({ data }: { data: TvSnapshot }) {
  const series = data.graphs.series;
  const rangeLabel = data.range === "today" ? "اليوم (بالساعة)" : data.range === "7" ? "آخر ٧ أيام" : "آخر ٣٠ يوم";
  const totalIn = series.reduce((a, p) => a + (p.orders_in || 0), 0);
  const totalDone = series.reduce((a, p) => a + (p.done || 0), 0);
  return (
    <SceneFrame
      kicker="التدفّق"
      title="الطلبات: وارد مقابل مُسلَّم"
      right={
        <div className="flex items-center gap-6">
          <div>
            <div className="text-base font-semibold text-[#9a6a3a]">وارد</div>
            <div className="font-[Cairo] text-4xl font-black tabular-nums text-[#F47B42]">{fmtNum(totalIn)}</div>
          </div>
          <div>
            <div className="text-base font-semibold text-[#9a6a3a]">مُسلَّم</div>
            <div className="font-[Cairo] text-4xl font-black tabular-nums text-[#16A34A]">{fmtNum(totalDone)}</div>
          </div>
          <span className="rounded-full bg-[#FFE4C4] px-3 py-1 text-sm font-bold text-[#7a4e22]">{rangeLabel}</span>
        </div>
      }
    >
      <div className="tv-well h-full p-5">
        {series.length ? (
          <ResponsiveContainer>
            <AreaChart data={series} margin={{ top: 10, right: 16, left: -10, bottom: 4 }}>
              <defs>
                <linearGradient id="scIn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="scDone" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={GREEN} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} />
              <YAxis tick={AXIS} tickLine={false} width={34} />
              <Tooltip contentStyle={TIP} />
              <Area type="monotone" dataKey="orders_in" name="وارد" stroke={ACCENT} fill="url(#scIn)" strokeWidth={3} dot={false} />
              <Area type="monotone" dataKey="done" name="مُسلَّم" stroke={GREEN} fill="url(#scDone)" strokeWidth={3} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <Empty />
        )}
      </div>
    </SceneFrame>
  );
}

// ─────────────────────────── 4) Conquest map + governorate bars ───────────────
export function MapScene({ data }: { data: TvSnapshot }) {
  const provinces = Object.entries(data.map.gov)
    .map(([key, v]) => ({ name: GOVS[key]?.name ?? key, value: v }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 9);
  return (
    <SceneFrame kicker="الانتشار" title="خريطة الفتح — العراق">
      <div className="grid h-full grid-cols-[1.15fr_1fr] gap-6">
        <div className="tv-well flex min-h-0 items-center justify-center p-4">
          <IraqMap gov={data.map.gov} home={data.map.home} target={data.map.target} />
        </div>
        <div className="tv-panel flex min-h-0 flex-col p-6">
          <h3 className="mb-3 font-[Amiri] text-2xl font-bold text-[#5a3210]">الطلبات حسب المحافظة</h3>
          <div className="min-h-0 flex-1">
            {provinces.length ? (
              <ResponsiveContainer>
                <BarChart data={provinces} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={AXIS} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ ...AXIS, fontSize: 16 }} width={104} tickLine={false} />
                  <Tooltip contentStyle={TIP} cursor={{ fill: GRID }} />
                  <Bar dataKey="value" name="طلبات" fill={GOLD} radius={[0, 10, 10, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty />
            )}
          </div>
        </div>
      </div>
    </SceneFrame>
  );
}

// ─────────────────────────── 5) Lifetime reach (brag, non-money) ──────────────
export function ReachScene({ data }: { data: TvSnapshot }) {
  const lt = data.lifetime;
  const rank = data.rank;
  const rec = data.records;
  const brag = lt
    ? [
        { label: "خريج تخرّج معنا", value: lt.graduates, icon: "🎓" },
        { label: "طلب على الإطلاق", value: lt.total_orders, icon: "🧾" },
        { label: "طلب مُسلَّم", value: lt.delivered_total, icon: "📦" },
        { label: "جامعة وصلنا إليها", value: lt.universities_count, icon: "🏛️" },
      ]
    : [];
  const unis = (lt?.universities ?? []).slice(0, 6);
  return (
    <SceneFrame
      kicker="بصمتنا"
      title="أثرنا منذ البداية"
      right={
        rank ? (
          <div className="flex items-center gap-2 rounded-full bg-gradient-to-r from-[#FFB100] to-[#F47B42] px-5 py-2 text-white shadow-[0_8px_20px_-10px_rgba(244,123,66,.9)]">
            <span className="text-xl">👑</span>
            <span className="font-[Amiri] text-2xl font-extrabold">{rank.label}</span>
          </div>
        ) : undefined
      }
    >
      <div className="flex h-full flex-col gap-6">
        <div className="grid flex-1 grid-cols-4 gap-6">
          {brag.map((b) => (
            <div key={b.label} className="tv-panel flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-[#FFFAF3] to-[#FFF0DD] px-4 text-center">
              <span className="text-4xl">{b.icon}</span>
              <CountUp value={b.value} className="font-[Cairo] text-[4.5rem] font-black leading-none tabular-nums text-[#F47B42]" />
              <span className="text-lg font-semibold text-[#9a6a3a]">{b.label}</span>
            </div>
          ))}
          {!brag.length && <div className="col-span-4"><Empty /></div>}
        </div>
        <div className="grid grid-cols-[1.3fr_1fr] gap-6">
          {/* rank ladder */}
          <div className="tv-panel flex flex-col justify-center gap-3 px-8 py-6">
            {rank ? (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="font-[Amiri] text-2xl font-bold text-[#5a3210]">الرتبة: {rank.label}</span>
                  {rank.next_label ? (
                    <span className="text-lg font-semibold text-[#9a6a3a]">
                      المتبقّي لرتبة «{rank.next_label}»: {fmtNum(rank.to_next)} طلب
                    </span>
                  ) : (
                    <span className="text-lg font-bold text-[#F47B42]">أعلى رتبة 🏆</span>
                  )}
                </div>
                <div className="h-5 overflow-hidden rounded-full bg-[#F0DCC4]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#FFB100] to-[#F47B42] transition-all duration-700"
                    style={{ width: `${rank.progress}%` }}
                  />
                </div>
                {rec && (rec.streak > 0 || rec.best_day_orders > 0) && (
                  <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-base text-[#7a4e22]">
                    {rec.streak > 0 && <span>🔥 سلسلة {fmtNum(rec.streak)} يوم متتالٍ</span>}
                    {rec.best_day_orders > 0 && (
                      <span>📈 أفضل يوم: {fmtNum(rec.best_day_orders)} طلب {rec.best_day_date ? `(${dmToAr(rec.best_day_date)})` : ""}</span>
                    )}
                    {rec.best_month_orders > 0 && (
                      <span>🗓️ أفضل شهر: {fmtNum(rec.best_month_orders)} طلب {rec.best_month ? `(${ymToAr(rec.best_month)})` : ""}</span>
                    )}
                  </div>
                )}
              </>
            ) : (
              <Empty />
            )}
          </div>
          {/* top universities */}
          <div className="tv-panel flex flex-col px-6 py-5">
            <h3 className="mb-2 font-[Amiri] text-xl font-bold text-[#5a3210]">أبرز الجامعات</h3>
            <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5">
              {unis.map((u, i) => (
                <div key={u.name} className="flex items-center justify-between text-[#5a3210]">
                  <span className="truncate font-semibold">{["🥇", "🥈", "🥉"][i] || `${i + 1}.`} {u.name}</span>
                  <span className="font-[Cairo] font-extrabold text-[#F47B42]">{fmtNum(u.count)}</span>
                </div>
              ))}
              {!unis.length && <p className="text-center text-[#b59673]">لا بيانات بعد</p>}
            </div>
          </div>
        </div>
      </div>
    </SceneFrame>
  );
}

// ─────────────────────────── 6) Deadlines & staff ─────────────────────────────
export function DeadlineStaffScene({ data }: { data: TvSnapshot }) {
  return (
    <SceneFrame kicker="السباق" title="المواعيد وفريق العمل">
      <div className="flex h-full flex-col gap-5">
        <div>
          <h3 className="mb-2 font-[Amiri] text-2xl font-bold text-[#5a3210]">⏳ مواعيد نهائية قادمة</h3>
          <DeadlineWall items={data.deadlines} />
        </div>
        <div className="tv-well min-h-0 flex-1 p-5">
          <StaffWatch staff={data.staff} leaderboard={data.leaderboard} />
        </div>
      </div>
    </SceneFrame>
  );
}

// ─────────────────────────── 7) Design spotlight ──────────────────────────────
export function SpotlightScene({ data }: { data: TvSnapshot }) {
  return (
    <SceneFrame kicker="المعرض" title="أحدث التصاميم المكتملة">
      <div className="tv-well h-full p-6">
        <Spotlight items={data.spotlight} />
      </div>
    </SceneFrame>
  );
}

function Empty() {
  return <div className="flex h-full items-center justify-center text-lg text-[#b59673]">لا توجد بيانات بعد</div>;
}
