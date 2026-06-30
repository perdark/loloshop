// Data layer for the admin TV command board (/tv/[key]). Plain fetch (no axios
// instance — the board has no JWT; the secret key is the only credential).

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:4000";

export type Source = "all" | "wholesaler" | "retail";
export type Range = "today" | "7" | "30";

export interface TvKpis {
  orders_today: number;
  orders_delta: number;
  revenue_today: number;
  revenue_delta: number;
  profit_today: number;
  delivered_today: number;
  delivered_delta: number;
}
export interface TvStaff {
  id: string;
  name: string;
  role: string[];
  presence: "present" | "late" | "absent" | "exempt";
  check_in_at: string | null;
  late_minutes: number;
  working_order: string | null;
  working_status: string | null;
  done_today: number;
  idle_minutes: number | null;
}
export interface TvSeriesPoint {
  label: string;
  orders_in: number;
  done: number;
  revenue: number;
  profit: number;
  productivity: number;
}
export interface TvTickerItem {
  id: string;
  action: string;
  at: string;
  status: string | null;
  actor: string | null;
  student: string | null;
  product: string | null;
  source: "retail" | "wholesaler" | null;
}
export interface TvSnapshot {
  generated_at: string;
  source: Source;
  range: string;
  kpis: TvKpis;
  pipeline: {
    wip: Record<string, number>;
    stages: string[];
    tailor_pending: number;
    bottleneck: string | null;
    bottleneck_active: boolean;
    threshold: number;
  };
  staff: TvStaff[];
  leaderboard: TvStaff[];
  map: { gov: Record<string, number>; home: string; target: string; reached: number };
  deadlines: { id: string; name: string; deadline: string; open_orders: number }[];
  spotlight: { id: string; image: string; student_name: string; university: string }[];
  ticker: TvTickerItem[];
  graphs: { byHour: boolean; series: TvSeriesPoint[]; universities: { name: string; count: number }[] };
  goal: { target: number | null; done_today: number };
  settings: { daily_goal: number | null; bottleneck_threshold: number; sound: boolean };
}

export function snapshotUrl(key: string, source: Source, range: Range): string {
  const s = source === "all" ? "" : `&source=${source}`;
  return `${API_BASE}/api/tv/snapshot?key=${encodeURIComponent(key)}${s}&range=${range}`;
}
export function eventsUrl(key: string): string {
  return `${API_BASE}/api/tv/events?key=${encodeURIComponent(key)}`;
}
export function assetUrl(path: string | null): string {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

export async function fetchSnapshot(
  key: string,
  source: Source,
  range: Range
): Promise<TvSnapshot> {
  const res = await fetch(snapshotUrl(key, source, range), { cache: "no-store" });
  if (!res.ok) throw new Error(`snapshot ${res.status}`);
  const json = await res.json();
  return json.data as TvSnapshot;
}

export async function saveSettings(
  key: string,
  patch: Partial<TvSnapshot["settings"]>
): Promise<void> {
  await fetch(`${API_BASE}/api/tv/settings?key=${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

// ---- pipeline presentation ----
export const STAGE_LABELS: Record<string, string> = {
  design_complete: "التصميم",
  converting: "التحويل",
  embroidery: "التطريز",
  pressing: "الكوي",
  preparing: "التجهيز",
  ready: "جاهز",
  delivered: "تم التسليم",
};
export const STAGE_COLORS: Record<string, string> = {
  design_complete: "#F59E0B",
  converting: "#FB923C",
  embroidery: "#F47B42",
  pressing: "#EA8C55",
  preparing: "#E8A317",
  ready: "#16A34A",
};

// ---- Iraq governorates: key → { name, x, y } on a 0..100 viewBox (east = right) ----
export const GOVS: Record<string, { name: string; x: number; y: number }> = {
  dohuk: { name: "دهوك", x: 42, y: 10 },
  nineveh: { name: "نينوى", x: 31, y: 21 },
  erbil: { name: "أربيل", x: 55, y: 17 },
  kirkuk: { name: "كركوك", x: 52, y: 31 },
  sulaymaniyah: { name: "السليمانية", x: 67, y: 27 },
  salahuddin: { name: "صلاح الدين", x: 44, y: 37 },
  diyala: { name: "ديالى", x: 61, y: 45 },
  anbar: { name: "الأنبار", x: 24, y: 48 },
  baghdad: { name: "بغداد", x: 52, y: 47 },
  babil: { name: "بابل", x: 47, y: 57 },
  karbala: { name: "كربلاء", x: 39, y: 58 },
  wasit: { name: "واسط", x: 63, y: 56 },
  najaf: { name: "النجف", x: 41, y: 69 },
  qadisiyah: { name: "القادسية", x: 53, y: 66 },
  maysan: { name: "ميسان", x: 71, y: 66 },
  muthanna: { name: "المثنى", x: 52, y: 81 },
  dhiqar: { name: "ذي قار", x: 62, y: 76 },
  basra: { name: "البصرة", x: 75, y: 83 },
};
// A stylised Iraq silhouette in the same 0..100 space.
export const IRAQ_OUTLINE =
  "M40,6 L58,11 L70,25 L66,39 L73,52 L78,70 L80,87 L69,90 L55,84 L49,87 L39,78 L29,66 L17,52 L20,39 L30,29 L33,17 Z";

// ---- formatting ----
const IQD = new Intl.NumberFormat("ar-IQ", { maximumFractionDigits: 0 });
export function fmtNum(n: number): string {
  return IQD.format(Math.round(n || 0));
}
export function fmtIQD(n: number): string {
  return `${IQD.format(Math.round(n || 0))} د.ع`;
}
export function timeAgoAr(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "الآن";
  if (m < 60) return `قبل ${m}د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `قبل ${h}س`;
  return `قبل ${Math.floor(h / 24)}ي`;
}
// A short Arabic ticker line from an event.
export function tickerLine(t: TvTickerItem): string {
  const who = t.actor || "موظف";
  const stage = t.status ? STAGE_LABELS[t.status] || t.status : "";
  const stu = t.student || "طالب";
  if (t.status === "delivered") return `🎉 تم تسليم طلب ${stu}`;
  if (t.action === "status_change") return `${who} نقل ${stu} إلى ${stage}`;
  if (t.action === "approve_design") return `${who} اعتمد تصميم ${stu}`;
  if (t.action === "reject_design") return `${who} أعاد تصميم ${stu}`;
  return `${stu} • ${t.product || ""}`;
}

// ---- celebration: dependency-free confetti + a WebAudio chime ----
export function fireConfetti(): void {
  if (typeof document === "undefined") return;
  const colors = ["#FFB100", "#FFA07A", "#F47B42", "#FFDAB9", "#16A34A", "#FFE4E1"];
  const n = 120;
  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden";
  document.body.appendChild(root);
  for (let i = 0; i < n; i++) {
    const p = document.createElement("div");
    const size = 6 + Math.random() * 8;
    const left = Math.random() * 100;
    const dur = 2200 + Math.random() * 1600;
    const delay = Math.random() * 250;
    const rot = Math.random() * 360;
    p.style.cssText = `position:absolute;top:-20px;left:${left}vw;width:${size}px;height:${
      size * 0.6
    }px;background:${colors[i % colors.length]};opacity:.95;border-radius:2px;transform:rotate(${rot}deg);animation:tvfall ${dur}ms cubic-bezier(.3,.7,.4,1) ${delay}ms forwards`;
    root.appendChild(p);
  }
  setTimeout(() => root.remove(), 4200);
}

let _audioCtx: AudioContext | null = null;
let _audioUnlocked = false;
export function unlockAudio(): void {
  if (_audioUnlocked || typeof window === "undefined") return;
  try {
    const Ctx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    _audioCtx = new Ctx();
    _audioUnlocked = true;
  } catch {
    /* no audio */
  }
}
export function chime(): void {
  if (!_audioCtx) return;
  const ctx = _audioCtx;
  const now = ctx.currentTime;
  [880, 1320, 1760].forEach((freq, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, now + i * 0.09);
    g.gain.linearRampToValueAtTime(0.18, now + i * 0.09 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.5);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(now + i * 0.09);
    o.stop(now + i * 0.09 + 0.55);
  });
}
