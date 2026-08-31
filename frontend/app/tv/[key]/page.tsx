"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  Celebration,
  Header,
  Sidebar,
  Ticker,
  type HeroView,
  type SceneKey,
} from "@/components/tv/Panels";
import {
  DeadlineStaffScene,
  MapScene,
  PipelineScene,
  PulseScene,
  ReachScene,
  SpotlightScene,
  TrendScene,
} from "@/components/tv/Scenes";
import { MoneyScene } from "@/components/tv/FullGraphs";
import { MoneyRevealTrigger } from "@/components/MoneyRevealTrigger";

const SOURCE_CYCLE: Source[] = ["all", "wholesaler", "retail"];
const SOURCE_MS = 22000;
const SCENE_MS = 17000;
const POLL_MS = 3000;
const REVEAL_MS = 90000; // money auto-hides 90s after reveal

// The default (money-free) scene order for the cinema.
const BASE_ORDER: SceneKey[] = ["pulse", "pipeline", "trend", "map", "reach", "deadlines", "spotlight"];

// Client-side money strip — mirrors the backend's stripMoney. When the reveal is
// dropped we still cross-fade the outgoing money scene over ~760ms; without this the
// stale `data` (money_visible:true, real figures) could flash for that window. Nulling
// the monetary fields locally guarantees no frame renders numbers after hide.
function stripMoneyClient(d: TvSnapshot): TvSnapshot {
  return {
    ...d,
    money_visible: false,
    kpis: { ...d.kpis, revenue_today: null, revenue_delta: null, profit_today: null },
    graphs: {
      ...d.graphs,
      series: d.graphs.series.map((p) => ({ ...p, revenue: null, profit: null })),
    },
    ...(d.lifetime ? { lifetime: { ...d.lifetime, revenue_total: null } } : {}),
    ...(d.records ? { records: { ...d.records, best_day_revenue: null } } : {}),
    ...(d.growth ? { growth: { ...d.growth, this_year_rev: null, last_year_rev: null } } : {}),
  };
}

function renderScene(k: SceneKey, d: TvSnapshot) {
  switch (k) {
    case "pulse":
      return <PulseScene data={d} />;
    case "pipeline":
      return <PipelineScene data={d} />;
    case "trend":
      return <TrendScene data={d} />;
    case "map":
      return <MapScene data={d} />;
    case "reach":
      return <ReachScene data={d} />;
    case "deadlines":
      return <DeadlineStaffScene data={d} />;
    case "spotlight":
      return <SpotlightScene data={d} />;
    case "money":
      // Never leak money if the reveal expired mid-transition.
      return d.money_visible ? <MoneyScene data={d} /> : <PulseScene data={d} />;
    default:
      return <PulseScene data={d} />;
  }
}

export default function TvBoardPage() {
  const params = useParams();
  const key = (Array.isArray(params.key) ? params.key[0] : params.key) || "";

  const [data, setData] = useState<TvSnapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "denied" | "error">("loading");

  // rotation + manual pins
  const [rotSrcIdx, setRotSrcIdx] = useState(0);
  const [autoIdx, setAutoIdx] = useState(0);
  const [pinnedSource, setPinnedSource] = useState<Source | null>(null);
  const [pinnedView, setPinnedView] = useState<HeroView>("auto");
  const [range, setRange] = useState<Range>("today");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [celebrate, setCelebrate] = useState<{ id: number; student: string; university?: string } | null>(null);

  // money reveal (kept in memory only; re-locks on refresh)
  const [revealSecret, setRevealSecret] = useState<string | null>(null);
  const revealed = !!revealSecret;
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const source: Source = pinnedSource ?? SOURCE_CYCLE[rotSrcIdx];

  const lastDeliveredRef = useRef<string | null>(null);
  const soundRef = useRef(true);

  // ---- load ----
  const load = useCallback(async () => {
    try {
      const snap = await fetchSnapshot(key, source, range, revealSecret ?? undefined);
      setData(snap);
      setStatus("ok");
      soundRef.current = snap.settings.sound;
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
  }, [key, source, range, revealSecret]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // SSE live push → debounced refetch
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
      /* no SSE → the 3s poll keeps it live */
    }
    return () => {
      if (deb) clearTimeout(deb);
      es?.close();
    };
  }, [key, status, load]);

  // source auto-rotation (skips when pinned)
  useEffect(() => {
    if (pinnedSource) return;
    const t = setInterval(() => setRotSrcIdx((i) => (i + 1) % SOURCE_CYCLE.length), SOURCE_MS);
    return () => clearInterval(t);
  }, [pinnedSource]);

  // scene auto-advance (skips when a scene is pinned)
  useEffect(() => {
    if (pinnedView !== "auto") return;
    const t = setInterval(() => setAutoIdx((i) => i + 1), SCENE_MS);
    return () => clearInterval(t);
  }, [pinnedView]);

  // unlock WebAudio on first interaction
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

  // scale-to-fit: authored at 1920×1080, scaled to the real screen.
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // ---- scene rotation list (money scene slotted in only when revealed) ----
  const scenes = useMemo<SceneKey[]>(() => {
    if (!data) return BASE_ORDER;
    const list = BASE_ORDER.filter((k) => {
      if (k === "spotlight") return data.spotlight.length > 0;
      if (k === "reach") return !!data.lifetime;
      return true;
    });
    if (revealed && data.money_visible) {
      const out: SceneKey[] = [];
      for (const k of list) {
        out.push(k);
        if (k === "trend") out.push("money");
      }
      if (!out.includes("money")) out.push("money");
      return out;
    }
    return list;
  }, [data, revealed]);

  const activeKey: SceneKey =
    pinnedView !== "auto" ? (pinnedView as SceneKey) : scenes[autoIdx % scenes.length] ?? "pulse";

  // ---- cross-fade between scenes ----
  const [displayKey, setDisplayKey] = useState<SceneKey>("pulse");
  const [prevKey, setPrevKey] = useState<SceneKey | null>(null);
  useEffect(() => {
    if (activeKey === displayKey) return;
    setPrevKey(displayKey);
    setDisplayKey(activeKey);
    const t = setTimeout(() => setPrevKey(null), 760);
    return () => clearTimeout(t);
  }, [activeKey, displayKey]);

  // ---- money reveal handlers ----
  const armHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setRevealSecret(null);
      // Strip money from the current data too, so no frame shows numbers during the fade.
      setData((d) => (d ? stripMoneyClient(d) : d));
      setPinnedView("auto");
      hideTimerRef.current = null;
    }, REVEAL_MS);
  }, []);
  const hideMoney = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setRevealSecret(null);
    // Strip money from the current data too, so no frame shows numbers during the fade.
    setData((d) => (d ? stripMoneyClient(d) : d));
    setPinnedView("auto");
  }, []);
  const onRevealSubmit = useCallback(
    async (secret: string): Promise<boolean> => {
      try {
        const snap = await fetchSnapshot(key, source, range, secret);
        if (snap.money_visible) {
          setRevealSecret(secret);
          setData(snap);
          setPinnedView("money");
          armHide();
          return true;
        }
      } catch {
        /* fall through → stays locked */
      }
      return false;
    },
    [key, source, range, armHide]
  );
  useEffect(() => () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, []);

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
      <main className="flex min-h-dvh items-center justify-center bg-[#FAEBD7]" dir="rtl">
        <div className="text-center">
          <h1 className="font-[Cairo] text-6xl font-black text-[#5a3210]">٤٠٤</h1>
          <p className="mt-2 text-xl text-[#9a6a3a]">الصفحة غير موجودة</p>
        </div>
      </main>
    );
  }
  if (status === "loading" || !data) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#FAEBD7]" dir="rtl">
        <div className="text-center">
          <div className="text-5xl">◈</div>
          <p className="mt-3 animate-pulse font-[Amiri] text-2xl text-[#7a4e22]">جارٍ تحميل لوحة المتابعة…</p>
        </div>
      </main>
    );
  }

  return (
    <div
      dir="rtl"
      className="fixed inset-0 flex items-center justify-center overflow-hidden bg-[#EFDABE] font-[Cairo]"
      style={{ filter: night ? "brightness(0.85)" : "none", transition: "filter 1s" }}
    >
      {/* board authored at a fixed 1920×1080, scaled to fit the real screen. */}
      <div
        className="flex flex-col bg-gradient-to-br from-[#F4E6CF] via-[#FAEEDB] to-[#EFDABE] px-10 py-7"
        style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: "center center" }}
      >
        <Header
          source={source}
          kpis={data.kpis}
          audienceNow={data.audience?.now ?? 0}
          activeBatches={data.deadlines.length}
          ownerTitle={data.settings.owner_title}
        />

        {/* the cinema stage — scenes cross-fade here */}
        <div className="relative mt-6 min-h-0 flex-1">
          {prevKey && prevKey !== displayKey && (
            <div key={`p-${prevKey}`} className="tv-scene-layer tv-scene-out">
              {renderScene(prevKey, data)}
            </div>
          )}
          <div key={`c-${displayKey}`} className="tv-scene-layer tv-scene-in">
            {renderScene(displayKey, data)}
          </div>
        </div>

        {/* footer — live event ticker */}
        <div className="mt-5">
          <Ticker items={data.ticker} />
        </div>
      </div>

      {/* controls — NOT scaled; anchored to the real viewport */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed bottom-5 left-5 z-[9980] flex h-14 w-14 items-center justify-center rounded-full bg-[#F47B42] text-2xl text-white shadow-xl transition hover:scale-105"
        aria-label="فتح لوحة التحكم"
      >
        ☰
      </button>

      {/* disguised money reveal — a discreet 🎓 chip in the top corner */}
      <div className="fixed left-4 top-4 z-[9985]">
        <MoneyRevealTrigger
          position="inline"
          revealed={revealed}
          onSubmit={onRevealSubmit}
          onRevealed={armHide}
          onHide={hideMoney}
        />
      </div>

      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        revealed={revealed}
        source={source}
        onSource={(s) => setPinnedSource(s)}
        view={pinnedView}
        onView={(v) => {
          if (v === "auto") {
            setPinnedView("auto");
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
