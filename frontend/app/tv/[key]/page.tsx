"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  chime,
  eventsUrl,
  fetchSnapshot,
  fireConfetti,
  saveSettings,
  unlockAudio,
  type Range,
  type Source,
  type TvSnapshot,
} from "@/lib/tv";
import { IraqMap } from "@/components/tv/IraqMap";
import { FullGraphs } from "@/components/tv/FullGraphs";
import {
  Celebration,
  GoalRing,
  Graphs,
  Header,
  KpiStrip,
  RevenueOdometer,
  Sidebar,
  Spotlight,
  StaffWatch,
  type HeroView,
} from "@/components/tv/Panels";

const SOURCE_CYCLE: Source[] = ["all", "wholesaler", "retail"];
const HERO_CYCLE: Exclude<HeroView, "auto">[] = ["staff", "graphs", "map", "spotlight"];
const SOURCE_MS = 22000;
const HERO_MS = 13000;
const POLL_MS = 3000;

export default function TvBoardPage() {
  const params = useParams();
  const key = (Array.isArray(params.key) ? params.key[0] : params.key) || "";

  const [data, setData] = useState<TvSnapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "denied" | "error">("loading");

  // rotation + manual pins
  const [rotSrcIdx, setRotSrcIdx] = useState(0);
  const [rotViewIdx, setRotViewIdx] = useState(0);
  const [pinnedSource, setPinnedSource] = useState<Source | null>(null);
  const [pinnedView, setPinnedView] = useState<Exclude<HeroView, "auto"> | null>(null);
  const [range, setRange] = useState<Range>("today");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showGraphs, setShowGraphs] = useState(false);
  const [celebrate, setCelebrate] = useState<{ id: number; student: string; university?: string } | null>(null);

  const source: Source = pinnedSource ?? SOURCE_CYCLE[rotSrcIdx];
  const view: Exclude<HeroView, "auto"> = pinnedView ?? HERO_CYCLE[rotViewIdx];

  const lastDeliveredRef = useRef<string | null>(null);
  const soundRef = useRef(true);

  // ---- load ----
  const load = useCallback(async () => {
    try {
      const snap = await fetchSnapshot(key, source, range);
      setData(snap);
      setStatus("ok");
      soundRef.current = snap.settings.sound;
      // celebration: detect a new delivered event in the ticker
      const delivered = snap.ticker.find((t) => t.status === "delivered");
      if (delivered) {
        if (lastDeliveredRef.current === null) {
          lastDeliveredRef.current = delivered.id;
        } else if (delivered.id !== lastDeliveredRef.current) {
          lastDeliveredRef.current = delivered.id;
          setCelebrate({ id: Date.now(), student: delivered.student || "طالب" });
          fireConfetti();
          if (soundRef.current) chime();
        }
      }
    } catch (e) {
      const msg = String((e as Error).message || "");
      setStatus(msg.includes("404") ? "denied" : "error");
    }
  }, [key, source, range]);

  // refetch on source/range change + 3s heartbeat poll
  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // SSE live push → immediate (debounced) refetch
  useEffect(() => {
    if (status === "denied" || !key) return;
    let es: EventSource | null = null;
    let deb: ReturnType<typeof setTimeout> | null = null;
    try {
      es = new EventSource(eventsUrl(key));
      es.onmessage = () => {
        if (deb) clearTimeout(deb);
        deb = setTimeout(load, 500);
      };
    } catch {
      /* TV without SSE → the 3s poll keeps it live */
    }
    return () => {
      if (deb) clearTimeout(deb);
      es?.close();
    };
  }, [key, status, load]);

  // source / hero auto-rotation (skips when pinned)
  useEffect(() => {
    if (pinnedSource) return;
    const t = setInterval(() => setRotSrcIdx((i) => (i + 1) % SOURCE_CYCLE.length), SOURCE_MS);
    return () => clearInterval(t);
  }, [pinnedSource]);
  useEffect(() => {
    if (pinnedView) return;
    const t = setInterval(() => setRotViewIdx((i) => (i + 1) % HERO_CYCLE.length), HERO_MS);
    return () => clearInterval(t);
  }, [pinnedView]);

  // unlock WebAudio on first interaction (TV autoplay rule)
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("pointermove", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("pointermove", unlock);
    };
  }, []);

  // day/night dim
  const [night, setNight] = useState(false);
  useEffect(() => {
    const check = () => {
      const h = new Date().getHours();
      setNight(h >= 21 || h < 6);
    };
    check();
    const t = setInterval(check, 60000);
    return () => clearInterval(t);
  }, []);

  // scale-to-fit: the board is authored at a fixed 1920×1080 and scaled to the
  // real screen, so it looks identical and never clips on any TV/panel size.
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // auto whole-page takeover: hold on the board, then fade to the fullscreen
  // graphs page, hold, then fade back. Loops forever.
  useEffect(() => {
    const ms = showGraphs ? 20000 : 45000;
    const t = setTimeout(() => setShowGraphs((s) => !s), ms);
    return () => clearTimeout(t);
  }, [showGraphs]);

  const onSettings = useCallback(
    async (patch: Partial<TvSnapshot["settings"]>) => {
      setData((d) => (d ? { ...d, settings: { ...d.settings, ...patch } } : d));
      await saveSettings(key, patch);
      load();
    },
    [key, load]
  );

  const fullscreen = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  };

  if (status === "denied") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#FAEBD7]" dir="rtl">
        <div className="text-center">
          <h1 className="font-[Cairo] text-6xl font-black text-[#5a3210]">٤٠٤</h1>
          <p className="mt-2 text-xl text-[#9a6a3a]">الصفحة غير موجودة</p>
        </div>
      </main>
    );
  }
  if (status === "loading" || !data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#FAEBD7]" dir="rtl">
        <div className="text-center">
          <div className="text-5xl">◈</div>
          <p className="mt-3 animate-pulse font-[Amiri] text-2xl text-[#7a4e22]">جارٍ تحميل لوحة المتابعة…</p>
        </div>
      </main>
    );
  }

  const heroEl =
    view === "graphs" ? (
      <Graphs g={data.graphs} />
    ) : view === "map" ? (
      <IraqMap gov={data.map.gov} home={data.map.home} target={data.map.target} />
    ) : view === "spotlight" ? (
      <Spotlight items={data.spotlight} />
    ) : (
      <StaffWatch staff={data.staff} leaderboard={data.leaderboard} />
    );

  return (
    <div
      dir="rtl"
      className="fixed inset-0 flex items-center justify-center overflow-hidden bg-[#FAEBD7] font-[Cairo]"
      style={{ filter: night ? "brightness(0.85)" : "none", transition: "filter 1s" }}
    >
      {/* board authored at a fixed 1920×1080, scaled to fit the real screen.
          Spacing rhythm is deliberate: generous breaks BETWEEN zones
          (header → scoreboard → work grid), tighter gaps WITHIN. */}
      <div
        className="flex flex-col bg-gradient-to-br from-[#F4E6CF] via-[#FAEEDB] to-[#EFDABE] px-10 py-8"
        style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: "center center" }}
      >
        <Header source={source} />

        <div className="mt-7">
          <KpiStrip k={data.kpis} />
        </div>

        <div className="mt-8 grid min-h-0 flex-1 grid-cols-[1fr_404px] grid-rows-[minmax(0,1fr)] gap-6">
          <div className="flex min-h-0 flex-col gap-5">
            <div className="tv-panel p-6" style={{ background: "#f6f5f3", borderColor: "#e4e2dd" }}>
              {(() => {
                const P = data.pipeline;
                const LABELS: Record<string, string> = { design_complete: "التصميم", converting: "التحويل", embroidery: "التطريز", pressing: "الكوي", preparing: "التجهيز", ready: "جاهز" };
                const rows = [...P.stages.map((s) => ({ key: s, label: LABELS[s] ?? s, v: P.wip[s] || 0, bottle: P.bottleneck === s && P.bottleneck_active })), { key: "tailor", label: "الفصال", v: P.tailor_pending, bottle: false }];
                const max = Math.max(1, ...rows.map((r) => r.v));
                return (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-baseline gap-2.5">
                        <h3 className="font-[Amiri] text-2xl font-bold text-[#2b2b30]">خط الإنتاج</h3>
                        <span className="text-sm font-semibold text-[#8a8694]">قيد التنفيذ الآن</span>
                      </div>
                      {P.bottleneck_active && P.bottleneck && (
                        <div className="rounded-full bg-[#fff1ec] px-4 py-1.5 text-sm font-bold text-[#d4541e] ring-1 ring-[#f4c4ad]">⚠ اختناق: {LABELS[P.bottleneck] ?? P.bottleneck} · {P.wip[P.bottleneck]} عالق</div>
                      )}
                    </div>
                    <div className="flex flex-col gap-[11px]">
                      {rows.map((r) => (
                        <div key={r.key} className="flex items-center gap-3">
                          <span className="w-14 shrink-0 text-sm font-semibold text-[#56555e]">{r.label}</span>
                          <div className="relative h-6 flex-1 overflow-hidden rounded-lg bg-[#e7e4dd]">
                            <div className="absolute inset-y-0 right-0 rounded-lg transition-all" style={{ width: `${Math.max(3, (r.v / max) * 100)}%`, background: r.bottle ? "linear-gradient(90deg,#f0531d,#d4541e)" : "#3a3a42" }} />
                          </div>
                          <span className="w-10 shrink-0 text-end font-[Cairo] text-lg font-extrabold tabular-nums" style={{ color: r.bottle ? "#d4541e" : "#2b2b30" }}>{r.v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="tv-panel min-h-0 flex-1 overflow-hidden p-6">
              {heroEl}
            </div>
          </div>
          <div className="flex min-h-0 flex-col gap-5">
            <RevenueOdometer value={data.kpis.revenue_today} />
            <GoalRing done={data.goal.done_today} target={data.goal.target} />
          </div>
        </div>
      </div>

      {/* fullscreen graphs takeover — premium cross-fade over the board, then back */}
      <div
        className={`pointer-events-none fixed inset-0 z-[40] transition-all duration-700 ${
          showGraphs ? "scale-100 opacity-100 blur-0" : "scale-[1.04] opacity-0 blur-sm"
        }`}
        aria-hidden={!showGraphs}
      >
        <FullGraphs data={data} />
      </div>

      {/* controls — NOT scaled; anchored to the real viewport */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed bottom-5 left-5 z-[9980] flex h-14 w-14 items-center justify-center rounded-full bg-[#F47B42] text-2xl text-white shadow-xl transition hover:scale-105"
        aria-label="فتح لوحة التحكم"
      >
        ☰
      </button>

      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        source={source}
        onSource={(s) => setPinnedSource(s)}
        view={pinnedView ?? "auto"}
        onView={(v) => {
          if (v === "auto") {
            setPinnedView(null);
            setPinnedSource(null);
          } else {
            setPinnedView(v);
          }
        }}
        range={range}
        onRange={setRange}
        settings={data.settings}
        onSettings={onSettings}
        onFullscreen={fullscreen}
      />

      <Celebration event={celebrate} />
    </div>
  );
}
