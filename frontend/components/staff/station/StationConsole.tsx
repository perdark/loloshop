"use client";

// «منصّة المحطة» — shared work console for التطريز · الفصال · الكوي with two view
// modes (user decision 2026-07-16, spec docs/superpowers/specs/2026-07-16-*):
//   «عرض بالطلب»  — students list → tap → sheet with the student's pieces
//                    (zone checkboxes for التطريز, one إكمال per piece otherwise).
//   «عرض بالقطع»  — flat work items: zone chips (التطريز) or piece-type chips
//                    (الفصال/الكوي) + tap-to-select rows + sticky bulk bar.
// All completion rules stay backend-owned: zone ticks auto-advance server-side,
// الكوي rows carry a backend-granted can_advance, الفصال stays the parallel track.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import {
  advanceBulk,
  advanceOrder,
  getQueue,
  getTailorQueue,
  markEmbroideryZone,
  markEmbroideryZoneBulk,
  tailorComplete,
  tailorCompleteBulk,
  tailorReopen,
  type TailorOrderRow,
} from "@/lib/staff";
import type { ProductionQueueItem, StationZone } from "@/lib/staff-types";
// رف التجهيز: after الكوي pushes a piece to التجهيز, offer its خانة immediately (D6).
// The advance has ALREADY succeeded when this opens — shelving is never a blocker.
import { getShelfBoard, placePiece, type ShelfBoard, type ShelfInboxItem } from "@/lib/shelf";
import { PlaceSheet } from "@/components/staff/shelf/PlaceSheet";
import { PRODUCT_TYPE_LABELS, STUDY_TYPE_LABELS, ORDER_STATUS_LABELS } from "@/lib/constants";
import { usePolling } from "@/lib/hooks/usePolling";
import { useProductionEvents } from "@/hooks/useProductionEvents";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StudentSheet } from "./StudentSheet";
import { Lightbox } from "./Lightbox";
import { matchesAr } from "@/lib/arabic";
import { SearchField } from "@/components/ui/SearchField";
import {
  advancedLabelFor,
  isPieceOverdue,
  resolveUploadUrl,
  type AdvancedGhost,
  type StationKind,
  type StationPiece,
} from "./types";

// ─── Per-station copy ─────────────────────────────────────────────────────────
// NOTE: التجهيز is a StationKind (it reuses StudentSheet) but is NOT served by this
// console — components/staff/prep/PrepConsole.tsx drives it, because its queue is a
// status filter (قيد التجهيز / جاهزة) rather than the عرض بالطلب / عرض بالقطع modes here.
type ConsoleKind = Exclude<StationKind, "preparing">;

const META: Record<ConsoleKind, { title: string; subtitle: string; empty: string }> = {
  embroidery: {
    title: "قائمة التطريز",
    subtitle: "اشتغل طالباً بطالب، أو بالجملة منطقةً منطقة",
    empty: "لا توجد قطع بانتظار التطريز حالياً",
  },
  tailor: {
    title: "الفصال",
    subtitle: "فصال قطع التجزئة — يعمل بالتوازي مع خط الإنتاج",
    empty: "لا توجد قطع قيد الفصال حالياً",
  },
  pressing: {
    title: "قائمة الكوي",
    subtitle: "اشتغل طالباً بطالب، أو بالجملة حسب نوع القطعة",
    empty: "لا توجد قطع بانتظار الكوي حالياً",
  },
};

// The production line, in the order a piece walks it — mirrors the backend's LINE_VIEW_STAGES
// (productionController.js). Owner decision 2026-08-31: every line staff member sees and may
// move every stage except التصميم, so a station console is no longer one stage. This array is
// display order only; what a person may SEE is decided by the backend's stage list and what
// they may MOVE by each row's own `can_advance`.
const LINE_ORDER = ["converting", "embroidery", "assembly", "pressing", "preparing", "ready", "delivered"];

// Canonical zone order — mirrors the backend's ZONE_DEFS so chips read الوشاح → القبعة → الروب.
const ZONE_ORDER = [
  "sash_right",
  "sash_left",
  "sash_back",
  "sash_front",
  "cap_top",
  "cap_side",
  "robe_sleeve_right",
  "robe_sleeve_left",
];

type View = "students" | "pieces" | "done";

function typeLabel(t: string): string {
  return (PRODUCT_TYPE_LABELS as Record<string, string>)[t] ?? t;
}

// ─── Session persistence — «getting back perfectly» (user 2026-07-16) ─────────
// Opening التفاصيل navigates away and unmounts the console; on back the worker must
// land EXACTLY where they were (view, chip, checked boxes, filters, open sheet).
// UI state is mirrored to sessionStorage per station and restored on mount. Safe to
// lazy-init: the console only ever mounts client-side (behind the auth loading gate).
interface StoredConsoleState {
  view?: View;
  search?: string;
  sourceFilter?: "" | "retail" | "wholesaler";
  repFilter?: string;
  activeZone?: string;
  activeType?: string;
  activeStage?: string;
  selected?: string[];
  openStudentKey?: string | null;
}
const STORAGE_PREFIX = "loloshop-station:";

function readStored(kind: StationKind): StoredConsoleState {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_PREFIX + kind) || "{}") as StoredConsoleState;
  } catch {
    return {};
  }
}

// الفصال has no «عرض بالقطع» (user 2026-07-16) — students + المنجزة only.
function validView(kind: StationKind, v: View | undefined): View {
  if (kind === "tailor") return v === "done" ? "done" : "students";
  return v === "pieces" ? "pieces" : "students";
}

function queueToPiece(r: ProductionQueueItem, kind: StationKind): StationPiece {
  return {
    // The set view belongs to التجهيز, which packs; التطريز/الكوي work one piece at a time
    // and are never asked whether the طقم is whole.
    setPieces: null,
    id: r.id,
    studentId: r.student_id ?? r.student_name,
    studentName: r.student_name,
    productName: r.product_name,
    productType: r.product_type,
    productImageUrl: r.product_image_url ?? null,
    batchName: r.batch_name,
    wholesalerName: r.wholesaler_name,
    universityName: r.university_name,
    department: r.department,
    studyType: r.study_type ?? null,
    source: r.source,
    deadline: r.deadline,
    createdAt: r.created_at,
    // Zones are the التطريز checklist and only mean anything on a row that IS at التطريز.
    zones: r.status === "embroidery" ? r.zones ?? [] : null,
    // التجهيز's spec belongs to PrepConsole; this console serves التطريز/الكوي, which ask
    // "what do I stitch / press", not "which garment is this".
    spec: null,
    measurements: null,
    status: r.status,
    // The backend now computes can_advance for EVERY row it returns, so a piece the viewer
    // may not move (a sash whose zones are unticked, someone else's edge) simply arrives
    // false. The old rule — «التطريز rows are always completable» — was only safe while this
    // console showed nothing but its own stage.
    canComplete:
      r.status === "embroidery" && kind === "embroidery" ? true : !!r.can_advance,
    completeLabel:
      r.advance_label ??
      (r.status === "embroidery" ? "إكمال التطريز" : kind === "pressing" ? "إنهاء الكوي" : "إكمال"),
  };
}

function tailorToPiece(r: TailorOrderRow): StationPiece {
  return {
    // الفصال runs BESIDE the production line, not on it — a فصال row has no line stage, and
    // its own status lives in `tailor_status`. 'tailor' keeps it out of every stage chip.
    status: "tailor",
    setPieces: null, // الفصال sews one garment; it never packs a set.
    id: r.id,
    studentId: r.studentId ?? r.studentName,
    studentName: r.studentName,
    productName: r.productName,
    productType: r.productType,
    // الفصال reads a different endpoint (tailor queue) that carries no catalog photo.
    productImageUrl: null,
    batchName: r.batchName,
    wholesalerName: null,
    universityName: null,
    department: null,
    studyType: null,
    source: "retail",
    deadline: r.deadline,
    createdAt: r.createdAt,
    zones: null,
    spec: null,
    measurements: null,
    canComplete: true,
    completeLabel: "تم الفصال",
  };
}

interface StudentGroup {
  key: string;
  name: string;
  batchName: string | null;
  source: "retail" | "wholesaler";
  universityName: string | null;
  department: string | null;
  studyType: string | null;
  pieces: StationPiece[];
  zoneDone: number;
  zoneTotal: number;
  overdue: boolean;
}

/** جامعة · قسم · صباحي/مسائي — extra context for wholesaler students (never for الفصال: keep it simple). */
function studentInfoLine(g: Pick<StudentGroup, "source" | "universityName" | "department" | "studyType"> | null): string | null {
  if (!g || g.source !== "wholesaler") return null;
  const study = (STUDY_TYPE_LABELS as Record<string, string>)[g.studyType ?? ""] ?? null;
  const line = [g.universityName, g.department, study].filter(Boolean).join(" · ");
  return line || null;
}

// ─── The console ──────────────────────────────────────────────────────────────
export function StationConsole({
  kind,
  showSourceFilter = false,
}: {
  kind: ConsoleKind;
  showSourceFilter?: boolean;
}) {
  const pathname = usePathname() || "/staff";
  const meta = META[kind];

  // Restore the last UI state for this station (see StoredConsoleState above).
  const [stored] = useState<StoredConsoleState>(() => readStored(kind));
  const [pieces, setPieces] = useState<StationPiece[]>([]);
  const [doneRows, setDoneRows] = useState<TailorOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  // TRUE after the first successful fetch — the restored selection/chip/sheet must
  // not be validated (and wiped) against the EMPTY pre-fetch data.
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [doneLoading, setDoneLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [view, setView] = useState<View>(validView(kind, stored.view));
  const [search, setSearch] = useState(stored.search ?? "");
  const [sourceFilter, setSourceFilter] = useState<"" | "retail" | "wholesaler">(
    stored.sourceFilter ?? ""
  );
  const [repFilter, setRepFilter] = useState(stored.repFilter ?? "");
  const [activeZone, setActiveZone] = useState(stored.activeZone ?? "");
  const [activeType, setActiveType] = useState(stored.activeType ?? "all");
  // Which stage of the line is on screen. Defaults to this console's OWN station — a worker
  // opening their queue must still land on their own work, not on 1,400 rows of the line.
  // ⚠️ «tailor» is NOT a line stage — tailorToPiece stamps every فصال row with it precisely
  // to keep الفصال out of the stage chips, and LINE_ORDER does not contain it. So the فصال
  // console must START there: it has no chips to correct a wrong initial value, and since the
  // views below are stage-scoped a wrong start would render an empty الفصال queue.
  const [activeStage, setActiveStage] = useState<string>(
    kind === "tailor"
      ? "tailor"
      : (stored.activeStage ?? (kind === "embroidery" ? "embroidery" : "pressing"))
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(Array.isArray(stored.selected) ? stored.selected : [])
  );
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  // رف التجهيز hand-off state (الكوي only — stays null for التطريز/الفصال).
  const [shelfPrompt, setShelfPrompt] = useState<ShelfInboxItem | null>(null);
  const [shelfBoard, setShelfBoard] = useState<ShelfBoard | null>(null);
  const [shelfBusy, setShelfBusy] = useState(false);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState<Map<string, AdvancedGhost>>(new Map());
  const [openStudentKey, setOpenStudentKey] = useState<string | null>(
    stored.openStudentKey ?? null
  );
  const [lightbox, setLightbox] = useState<{ url: string; title: string } | null>(null);

  // Mirror the UI state so back-navigation restores it exactly.
  useEffect(() => {
    try {
      const snapshot: StoredConsoleState = {
        view,
        search,
        sourceFilter,
        repFilter,
        activeZone,
        activeType,
        activeStage,
        selected: [...selected],
        openStudentKey,
      };
      sessionStorage.setItem(STORAGE_PREFIX + kind, JSON.stringify(snapshot));
    } catch {
      /* storage full/unavailable — persistence is best-effort */
    }
  }, [kind, view, search, sourceFilter, repFilter, activeZone, activeType, activeStage, selected, openStudentKey]);

  // The one part of «getting back perfectly» that was still missing: the scroll offset.
  // Every filter above was restored and the worker was STILL dropped at the top of the
  // list. Keyed per station+view so الطلبات and القطع keep separate positions.
  useScrollRestore(`station:${kind}:${view}`, loadedOnce && !loading);

  // ─── Data ───────────────────────────────────────────────────────────────────
  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) {
        setLoading(true);
        setFetchError(false);
      }
      try {
        if (kind === "tailor") {
          const rows = await getTailorQueue(false);
          setPieces(rows.map(tailorToPiece));
        } else {
          // The whole line, not one stage (owner 2026-08-31). The backend decides what this
          // person may see (LINE_VIEW_STAGES) and what they may move (can_advance); the
          // console's job is to default to their own station and let them step out of it.
          const data = await getQueue(undefined, undefined, undefined, true);
          setPieces(data.map((r) => queueToPiece(r, kind)));
        }
        setLoadedOnce(true);
      } catch (err) {
        if (!silent) {
          toast.error(getApiErrorMessage(err, "تعذر تحميل القطع"));
          setFetchError(true);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [kind]
  );

  const loadDone = useCallback(async () => {
    setDoneLoading(true);
    try {
      setDoneRows(await getTailorQueue(true));
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحميل القطع المنجزة"));
    } finally {
      setDoneLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (view === "done" && kind === "tailor") loadDone();
  }, [view, kind, loadDone]);

  usePolling(() => load({ silent: true }), 15000, view !== "done");
  useProductionEvents((e) => {
    if (e.type !== "presence") load({ silent: true });
  }, kind !== "tailor");

  // Selection can only reference pieces that still exist (silent reloads prune it).
  // Gated on loadedOnce so a RESTORED selection isn't wiped against the empty pre-fetch list.
  useEffect(() => {
    if (!loadedOnce) return;
    setSelected((prev) => {
      const valid = new Set(pieces.map((p) => p.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [pieces, loadedOnce]);

  // ─── Filters ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pieces.filter(
      (p) =>
        (!q || matchesAr(p.studentName, q)) &&
        (!sourceFilter || p.source === sourceFilter) &&
        (!repFilter || p.wholesalerName === repFilter)
    );
  }, [pieces, search, sourceFilter, repFilter]);

  const repOptions = useMemo(() => {
    const s = new Set<string>();
    pieces.forEach((p) => {
      if (p.wholesalerName) s.add(p.wholesalerName);
    });
    return [...s];
  }, [pieces]);

  // ─── Stage chips — the line, in order, counted from what the backend actually sent ──────
  // Only stages PRESENT in the payload get a chip, so a console never offers an empty stage
  // and the row can never claim access the backend did not grant.
  const stageChips = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of filtered) m.set(p.status, (m.get(p.status) ?? 0) + 1);
    return LINE_ORDER.filter((st) => m.has(st)).map((st) => ({ stage: st, count: m.get(st)! }));
  }, [filtered]);

  // If the worker's own stage is empty this run, fall back to the first stage that has work
  // rather than showing an empty screen with chips beside it.
  //
  // ⚠️ Derived, not just corrected in the effect below. The views are stage-scoped now, so a
  // state-only correction paints one frame of «لا توجد قطع في …» before it lands. The effect
  // stays so the corrected stage is what gets mirrored to sessionStorage.
  // No chips (الفصال) = no line stage to fall back to — `activeStage` stands as-is.
  const effectiveStage = useMemo(
    () =>
      stageChips.length && !stageChips.some((c) => c.stage === activeStage)
        ? stageChips[0].stage
        : activeStage,
    [stageChips, activeStage]
  );

  useEffect(() => {
    if (!loadedOnce || effectiveStage === activeStage) return;
    setActiveStage(effectiveStage);
  }, [effectiveStage, activeStage, loadedOnce]);

  // ─── Stage scope ────────────────────────────────────────────────────────────
  // EVERYTHING below this line works on ONE stage. Since 2026-08-31 the payload is the whole
  // line, and «عرض بالطلب» used to group over all of it — so a presser's student list mixed
  // in قيد التطريز and قيد التجهيز pieces with no chip in sight to explain why. Both views
  // now sit behind the same stage chip row, which opens on this console's own station.
  const inStage = useMemo(
    () => filtered.filter((p) => p.status === effectiveStage),
    [filtered, effectiveStage]
  );

  // ─── «عرض بالطلب» grouping ──────────────────────────────────────────────────
  const groups = useMemo(() => {
    const m = new Map<string, StudentGroup>();
    for (const p of inStage) {
      const key = p.studentId || p.studentName;
      let g = m.get(key);
      if (!g) {
        g = {
          key,
          name: p.studentName,
          batchName: p.batchName,
          source: p.source,
          universityName: p.universityName,
          department: p.department,
          studyType: p.studyType,
          pieces: [],
          zoneDone: 0,
          zoneTotal: 0,
          overdue: false,
        };
        m.set(key, g);
      }
      g.pieces.push(p);
      for (const z of p.zones ?? []) {
        g.zoneTotal++;
        if (z.done) g.zoneDone++;
      }
      if (isPieceOverdue(p.deadline)) g.overdue = true;
    }
    return [...m.values()];
  }, [inStage]);

  // ─── «عرض بالقطع» chips + rows ──────────────────────────────────────────────
  // Counted over the ACTIVE stage, matching the rows below them: counting across the whole
  // line would advertise «الوشاح — جهة الاسم ١٢» and then list the two that are at التطريز.
  const zoneChips = useMemo(() => {
    const m = new Map<string, { key: string; label: string; count: number }>();
    for (const p of inStage) {
      for (const z of p.zones ?? []) {
        if (z.done) continue;
        const e = m.get(z.key) ?? { key: z.key, label: z.label, count: 0 };
        e.count++;
        m.set(z.key, e);
      }
    }
    return ZONE_ORDER.filter((k) => m.has(k)).map((k) => m.get(k)!);
  }, [inStage]);

  useEffect(() => {
    if (kind !== "embroidery" || effectiveStage !== "embroidery" || !loadedOnce) return;
    if (!zoneChips.some((c) => c.key === activeZone)) {
      setActiveZone(zoneChips[0]?.key ?? "");
      setSelected(new Set()); // the restored/previous selection belonged to the old zone
    }
  }, [zoneChips, activeZone, kind, effectiveStage, loadedOnce]);


  const typeChips = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of inStage) m.set(p.productType, (m.get(p.productType) ?? 0) + 1);
    return [...m.entries()].map(([type, count]) => ({ type, count }));
  }, [inStage]);

  useEffect(() => {
    if (!loadedOnce) return;
    if (activeType !== "all" && !typeChips.some((c) => c.type === activeType)) setActiveType("all");
  }, [typeChips, activeType, loadedOnce]);

  // The zone checklist is التطريز's own way of working and applies only while an embroiderer
  // is looking AT التطريز. Stepping to another stage falls back to the plain type chips —
  // otherwise a presser's view of التطريز would demand a zone that is not their job to tick.
  const zoneMode = kind === "embroidery" && effectiveStage === "embroidery";

  const pieceRows = useMemo(() => {
    if (zoneMode) {
      if (!activeZone) return [] as { piece: StationPiece; zone?: StationZone }[];
      return inStage
        .map((p) => ({
          piece: p,
          zone: (p.zones ?? []).find((z) => z.key === activeZone && !z.done),
        }))
        .filter((r): r is { piece: StationPiece; zone: StationZone } => !!r.zone);
    }
    return inStage
      .filter((p) => activeType === "all" || p.productType === activeType)
      .map((p) => ({ piece: p, zone: undefined as StationZone | undefined }));
  }, [inStage, zoneMode, activeZone, activeType]);

  const selectableIds = useMemo(
    () => pieceRows.filter((r) => r.piece.canComplete).map((r) => r.piece.id),
    [pieceRows]
  );
  const allChecked = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  // NB: selection is cleared EXPLICITLY in the chip/view/filter handlers (not via an
  // effect) so restoring a persisted selection on mount doesn't immediately wipe it.

  // ─── Actions ────────────────────────────────────────────────────────────────
  const markBusy = (key: string, on: boolean) =>
    setBusyKeys((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const finishPiece = useCallback((piece: StationPiece, label: string) => {
    setAdvanced((prev) => new Map(prev).set(piece.id, { piece, label }));
    setPieces((prev) => prev.filter((p) => p.id !== piece.id));
  }, []);

  async function tickZone(piece: StationPiece, zoneKey: string, done: boolean) {
    const key = `${piece.id}:${zoneKey}`;
    markBusy(key, true);
    try {
      const res = await markEmbroideryZone(piece.id, zoneKey, done);
      if (res.advanced) {
        finishPiece(piece, advancedLabelFor(res.status));
        toast.success(`اكتمل تطريز «${piece.productName}» — ${advancedLabelFor(res.status)}`);
      } else {
        const doneByKey = new Map(res.zones.map((z) => [z.key, z.done]));
        setPieces((prev) =>
          prev.map((p) =>
            p.id === piece.id
              ? {
                  ...p,
                  zones: (p.zones ?? []).map((z) => ({
                    ...z,
                    done: doneByKey.get(z.key) ?? z.done,
                  })),
                }
              : p
          )
        );
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحديث منطقة التطريز"));
      load({ silent: true });
    } finally {
      markBusy(key, false);
    }
  }

  // ── رف التجهيز hand-off (الكوي only) ──────────────────────────────────────
  // Fetches the board so the sheet can show the suggested خانة and let the worker pick
  // a different one. A failure here is silent on purpose: the advance already worked, and
  // an un-shelved piece is not lost — it lands in التجهيز's «وصلت توّا» inbox (D4/D6).
  async function offerShelfPlacement(orderId: string) {
    try {
      const board = await getShelfBoard();
      const item = board.inbox.find((i) => i.order_id === orderId);
      if (!item) return;
      setShelfBoard(board);
      setShelfPrompt(item);
    } catch {
      /* shelving is optional — never block the presser */
    }
  }

  async function confirmShelfPlacement(target?: { shelf_code: string; slot_index: number }) {
    if (!shelfPrompt) return;
    setShelfBusy(true);
    try {
      const res = await placePiece(shelfPrompt.order_id, target);
      toast.success(`${shelfPrompt.piece_label} → الخانة ${res.slot_code}`);
      setShelfPrompt(null);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تسكين القطعة"));
    } finally {
      setShelfBusy(false);
    }
  }

  async function completePiece(piece: StationPiece) {
    markBusy(piece.id, true);
    try {
      if (kind === "tailor") {
        await tailorComplete(piece.id);
        finishPiece(piece, "تم الفصال");
        toast.success(`تم فصال «${piece.productName}»`);
      } else {
        const res = await advanceOrder(piece.id);
        finishPiece(piece, advancedLabelFor(res.status));
        toast.success(`«${piece.productName}» — ${advancedLabelFor(res.status)}`);
        // الكوي → التجهيز: the piece now needs a خانة. Ask where to put it while the
        // worker still has it in hand. Retail-only, so a rep piece simply won't appear
        // in the board's inbox and no sheet opens.
        if (kind === "pressing" && res.status === "preparing") {
          void offerShelfPlacement(piece.id);
        }
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إكمال القطعة"));
      load({ silent: true });
    } finally {
      markBusy(piece.id, false);
    }
  }

  async function doBulk() {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      // zoneMode, not kind: an embroiderer LOOKING at الكوي is doing a plain advance, and a
      // presser looking at التطريز may not tick zones at all (the endpoint is role-gated).
      if (zoneMode) {
        const res = await markEmbroideryZoneBulk(
          [...selected].map((id) => ({ order_id: id, zone: activeZone }))
        );
        if (res.done > 0) {
          toast.success(
            `تم إكمال ${res.done} قطعة` +
              (res.advanced ? ` · انتقلت ${res.advanced} للمرحلة التالية` : "") +
              (res.skipped ? ` · تخطّي ${res.skipped}` : "")
          );
        } else {
          toast.error("لم يكن بالإمكان إكمال أي قطعة من المحدد");
        }
      } else if (kind === "tailor") {
        const res = await tailorCompleteBulk([...selected]);
        if (res.done > 0) {
          toast.success(
            res.skipped > 0
              ? `تم إنهاء فصال ${res.done} قطعة · تخطّي ${res.skipped}`
              : `تم إنهاء فصال ${res.done} قطعة`
          );
        } else {
          toast.error("لم يكن بالإمكان إنهاء أي قطعة من المحدد");
        }
      } else {
        const res = await advanceBulk([...selected]);
        if (res.advanced > 0) {
          // Stage-neutral wording: this batch may not have been الكوي's (see bulkLabel).
          toast.success(
            res.skipped > 0
              ? `تم إكمال ${res.advanced} قطعة · تخطّي ${res.skipped}`
              : `تم إكمال ${res.advanced} قطعة`
          );
        } else {
          toast.error("لم يكن بالإمكان إكمال أي قطعة من المحدد");
        }
      }
      setSelected(new Set());
      await load({ silent: true });
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تنفيذ الإجراء"));
    } finally {
      setBulkLoading(false);
    }
  }

  async function doReopen(id: string) {
    setReopeningId(id);
    try {
      await tailorReopen(id);
      toast.success("تم إرجاع القطعة لقيد الفصال");
      await Promise.all([loadDone(), load({ silent: true })]);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إرجاع القطعة"));
    } finally {
      setReopeningId(null);
    }
  }

  // ─── Sheet derivation («عرض بالطلب») ────────────────────────────────────────
  const openGroup = groups.find((g) => g.key === openStudentKey) ?? null;
  const openGhosts = useMemo(() => {
    if (!openStudentKey) return [] as AdvancedGhost[];
    const pendingIds = new Set((openGroup?.pieces ?? []).map((p) => p.id));
    return [...advanced.values()].filter(
      (g) =>
        (g.piece.studentId || g.piece.studentName) === openStudentKey &&
        !pendingIds.has(g.piece.id)
    );
  }, [advanced, openStudentKey, openGroup]);

  useEffect(() => {
    if (!loadedOnce) return; // a restored open sheet must survive until real data arrives
    if (openStudentKey && !openGroup && openGhosts.length === 0) setOpenStudentKey(null);
  }, [openStudentKey, openGroup, openGhosts, loadedOnce]);

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(() => (allChecked ? new Set() : new Set(selectableIds)));

  // The label names the STAGE the selection is actually at, not the console's own station —
  // «إكمال الكوي» on a batch of التطريز pieces would describe work nobody is about to do.
  // Taken from the backend's own edge label (ADVANCE_LABEL_AR) when the rows agree on one.
  const bulkLabel = (() => {
    if (zoneMode) {
      return `إكمال «${zoneChips.find((c) => c.key === activeZone)?.label ?? "المنطقة"}» (${selected.size})`;
    }
    if (kind === "tailor") return `تم الفصال (${selected.size})`;
    const labels = new Set(
      pieceRows.filter((r) => selected.has(r.piece.id)).map((r) => r.piece.completeLabel)
    );
    const one = labels.size === 1 ? [...labels][0] : null;
    return `${one ?? "إكمال"} (${selected.size})`;
  })();

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div dir="rtl" lang="ar" className="space-y-5 pb-28">
      <PageHeader
        title={meta.title}
        subtitle={meta.subtitle}
        action={
          <Button variant="ghost" onClick={() => load()} loading={loading}>
            تحديث
          </Button>
        }
      />

      {/* View toggle — الفصال has no «عرض بالقطع» (user 2026-07-16): students + المنجزة only */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-sink p-1">
        {(
          kind === "tailor"
            ? [
                { id: "students", label: "عرض بالطلب" },
                { id: "done", label: "المنجزة" },
              ]
            : ([
                { id: "students", label: "عرض بالطلب" },
                { id: "pieces", label: "عرض بالقطع" },
              ] as { id: View; label: string }[])
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              if (view === t.id) return;
              setView(t.id as View);
              setSelected(new Set());
            }}
            aria-pressed={view === t.id}
            className={`min-h-11 rounded-xl px-3 text-sm font-bold transition-colors ${
              view === t.id
                ? "bg-orange-ink text-white shadow-[var(--shadow-soft)]"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      {view !== "done" && (
        <div className="surface-card space-y-3 rounded-2xl p-3.5">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="بحث باسم الطالب…"
            className="w-full"
          />
          {kind !== "tailor" && (
            <>
              {showSourceFilter && (
                <div className="flex gap-2">
                  {(
                    [
                      { id: "", label: "الكل" },
                      { id: "retail", label: "تجزئة" },
                      { id: "wholesaler", label: "ممثلين" },
                    ] as { id: "" | "retail" | "wholesaler"; label: string }[]
                  ).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        if (sourceFilter === s.id) return;
                        setSourceFilter(s.id);
                        // Reps don't apply to retail — clear a stale rep filter that the
                        // (now hidden) select could no longer undo.
                        if (s.id === "retail") setRepFilter("");
                        setSelected(new Set());
                      }}
                      aria-pressed={sourceFilter === s.id}
                      className={`min-h-10 flex-1 rounded-xl border px-3 text-xs font-bold transition-colors ${
                        sourceFilter === s.id
                          ? "border-orange-ink bg-orange-ink/10 text-orange-ink"
                          : "border-line text-ink-soft hover:text-ink"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
              {/* Rep filter — irrelevant to retail pieces, so it hides on تجزئة (user 2026-07-16). */}
              {sourceFilter !== "retail" && repOptions.length > 0 && (
                <Select
                  aria-label="الممثل"
                  value={repFilter}
                  onChange={(e) => {
                    if (e.target.value === repFilter) return;
                    setRepFilter(e.target.value);
                    setSelected(new Set());
                  }}
                  options={[
                    { value: "", label: "كل الممثلين" },
                    ...repOptions.map((r) => ({ value: r, label: r })),
                  ]}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* Body */}
      {/* Stage chips — «مرحلتي» first, then the rest of the line. They sit ABOVE the view
          branch on purpose: they used to live inside «عرض بالقطع» only, so «عرض بالطلب»
          (the default view) listed every stage's students with nothing on screen saying so.
          Only rendered when the backend actually returned more than one stage. */}
      {view !== "done" && !loading && !fetchError && stageChips.length > 1 && (
        <nav aria-label="تصفية حسب المرحلة" className="mb-2 flex gap-2 overflow-x-auto pb-1">
          {stageChips.map((c) => {
            const own = c.stage === (kind === "embroidery" ? "embroidery" : "pressing");
            return (
              <button
                key={c.stage}
                type="button"
                onClick={() => {
                  if (effectiveStage === c.stage) return;
                  setActiveStage(c.stage);
                  setSelected(new Set()); // the selection belonged to the old stage
                  setOpenStudentKey(null); // …and so did the open student sheet
                }}
                aria-pressed={effectiveStage === c.stage}
                className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-bold transition-colors ${
                  effectiveStage === c.stage
                    ? "border-orange-ink bg-orange-ink text-white"
                    : own
                      ? "border-orange-ink/40 bg-peach/40 text-orange-ink hover:text-ink"
                      : "border-line bg-surface text-ink-soft hover:text-ink"
                }`}
              >
                {own ? "مرحلتي · " : ""}
                {(ORDER_STATUS_LABELS as Record<string, string>)[c.stage] ?? c.stage}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                    effectiveStage === c.stage ? "bg-white/20" : "bg-ink/8"
                  }`}
                >
                  {c.count}
                </span>
              </button>
            );
          })}
        </nav>
      )}

      {view === "done" ? (
        <DoneList
          rows={doneRows}
          loading={doneLoading}
          search={search}
          onSearch={setSearch}
          reopeningId={reopeningId}
          onReopen={doReopen}
          fromPath={pathname}
        />
      ) : loading ? (
        <div className="space-y-2.5" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : fetchError ? (
        <div className="rounded-2xl border border-[var(--color-danger)]/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
          <p className="text-base font-semibold text-ink">تعذر تحميل القطع</p>
          <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
          <Button className="mt-4" onClick={() => load()}>
            إعادة المحاولة
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState message={meta.empty} />
      ) : inStage.length === 0 ? (
        // A stage the worker stepped into that has no work is not an error — name it and
        // leave the chips above in reach.
        <EmptyState
          message={`لا توجد قطع في «${
            (ORDER_STATUS_LABELS as Record<string, string>)[effectiveStage] ?? effectiveStage
          }» حالياً`}
        />
      ) : view === "students" ? (
        <ul className="space-y-2.5">
          {groups.map((g) => (
            <li key={g.key}>
              <button
                type="button"
                onClick={() => setOpenStudentKey(g.key)}
                className="flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 text-start shadow-[var(--shadow-soft)] transition-colors hover:border-orange-ink/30"
              >
                <div className="min-w-0">
                  <p className="truncate font-display text-[15px] font-bold text-ink">{g.name}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-soft">
                    {g.pieces.length} قطعة
                    {g.zoneTotal > 0 ? ` · ${g.zoneDone}/${g.zoneTotal} مناطق منجزة` : ""}
                    {g.batchName ? ` · ${g.batchName}` : g.source === "retail" ? " · تجزئة" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {g.overdue && (
                    <span className="rounded-full bg-[var(--color-danger)]/10 px-2 py-0.5 text-[10px] font-bold text-[var(--color-danger)]">
                      متأخر
                    </span>
                  )}
                  <span className="text-lg text-ink-soft" aria-hidden>
                    ‹
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          {/* Chips: zones (التطريز) or piece types (الفصال/الكوي) */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {zoneMode
              ? zoneChips.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => {
                      if (activeZone === c.key) return;
                      setActiveZone(c.key);
                      setSelected(new Set());
                    }}
                    aria-pressed={activeZone === c.key}
                    className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-bold transition-colors ${
                      activeZone === c.key
                        ? "border-orange-ink bg-orange-ink text-white"
                        : "border-line bg-surface text-ink-soft hover:text-ink"
                    }`}
                  >
                    {c.label}
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                        activeZone === c.key ? "bg-white/20" : "bg-ink/8"
                      }`}
                    >
                      {c.count}
                    </span>
                  </button>
                ))
              : [{ type: "all", count: inStage.length }, ...typeChips].map((c) => (
                  <button
                    key={c.type}
                    type="button"
                    onClick={() => {
                      if (activeType === c.type) return;
                      setActiveType(c.type);
                      setSelected(new Set());
                    }}
                    aria-pressed={activeType === c.type}
                    className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-bold transition-colors ${
                      activeType === c.type
                        ? "border-orange-ink bg-orange-ink text-white"
                        : "border-line bg-surface text-ink-soft hover:text-ink"
                    }`}
                  >
                    {c.type === "all" ? "الكل" : typeLabel(c.type)}
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                        activeType === c.type ? "bg-white/20" : "bg-ink/8"
                      }`}
                    >
                      {c.count}
                    </span>
                  </button>
                ))}
          </div>

          {pieceRows.length === 0 ? (
            <EmptyState
              message={
                zoneMode
                  ? "لا توجد قطع بانتظار هذه المنطقة."
                  : "لا توجد قطع من هذا النوع بانتظار العمل."
              }
            />
          ) : (
            <>
              {selectableIds.length > 0 && (
                <button
                  type="button"
                  onClick={toggleAll}
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink-soft transition-colors hover:border-orange-ink/30"
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-md border-2 ${
                      allChecked ? "border-orange-ink bg-orange-ink text-white" : "border-ink/30"
                    }`}
                    aria-hidden
                  >
                    {allChecked ? "✓" : ""}
                  </span>
                  تحديد الكل ({selectableIds.length})
                </button>
              )}

              <ul className="space-y-2.5">
                {pieceRows.map(({ piece, zone }) => {
                  const img = zone ? resolveUploadUrl(zone.image_url) : null;
                  const checked = selected.has(piece.id);
                  return (
                    <li
                      key={piece.id}
                      className="flex items-stretch gap-1 rounded-2xl border border-line bg-surface shadow-[var(--shadow-soft)]"
                    >
                      <button
                        type="button"
                        onClick={() => piece.canComplete && toggleOne(piece.id)}
                        disabled={!piece.canComplete}
                        aria-label="تحديد القطعة"
                        aria-pressed={checked}
                        className="flex w-14 shrink-0 items-center justify-center rounded-s-2xl transition-colors hover:bg-surface-sink disabled:opacity-40"
                      >
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded-md border-2 text-sm ${
                            checked ? "border-orange-ink bg-orange-ink text-white" : "border-ink/30"
                          }`}
                          aria-hidden
                        >
                          {checked ? "✓" : ""}
                        </span>
                      </button>

                      {/* Row body = the order (user 2026-07-16: no side «التفاصيل» button —
                          tapping the name opens the details; selection is the checkbox only). */}
                      <Link
                        href={`/staff/orders/${piece.id}?from=${encodeURIComponent(pathname)}`}
                        className={`flex min-w-0 flex-1 items-center justify-between gap-3 py-3 ps-1 transition-colors hover:bg-surface-sink/50 ${
                          img && zone ? "pe-2" : "rounded-e-2xl pe-4"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-display text-[15px] font-bold text-ink">
                            {piece.studentName}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-ink-soft">
                            {piece.productName}
                            {zone?.text ? ` · ${zone.text}` : ""}
                            {!zone && piece.batchName ? ` · ${piece.batchName}` : ""}
                          </p>
                        </div>
                        {isPieceOverdue(piece.deadline) && (
                          <span className="shrink-0 rounded-full bg-[var(--color-danger)]/10 px-2 py-0.5 text-[10px] font-bold text-[var(--color-danger)]">
                            متأخر
                          </span>
                        )}
                      </Link>

                      {img && zone && (
                        <button
                          type="button"
                          onClick={() => setLightbox({ url: img, title: zone.label })}
                          aria-label={`عرض صورة ${zone.label}`}
                          className="my-2 me-2 shrink-0 self-center overflow-hidden rounded-lg border border-line bg-white focus:outline-none focus:ring-2 focus:ring-orange-ink/40"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img} alt={zone.label} className="h-11 w-11 object-cover" loading="lazy" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}

      {/* Sticky bulk bar («عرض بالقطع») */}
      {view === "pieces" && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur lg:ms-64">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="min-h-11 px-2 text-sm font-medium text-ink-soft hover:text-ink"
            >
              إلغاء التحديد ({selected.size})
            </button>
            <Button onClick={doBulk} loading={bulkLoading} className="min-w-[9rem]">
              {bulkLabel}
            </Button>
          </div>
        </div>
      )}

      {/* «عرض بالطلب» student sheet */}
      {openStudentKey && (openGroup || openGhosts.length > 0) && (
        <StudentSheet
          kind={kind}
          studentName={openGroup?.name ?? openGhosts[0]?.piece.studentName ?? ""}
          batchName={openGroup?.batchName ?? openGhosts[0]?.piece.batchName ?? null}
          info={kind === "tailor" ? null : studentInfoLine(openGroup ?? openGhosts[0]?.piece ?? null)}
          pieces={openGroup?.pieces ?? []}
          ghosts={openGhosts}
          busyKeys={busyKeys}
          fromPath={pathname}
          onClose={() => setOpenStudentKey(null)}
          onTickZone={tickZone}
          onComplete={completePiece}
        />
      )}

      {lightbox && (
        <Lightbox url={lightbox.url} title={lightbox.title} onClose={() => setLightbox(null)} />
      )}

      {/* رف التجهيز — «وين نحطها؟» right after الكوي pushes the piece to التجهيز. */}
      <PlaceSheet
        open={!!shelfPrompt}
        pieceLabel={shelfPrompt?.piece_label ?? ""}
        studentName={shelfPrompt?.student_name ?? ""}
        studentId={shelfPrompt?.student_id ?? null}
        pieceType={shelfPrompt?.piece_type ?? ""}
        suggestion={shelfPrompt?.suggestion ?? null}
        board={shelfBoard}
        busy={shelfBusy}
        onConfirm={confirmShelfPlacement}
        onSkip={() => setShelfPrompt(null)}
        onClose={() => setShelfPrompt(null)}
      />
    </div>
  );
}

// ─── الفصال «المنجزة» — flat done list with إرجاع ─────────────────────────────
function DoneList({
  rows,
  loading,
  search,
  onSearch,
  reopeningId,
  onReopen,
  fromPath,
}: {
  rows: TailorOrderRow[];
  loading: boolean;
  search: string;
  onSearch: (v: string) => void;
  reopeningId: string | null;
  onReopen: (id: string) => void;
  fromPath: string;
}) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => matchesAr(r.studentName, q));
  }, [rows, search]);

  return (
    <div className="space-y-3">
      <div className="surface-card rounded-2xl p-3.5">
        <SearchField
          value={search}
          onChange={onSearch}
          placeholder="بحث باسم الطالب…"
          className="w-full"
        />
      </div>
      {loading ? (
        <div className="space-y-2.5" aria-hidden>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState message="لا توجد قطع منتهية الفصال بعد." />
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((r) => (
            <li
              key={r.id}
              className="flex items-stretch gap-1 rounded-2xl border border-line bg-surface shadow-[var(--shadow-soft)]"
            >
              <Link
                href={`/staff/orders/${r.id}?from=${encodeURIComponent(fromPath)}`}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-s-2xl py-3 pe-2 ps-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-display text-[15px] font-bold text-ink">
                    {r.studentName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-soft">
                    {r.productName}
                    {r.batchName ? ` · ${r.batchName}` : ""}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                  تم الفصال ✓
                </span>
              </Link>
              <button
                type="button"
                onClick={() => onReopen(r.id)}
                disabled={reopeningId === r.id}
                className="flex shrink-0 items-center rounded-e-2xl border-s border-line px-3 text-xs font-semibold text-ink-soft transition-colors hover:bg-surface-sink hover:text-orange-ink disabled:opacity-50"
              >
                {reopeningId === r.id ? "…" : "إرجاع"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
