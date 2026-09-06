"use client";

// قائمة التجهيز — the preparer's console.
//
// ⚠️ WHY THIS EXISTS (owner, 2026-08-05): «خلي عامل التجهيز مثله مثل واجهة عامل التطريز لان
// يحتاج يشوف التطريز الخاص بالطالب للوشاح من الامام ومن الخلف. ويحتاج للقبعة كذلك من كل
// الجوانب وكذلك الامر للروب. وخلي في بالك انه التجهيز يحتاج ان يكون سريع جدا».
//
// Before this, the preparer packed BLIND: their queue was a flat grid of OrderCards with no
// artwork at all, and رف التجهيز (components/staff/shelf/ShelfConsole.tsx) has no <img> in
// it either. They had to open each piece's detail page to see what was stitched on it.
//
// ── This is the التطريز console, not a lookalike ────────────────────────────────────────
// A first cut (earlier the same day) departed from the embroiderer's console on purpose:
// every zone image on screen at once, one card per student, no sheet. The owner rejected
// that — «مثله مثل واجهة عامل التطريز» means the SAME interface. So this now renders the
// same students list and reuses the same `StudentSheet`, with `kind="preparing"`.
//
// The one difference is baked into the shared sheet, not duplicated here: التجهيز zones are
// READ-ONLY. The stitching is already finished by the time a piece reaches التجهيز, and the
// backend exposes no zone-tick endpoint for it (see productionController's station=1 block),
// so the preparer reads the artwork to verify the set and never ticks it.
//
// ── Why the compact list is also the fast one («سريع جدا») ──────────────────────────────
// Measured 2026-08-05 against the real queue: 429 pieces across 326 students. The rejected
// design rendered every student's zone images at once and OOM-killed the Next dev server.
// This list carries NO images — artwork loads only inside the sheet the worker opened — so
// all 326 students render at once with no cap and no «عرض 25 من 326» footnote. Same reason
// التطريز has never needed one.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";
import { matchesQueueSearch } from "@/lib/queue-search";
import { rememberQueueOrder } from "@/lib/queue-neighbors";
import { PageHeader } from "@/components/ui/PageHeader";
import { StudentSheet } from "@/components/staff/station/StudentSheet";
import { isPieceOverdue, type AdvancedGhost, type StationPiece } from "@/components/staff/station/types";
import { getQueue, advanceOrder, advanceBulk } from "@/lib/staff";
import { getApiErrorMessage } from "@/lib/api";
import { useProductionEvents } from "@/hooks/useProductionEvents";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { GARMENT_FILTER_ORDER, PRODUCT_TYPE_LABELS, STUDY_TYPE_LABELS } from "@/lib/constants";
import { toArabicDigits } from "@/lib/format";
import type { ProductionQueueItem } from "@/lib/staff-types";
import type { OrderStatus } from "@/lib/types";
import { SearchField } from "@/components/ui/SearchField";

type View = "preparing" | "ready";
type SourceFilter = "" | "retail" | "wholesaler";

/**
 * ⚠️ THE PIECE FILTER IS THE GARMENT, NOT THE EMBROIDERY POSITION (owner, 2026-08-31).
 *
 * The preparer had no piece filter at all here — only «تجزئة/ممثلين» and the rep select — so
 * «وين الروبات؟» meant reading 326 student rows. The obvious thing to reach for was the
 * embroidery zones the sheet already renders («وشاح — من الأمام», «الروب — الردن الأيمن»),
 * and that would have been wrong twice over: أمام and خلف are ONE sash in his hands, and a
 * zone-derived filter can only ever list pieces that CARRY embroidery — «we must see the
 * pieces even the pieces without تطريز on filters». Measured on the dev DB, the preparing+
 * ready queue is mostly robes, and a robe usually has no ردن stitching at all.
 *
 * So it filters on `productType`, which every piece has. Chips render only for the types
 * actually in the current tab, so the row never offers an empty filter.
 */
// Shared with قائمة الإنتاج (`GARMENT_FILTER_ORDER`) so the two screens a preparer uses
// cannot offer different garments — /staff/queue got this filter on 2026-09-01, when the
// شال turned out to be unreachable there.
const GARMENT_ORDER = GARMENT_FILTER_ORDER;

const VIEW_META: Record<View, { tab: string; empty: string }> = {
  preparing: { tab: "قيد التجهيز", empty: "لا توجد قطع قيد التجهيز حالياً" },
  ready: { tab: "جاهزة للتسليم", empty: "لا توجد قطع جاهزة حالياً" },
};

const STORAGE_KEY = "loloshop-prep-console";

interface Stored {
  view?: View;
  search?: string;
  sourceFilter?: SourceFilter;
  repFilter?: string;
  garment?: string;
  openStudentKey?: string | null;
}

function readStored(): Stored {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}") as Stored;
  } catch {
    return {};
  }
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
  /** How many zone artworks this student's pieces carry — the "worth opening" signal. */
  photoCount: number;
  overdue: boolean;
  /** The student's whole checkout set — see `summarizeSet` (bug 8, part 4). */
  set: SetSummary;
}

/** Stages at which a piece is no longer awaited by التجهيز: it is here, or already gone. */
const SET_ARRIVED = new Set<OrderStatus>(["preparing", "ready", "delivered"]);

interface SetSummary {
  /** Every distinct piece of every bundle this student has in view. */
  total: number;
  /** Pieces still upstream — the ones that make bagging this set premature. */
  waiting: { productName: string; status: OrderStatus }[];
}

/**
 * What is this student's SET, and is all of it here? (bug 8, part 4)
 *
 * The preparer bags a set, but the queue is one row per piece, so a set whose robe is still
 * at التطريز is indistinguishable from a set of two. Bagging early is the expensive mistake:
 * it surfaces at handover, in front of the student.
 *
 * ⚠️ Measured on the dev DB before this was built: 421 of 432 prep rows belong to a set with
 * a piece still upstream. So «ناقص» as a WARNING would fire on 97% of the list and be
 * trained away in a day. The rare, actionable state is the opposite one — a set that is
 * complete and can be bagged now — so that is what gets the badge, and the absentees are
 * listed quietly for the worker who wants to know what they are waiting on.
 */
function summarizeSet(pieces: StationPiece[]): SetSummary {
  const seen = new Map<string, { productName: string; status: OrderStatus }>();
  for (const p of pieces) {
    // A piece bought alone has no bundle: it is its own complete set of one.
    for (const s of p.setPieces ?? [{ id: p.id, status: "preparing" as OrderStatus, product_name: p.productName }]) {
      seen.set(s.id, { productName: s.product_name, status: s.status });
    }
  }
  return {
    total: seen.size,
    waiting: [...seen.values()].filter((s) => !SET_ARRIVED.has(s.status)),
  };
}

/** جامعة · قسم · صباحي/مسائي — mirrors the station console's line, wholesaler students only. */
function studentInfoLine(g: StudentGroup | null): string | null {
  if (!g || g.source !== "wholesaler") return null;
  const study = (STUDY_TYPE_LABELS as Record<string, string>)[g.studyType ?? ""] ?? null;
  const line = [g.universityName, g.department, study].filter(Boolean).join(" · ");
  return line || null;
}

function queueToPiece(r: ProductionQueueItem): StationPiece {
  return {
    status: r.status,
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
    // `null`, NOT `[]`, when the backend sent no zones for this row. The sheet prints
    // «لا تطريز على هذه القطعة» for an EMPTY list — a statement of fact — so collapsing
    // "never enriched" into "empty" would make it lie. Both tabs' stages are enriched
    // (see productionController's ZONE_STAGES); this keeps that a backend contract
    // rather than an assumption baked into the mapper.
    zones: r.zones ?? null,
    spec: r.spec ?? null,
    setPieces: r.set_pieces ?? null,
    measurements: r.measurements ?? null,
    // Never derived client-side — the backend grants the advance on the queue row.
    canComplete: r.can_advance === true,
    completeLabel: r.advance_label ?? "إنهاء التجهيز",
  };
}

export function PrepConsole({ showSourceFilter }: { showSourceFilter: boolean }) {
  const pathname = usePathname();
  const [stored] = useState<Stored>(() => readStored());
  const [view, setView] = useState<View>(stored.view === "ready" ? "ready" : "preparing");
  const [search, setSearch] = useState(stored.search ?? "");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(
    stored.sourceFilter === "retail" || stored.sourceFilter === "wholesaler"
      ? stored.sourceFilter
      : ""
  );
  const [repFilter, setRepFilter] = useState(stored.repFilter ?? "");
  const [garment, setGarment] = useState(stored.garment ?? "");
  const [rows, setRows] = useState<ProductionQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [openStudentKey, setOpenStudentKey] = useState<string | null>(
    stored.openStudentKey ?? null
  );
  // Pieces finished during this session, kept in the open sheet as ✓ rows so the worker
  // sees what just moved on instead of watching them silently vanish.
  const [ghosts, setGhosts] = useState<Record<string, AdvancedGhost[]>>({});

  // Back-navigation from التفاصيل lands the worker where they were, not at row 1.
  useScrollRestore(`prep:${view}`, loadedOnce && !loading);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ view, search, sourceFilter, repFilter, garment, openStudentKey })
      );
    } catch {
      /* best-effort */
    }
  }, [view, search, sourceFilter, repFilter, garment, openStudentKey]);

  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) setLoading(true);
      setFetchError(false);
      try {
        // station=1 is what attaches `zones` (artwork) and the backend-granted advance.
        const data = await getQueue(undefined, undefined, undefined, true);
        setRows(data);
        setLoadedOnce(true);
      } catch (err) {
        if (!silent) {
          toast.error(getApiErrorMessage(err, "تعذر تحميل قائمة التجهيز"));
          setFetchError(true);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Live: a piece arriving from الكوي must appear without the worker refreshing.
  useProductionEvents((e) => {
    if (e.type !== "presence") load({ silent: true });
  });

  const markBusy = (key: string, on: boolean) =>
    setBusyKeys((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const pieces = useMemo(() => {
    return rows
      .filter((r) => r.status === view)
      .filter((r) => !sourceFilter || r.source === sourceFilter)
      .filter((r) => !repFilter || r.wholesaler_name === repFilter)
      .filter((r) => !garment || r.product_type === garment)
      // Was student_name alone. The preparer is holding the garment, so the words stitched
      // ON it are the fastest handle they have — and the university/department/rep were
      // searchable on /staff/queue but not here. One shared matcher, one behaviour.
      .filter((r) => matchesQueueSearch(r, search))
      .map(queueToPiece);
  }, [rows, view, search, sourceFilter, repFilter, garment]);

  // Built from the tab + source/rep filters but NOT from `garment` itself — a chip that
  // disappeared the moment you pressed it would leave no way back to «الكل».
  const garmentChips = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (r.status !== view) continue;
      if (sourceFilter && r.source !== sourceFilter) continue;
      if (repFilter && r.wholesaler_name !== repFilter) continue;
      m.set(r.product_type, (m.get(r.product_type) ?? 0) + 1);
    }
    return GARMENT_ORDER.filter((t) => m.has(t)).map((t) => ({
      type: t as string,
      label: (PRODUCT_TYPE_LABELS as Record<string, string>)[t] ?? t,
      count: m.get(t)!,
    }));
  }, [rows, view, sourceFilter, repFilter]);

  // A garment that is not in this tab (switching «قيد التجهيز» → «جاهزة») would filter the
  // list to nothing behind a chip row that no longer offers it. Fall back to «الكل».
  useEffect(() => {
    if (!loadedOnce || !garment) return;
    if (!garmentChips.some((c) => c.type === garment)) setGarment("");
  }, [garmentChips, garment, loadedOnce]);

  const repOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.status === view && r.wholesaler_name) s.add(r.wholesaler_name);
    }
    return [...s].sort((a, b) => a.localeCompare(b, "ar"));
  }, [rows, view]);

  const groups = useMemo(() => {
    const m = new Map<string, StudentGroup>();
    for (const p of pieces) {
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
          photoCount: 0,
          overdue: false,
          set: { total: 0, waiting: [] },
        };
        m.set(key, g);
      }
      g.pieces.push(p);
      g.photoCount += (p.zones ?? []).filter((z) => z.image_url).length;
      if (isPieceOverdue(p.deadline)) g.overdue = true;
    }
    const built = [...m.values()];
    for (const g of built) g.set = summarizeSet(g.pieces);
    return built;
  }, [pieces]);

  const pieceCount = pieces.length;

  // «السابق»/«التالي» inside the order page. The sequence handed over is the pieces in the
  // order this list shows them — student by student, each student's pieces together — which
  // is the only sequence the worker can predict. Same channel /staff/queue already uses; see
  // lib/queue-neighbors.ts for why it is deliberately best-effort.
  useEffect(() => {
    if (loading) return;
    rememberQueueOrder(groups.flatMap((g) => g.pieces.map((p) => p.id)));
  }, [groups, loading]);

  const openGroup = useMemo(
    () => groups.find((g) => g.key === openStudentKey) ?? null,
    [groups, openStudentKey]
  );
  // A student whose every piece was finished in this session drops out of `groups`, but the
  // sheet must stay open on its ✓ rows until the worker closes it.
  const openGhosts = openStudentKey ? ghosts[openStudentKey] ?? [] : [];
  const sheetOpen = !!openStudentKey && (!!openGroup || openGhosts.length > 0);

  // Any change to WHAT is listed closes a sheet that may no longer be in the list.
  // Skipped on mount: the FIRST run would otherwise wipe the openStudentKey restored from
  // sessionStorage, which is the whole point of persisting it (back from التفاصيل must
  // reopen the sheet the worker was in).
  const filtersMounted = useRef(false);
  useEffect(() => {
    if (!filtersMounted.current) {
      filtersMounted.current = true;
      return;
    }
    setOpenStudentKey(null);
  }, [view, sourceFilter, repFilter, garment]);

  function recordGhost(piece: StationPiece) {
    const key = piece.studentId || piece.studentName;
    setGhosts((prev) => ({
      ...prev,
      [key]: [...(prev[key] ?? []), { piece, label: "أصبحت جاهزة" }],
    }));
  }

  async function finishPiece(piece: StationPiece) {
    markBusy(piece.id, true);
    try {
      await advanceOrder(piece.id);
      toast.success("تم إنهاء التجهيز");
      recordGhost(piece);
      // Drop it locally so the row disappears instantly — the SSE reload confirms.
      setRows((prev) => prev.filter((r) => r.id !== piece.id));
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إنهاء التجهيز"));
      void load({ silent: true });
    } finally {
      markBusy(piece.id, false);
    }
  }

  async function finishStudent(g: StudentGroup) {
    const advanceable = g.pieces.filter((p) => p.canComplete);
    if (!advanceable.length) return;
    const ids = advanceable.map((p) => p.id);
    ids.forEach((id) => markBusy(id, true));
    try {
      const res = await advanceBulk(ids);
      // Report what actually happened. A silent partial success here would have the
      // worker bag a set the pipeline still considers unfinished.
      if (res.skipped > 0) {
        toast.warning(`أُنجزت ${res.advanced} قطعة، وتعذّر نقل ${res.skipped}`);
      } else {
        toast.success(`تم إنهاء تجهيز ${res.advanced} قطعة`);
      }
      const moved = new Set(res.results.filter((r) => r.ok).map((r) => r.id));
      advanceable.filter((p) => moved.has(p.id)).forEach(recordGhost);
      setRows((prev) => prev.filter((r) => !moved.has(r.id)));
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إنهاء التجهيز"));
      void load({ silent: true });
    } finally {
      ids.forEach((id) => markBusy(id, false));
    }
  }

  const openAdvanceable = openGroup?.pieces.filter((p) => p.canComplete) ?? [];
  const openAnyBusy = openGroup?.pieces.some((p) => busyKeys.has(p.id)) ?? false;

  // «السابق»/«التالي» through the students (owner 2026-08-21). Stepping over the FILTERED
  // `groups`, not the raw rows: that is the sequence on screen, and it is the only one the
  // worker can predict — landing on a student their own search excluded would read as a bug.
  //
  // A student whose every piece was finished in this session drops out of `groups` while the
  // sheet stays open on their ✓ ghosts, so the index can legitimately be -1. Then there is no
  // «here» to step from and the nav is simply not rendered.
  const openIndex = openStudentKey ? groups.findIndex((g) => g.key === openStudentKey) : -1;
  const sheetNav =
    openIndex >= 0
      ? {
          position: openIndex + 1,
          total: groups.length,
          onPrev:
            openIndex > 0 ? () => setOpenStudentKey(groups[openIndex - 1].key) : null,
          onNext:
            openIndex < groups.length - 1
              ? () => setOpenStudentKey(groups[openIndex + 1].key)
              : null,
        }
      : undefined;

  return (
    <div dir="rtl" lang="ar" className="space-y-5 pb-28">
      <PageHeader
        title="قائمة التجهيز"
        subtitle={
          loading ? "جارٍ التحميل…" : `${pieceCount} قطعة · ${groups.length} طالب`
        }
        action={
          <Button variant="ghost" onClick={() => load()} loading={loading}>
            تحديث
          </Button>
        }
      />

      {/* View toggle — same shape as the station console's «عرض بالطلب / عرض بالقطع» */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-sink p-1">
        {(Object.keys(VIEW_META) as View[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => {
              if (view === v) return;
              setView(v);
            }}
            aria-pressed={view === v}
            className={`min-h-11 rounded-xl px-3 text-sm font-bold transition-colors ${
              view === v
                ? "bg-orange-ink text-white shadow-[var(--shadow-soft)]"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            {VIEW_META[v].tab}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="surface-card space-y-3 rounded-2xl p-3.5">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="بحث بالاسم أو الجامعة أو التطريز…"
          className="w-full"
        />
        {showSourceFilter && (
          <div className="flex gap-2">
            {(
              [
                { id: "", label: "الكل" },
                { id: "retail", label: "تجزئة" },
                { id: "wholesaler", label: "ممثلين" },
              ] as { id: SourceFilter; label: string }[]
            ).map((s) => (
              <button
                key={s.id || "all"}
                type="button"
                onClick={() => {
                  if (sourceFilter === s.id) return;
                  setSourceFilter(s.id);
                  // Reps don't apply to retail — clear a stale rep filter that the
                  // (now hidden) select could no longer undo.
                  if (s.id === "retail") setRepFilter("");
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
        {/* Garment chips — see GARMENT_ORDER above for why these are garments, not zones. */}
        {garmentChips.length > 1 && (
          <nav
            aria-label="تصفية حسب القطعة"
            className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {/* «الكل» counts across the garments, NOT `pieces.length` — that is already
                garment-filtered, so it would read «الكل ٤٠» while showing 40 robes. */}
            {[
              {
                type: "",
                label: "الكل",
                count: garmentChips.reduce((n, c) => n + c.count, 0),
              },
              ...garmentChips,
            ].map((c) => (
              <button
                key={c.type || "all"}
                type="button"
                onClick={() => setGarment(c.type)}
                aria-pressed={garment === c.type}
                className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-3.5 text-xs font-bold transition-colors ${
                  garment === c.type
                    ? "border-orange-ink bg-orange-ink/10 text-orange-ink"
                    : "border-line text-ink-soft hover:text-ink"
                }`}
              >
                {c.label}
                <span className="tabular-nums opacity-70">{toArabicDigits(c.count)}</span>
              </button>
            ))}
          </nav>
        )}
        {sourceFilter !== "retail" && repOptions.length > 0 && (
          <Select
            aria-label="الممثل"
            value={repFilter}
            onChange={(e) => setRepFilter(e.target.value)}
            options={[
              { value: "", label: "كل الممثلين" },
              ...repOptions.map((r) => ({ value: r, label: r })),
            ]}
          />
        )}
      </div>

      {/* Body */}
      {loading ? (
        <div className="space-y-2.5" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : fetchError ? (
        <div className="rounded-2xl border border-[var(--color-danger)]/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
          <p className="text-base font-semibold text-ink">تعذر تحميل قائمة التجهيز</p>
          <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
          <Button className="mt-4" onClick={() => load()}>
            إعادة المحاولة
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <EmptyState message={search.trim() ? "لا نتائج لهذا البحث" : VIEW_META[view].empty} />
      ) : (
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
                    {g.photoCount > 0 ? ` · ${g.photoCount} صورة تطريز` : ""}
                    {g.batchName ? ` · ${g.batchName}` : g.source === "retail" ? " · تجزئة" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* The set (bug 8, part 4). «مكتمل» is the rare state and the one that
                      authorises bagging, so it is the one that gets colour; a set still
                      missing pieces just states the fraction. */}
                  {g.set.total > 1 &&
                    (g.set.waiting.length === 0 ? (
                      <span className="rounded-full bg-green-600/10 px-2 py-0.5 text-[10px] font-bold text-green-700">
                        الطقم مكتمل
                      </span>
                    ) : (
                      <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-ink-soft">
                        {toArabicDigits(g.set.total - g.set.waiting.length)} من {toArabicDigits(g.set.total)}
                      </span>
                    ))}
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
      )}

      {sheetOpen && (
        <StudentSheet
          kind="preparing"
          studentName={openGroup?.name ?? openGhosts[0]?.piece.studentName ?? "طالب"}
          batchName={openGroup?.batchName ?? null}
          info={studentInfoLine(openGroup)}
          pieces={openGroup?.pieces ?? []}
          ghosts={openGhosts}
          busyKeys={busyKeys}
          fromPath={pathname}
          // «جاهزة للتسليم» rows can never advance from here — تأكيد التسليم collects a
          // delivery method + recipient, so it lives on the detail page and the backend
          // grants no one-tap advance out of 'ready'. Without this the whole tab reads
          // «لا يمكن إكمال هذه القطعة من هنا حالياً», which is true and useless.
          noActionHint={
            view === "ready" ? "أكّد التسليم من «التفاصيل»." : undefined
          }
          waitingPieces={openGroup?.set.waiting}
          nav={sheetNav}
          onClose={() => setOpenStudentKey(null)}
          // التجهيز zones are read-only, so this is never reached — the sheet renders no
          // tick targets for kind="preparing".
          onTickZone={() => {}}
          onComplete={finishPiece}
          footer={
            openGroup && openAdvanceable.length > 1 ? (
              <Button
                fullWidth
                loading={openAnyBusy}
                onClick={() => finishStudent(openGroup)}
              >
                إنهاء كل القطع ({openAdvanceable.length})
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
