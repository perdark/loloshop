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
import { PRODUCT_TYPE_LABELS } from "@/lib/constants";
import { usePolling } from "@/lib/hooks/usePolling";
import { useProductionEvents } from "@/hooks/useProductionEvents";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StudentSheet } from "./StudentSheet";
import { Lightbox } from "./Lightbox";
import {
  advancedLabelFor,
  isPieceOverdue,
  resolveUploadUrl,
  type AdvancedGhost,
  type StationKind,
  type StationPiece,
} from "./types";

// ─── Per-station copy ─────────────────────────────────────────────────────────
const META: Record<StationKind, { title: string; subtitle: string; empty: string }> = {
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

function queueToPiece(r: ProductionQueueItem, kind: StationKind): StationPiece {
  return {
    id: r.id,
    studentId: r.student_id ?? r.student_name,
    studentName: r.student_name,
    productName: r.product_name,
    productType: r.product_type,
    batchName: r.batch_name,
    wholesalerName: r.wholesaler_name,
    source: r.source,
    deadline: r.deadline,
    createdAt: r.created_at,
    zones: kind === "embroidery" ? r.zones ?? [] : null,
    canComplete: kind === "pressing" ? !!r.can_advance : true,
    completeLabel:
      kind === "pressing" ? r.advance_label ?? "إنهاء الكوي" : "إكمال التطريز",
  };
}

function tailorToPiece(r: TailorOrderRow): StationPiece {
  return {
    id: r.id,
    studentId: r.studentId ?? r.studentName,
    studentName: r.studentName,
    productName: r.productName,
    productType: r.productType,
    batchName: r.batchName,
    wholesalerName: null,
    source: "retail",
    deadline: r.deadline,
    createdAt: r.createdAt,
    zones: null,
    canComplete: true,
    completeLabel: "تم الفصال",
  };
}

interface StudentGroup {
  key: string;
  name: string;
  batchName: string | null;
  source: "retail" | "wholesaler";
  pieces: StationPiece[];
  zoneDone: number;
  zoneTotal: number;
  overdue: boolean;
}

// ─── The console ──────────────────────────────────────────────────────────────
export function StationConsole({
  kind,
  showSourceFilter = false,
}: {
  kind: StationKind;
  showSourceFilter?: boolean;
}) {
  const pathname = usePathname() || "/staff";
  const meta = META[kind];

  const [pieces, setPieces] = useState<StationPiece[]>([]);
  const [doneRows, setDoneRows] = useState<TailorOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [doneLoading, setDoneLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [view, setView] = useState<View>("students");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"" | "retail" | "wholesaler">("");
  const [repFilter, setRepFilter] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [activeZone, setActiveZone] = useState("");
  const [activeType, setActiveType] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState<Map<string, AdvancedGhost>>(new Map());
  const [openStudentKey, setOpenStudentKey] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; title: string } | null>(null);

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
          const stage = kind === "embroidery" ? "embroidery" : "pressing";
          const data = await getQueue(undefined, undefined, undefined, true);
          setPieces(data.filter((r) => r.status === stage).map((r) => queueToPiece(r, kind)));
        }
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
  useEffect(() => {
    setSelected((prev) => {
      const valid = new Set(pieces.map((p) => p.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [pieces]);

  // ─── Filters ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pieces.filter(
      (p) =>
        (!q || p.studentName.toLowerCase().includes(q)) &&
        (!sourceFilter || p.source === sourceFilter) &&
        (!repFilter || p.wholesalerName === repFilter) &&
        (!batchFilter || p.batchName === batchFilter)
    );
  }, [pieces, search, sourceFilter, repFilter, batchFilter]);

  const repOptions = useMemo(() => {
    const s = new Set<string>();
    pieces.forEach((p) => {
      if (p.wholesalerName) s.add(p.wholesalerName);
    });
    return [...s];
  }, [pieces]);

  const batchOptions = useMemo(() => {
    const s = new Set<string>();
    pieces.forEach((p) => {
      if (!p.batchName) return;
      if (repFilter && p.wholesalerName !== repFilter) return;
      s.add(p.batchName);
    });
    return [...s];
  }, [pieces, repFilter]);

  useEffect(() => {
    if (batchFilter && !batchOptions.includes(batchFilter)) setBatchFilter("");
  }, [batchOptions, batchFilter]);

  // ─── «عرض بالطلب» grouping ──────────────────────────────────────────────────
  const groups = useMemo(() => {
    const m = new Map<string, StudentGroup>();
    for (const p of filtered) {
      const key = p.studentId || p.studentName;
      let g = m.get(key);
      if (!g) {
        g = {
          key,
          name: p.studentName,
          batchName: p.batchName,
          source: p.source,
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
  }, [filtered]);

  // ─── «عرض بالقطع» chips + rows ──────────────────────────────────────────────
  const zoneChips = useMemo(() => {
    const m = new Map<string, { key: string; label: string; count: number }>();
    for (const p of filtered) {
      for (const z of p.zones ?? []) {
        if (z.done) continue;
        const e = m.get(z.key) ?? { key: z.key, label: z.label, count: 0 };
        e.count++;
        m.set(z.key, e);
      }
    }
    return ZONE_ORDER.filter((k) => m.has(k)).map((k) => m.get(k)!);
  }, [filtered]);

  useEffect(() => {
    if (kind !== "embroidery") return;
    if (!zoneChips.some((c) => c.key === activeZone)) setActiveZone(zoneChips[0]?.key ?? "");
  }, [zoneChips, activeZone, kind]);

  const typeChips = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of filtered) m.set(p.productType, (m.get(p.productType) ?? 0) + 1);
    return [...m.entries()].map(([type, count]) => ({ type, count }));
  }, [filtered]);

  useEffect(() => {
    if (activeType !== "all" && !typeChips.some((c) => c.type === activeType)) setActiveType("all");
  }, [typeChips, activeType]);

  const pieceRows = useMemo(() => {
    if (kind === "embroidery") {
      if (!activeZone) return [] as { piece: StationPiece; zone?: StationZone }[];
      return filtered
        .map((p) => ({
          piece: p,
          zone: (p.zones ?? []).find((z) => z.key === activeZone && !z.done),
        }))
        .filter((r): r is { piece: StationPiece; zone: StationZone } => !!r.zone);
    }
    return filtered
      .filter((p) => activeType === "all" || p.productType === activeType)
      .map((p) => ({ piece: p, zone: undefined as StationZone | undefined }));
  }, [filtered, kind, activeZone, activeType]);

  const selectableIds = useMemo(
    () => pieceRows.filter((r) => r.piece.canComplete).map((r) => r.piece.id),
    [pieceRows]
  );
  const allChecked = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  // Switching chip/view/filter invalidates the current selection's meaning.
  useEffect(() => {
    setSelected(new Set());
  }, [view, activeZone, activeType, sourceFilter, repFilter, batchFilter]);

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
      if (kind === "embroidery") {
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
          toast.success(
            res.skipped > 0
              ? `تم إكمال كوي ${res.advanced} قطعة · تخطّي ${res.skipped}`
              : `تم إكمال كوي ${res.advanced} قطعة`
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
    if (openStudentKey && !openGroup && openGhosts.length === 0) setOpenStudentKey(null);
  }, [openStudentKey, openGroup, openGhosts]);

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(() => (allChecked ? new Set() : new Set(selectableIds)));

  const bulkLabel =
    kind === "embroidery"
      ? `إكمال «${zoneChips.find((c) => c.key === activeZone)?.label ?? "المنطقة"}» (${selected.size})`
      : kind === "tailor"
        ? `تم الفصال (${selected.size})`
        : `إكمال الكوي (${selected.size})`;

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

      {/* View toggle */}
      <div
        className={`grid gap-2 rounded-2xl bg-surface-sink p-1 ${
          kind === "tailor" ? "grid-cols-3" : "grid-cols-2"
        }`}
      >
        {(
          [
            { id: "students", label: "عرض بالطلب" },
            { id: "pieces", label: "عرض بالقطع" },
            ...(kind === "tailor" ? [{ id: "done", label: "المنجزة" }] : []),
          ] as { id: View; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setView(t.id)}
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
          <Input
            type="search"
            placeholder="بحث باسم الطالب…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full"
            aria-label="بحث باسم الطالب"
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
                      onClick={() => setSourceFilter(s.id)}
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
              {(repOptions.length > 0 || batchOptions.length > 0) && (
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    aria-label="الممثل"
                    value={repFilter}
                    onChange={(e) => setRepFilter(e.target.value)}
                    options={[
                      { value: "", label: "كل الممثلين" },
                      ...repOptions.map((r) => ({ value: r, label: r })),
                    ]}
                  />
                  <Select
                    aria-label="الدفعة"
                    value={batchFilter}
                    onChange={(e) => setBatchFilter(e.target.value)}
                    options={[
                      { value: "", label: "كل الدفعات" },
                      ...batchOptions.map((b) => ({ value: b, label: b })),
                    ]}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Body */}
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
            {kind === "embroidery"
              ? zoneChips.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setActiveZone(c.key)}
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
              : [{ type: "all", count: filtered.length }, ...typeChips].map((c) => (
                  <button
                    key={c.type}
                    type="button"
                    onClick={() => setActiveType(c.type)}
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
                kind === "embroidery"
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
    return rows.filter((r) => r.studentName.toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <div className="space-y-3">
      <div className="surface-card rounded-2xl p-3.5">
        <Input
          type="search"
          placeholder="بحث باسم الطالب…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full"
          aria-label="بحث باسم الطالب"
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
