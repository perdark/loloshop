"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "@/lib/api";
import type { OrderStatus, StudentApprovalStatus, WholesalerStudentRow } from "@/lib/types";
import {
  FULLSET_ZONE_LABELS,
  FULLSET_ZONE_ORDER,
  type FullSetZone,
} from "@/lib/constants";
import {
  advanceBulk,
  getWholesalerOrders,
  type WholesalerAccountSummary,
  type WholesalerOrderRow,
} from "@/lib/staff";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { formatIQD } from "@/lib/format";
import { Count } from "@/components/ui/Count";
import { CalculationDetails } from "@/components/admin/CalculationDetails";
import { matchesAr } from "@/lib/arabic";

// ─── Shared status pill (warm brand palette, no blue/purple) ──────────────────
const STATUS_PILL: Partial<Record<OrderStatus, string>> = {
  pending_approval: "bg-ink/5 text-muted",
  designing: "bg-ink/5 text-muted",
  design_complete: "bg-peach/70 text-orange-ink",
  converting: "bg-orange/15 text-orange-ink",
  staff_review: "bg-ink/5 text-muted",
  printing: "bg-ink/5 text-muted",
  embroidery: "bg-orange-ink/15 text-orange-ink",
  pressing: "bg-amber-100 text-amber-800",
  preparing: "bg-ink/8 text-ink-soft",
  ready: "bg-emerald-100 text-emerald-700",
  delivered: "bg-ink/10 text-ink-soft",
  cancelled: "bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
};
function statusPill(s: OrderStatus): string {
  return STATUS_PILL[s] ?? "bg-ink/5 text-muted";
}

// Module-scope (not in render) so the React purity rule doesn't flag Date.now().
function isOverdueOrder(o: WholesalerOrderRow): boolean {
  if (o.deadline == null || o.isDone) return false;
  return new Date(o.deadline).getTime() < Date.now();
}

type Tab = "orders" | "roster";

// ─── Session persistence — mid-batch back-navigation restore ──────────────────
// Mirrors components/staff/station/StationConsole.tsx's STORAGE_PREFIX/readStored
// pattern, adapted for TWO components (this page's tab + OrdersTab's own filters)
// sharing one per-rep sessionStorage bucket via a read-merge-write helper.
// NOT a lazy useState initializer: unlike StationConsole (which only ever mounts
// behind /staff's client-only auth loading gate), this page renders OrdersTab/
// RosterTab immediately regardless of auth-loading state — so it CAN be part of
// the initial SSR/prerender HTML. Restoring inside a mount effect (gated by a
// `restored` flag) avoids reading sessionStorage during the hydration render,
// which would mismatch the server pass (no `window` there).
const STORAGE_PREFIX = "loloshop-rep-console:";

interface StoredConsoleState {
  tab?: Tab;
  zone?: FullSetZone | "";
  view?: CompletionView;
  search?: string;
  selected?: string[];
  /** Where they were in the work list — see "Scroll restore" in OrdersTab. */
  scrollY?: number;
}

function readStored(wholesalerId: string): StoredConsoleState {
  if (typeof window === "undefined" || !wholesalerId) return {};
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_PREFIX + wholesalerId) || "{}") as StoredConsoleState;
  } catch {
    return {};
  }
}

function writeStored(wholesalerId: string, patch: Partial<StoredConsoleState>) {
  if (typeof window === "undefined" || !wholesalerId) return;
  try {
    const current = readStored(wholesalerId);
    sessionStorage.setItem(STORAGE_PREFIX + wholesalerId, JSON.stringify({ ...current, ...patch }));
  } catch {
    /* storage full/unavailable — persistence is best-effort */
  }
}

function isValidZone(z: unknown): z is FullSetZone | "" {
  return z === "" || FULLSET_ZONE_ORDER.includes(z as FullSetZone);
}
function isValidCompletionView(v: unknown): v is CompletionView {
  return v === "all" || v === "actionable" || v === "done" || v === "mine";
}

export default function StaffWholesalerStudentsPage() {
  const { wholesalerId } = useParams<{ wholesalerId: string }>();
  const { user } = useRequireAuth(["staff", "admin"]);
  const isAdmin = user?.role === "admin";
  const [tab, setTab] = useState<Tab>("orders");
  // See "Session persistence" above — restored via a mount effect, not lazy init.
  const [tabRestored, setTabRestored] = useState(false);

  useEffect(() => {
    const stored = readStored(wholesalerId);
    if (stored.tab === "orders" || stored.tab === "roster") setTab(stored.tab);
    setTabRestored(true);
  }, [wholesalerId]);

  useEffect(() => {
    if (!tabRestored) return;
    writeStored(wholesalerId, { tab });
  }, [wholesalerId, tab, tabRestored]);

  return (
    <div dir="rtl" lang="ar" className="space-y-6 pb-28">
      <Link
        href="/staff/wholesalers"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-orange-ink transition-colors hover:text-orange"
      >
        <span aria-hidden>→</span> الممثلون
      </Link>

      <PageHeader title="طلبات الممثل" subtitle="طلبات طلاب الممثل — صمّم، طرّز، وأكمل دفعةً واحدة" />

      {/* Tabs — big tap targets, full-width on mobile */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-sink p-1">
        {([
          { id: "orders", label: "الطلبات" },
          { id: "roster", label: "الطلاب" },
        ] as { id: Tab; label: string }[]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`min-h-11 rounded-xl px-4 text-sm font-bold transition-colors ${
              tab === t.id
                ? "bg-orange-ink text-white shadow-[var(--shadow-soft)]"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "orders" ? (
        <OrdersTab wholesalerId={wholesalerId} isAdmin={isAdmin} ready={!!user} />
      ) : (
        <RosterTab wholesalerId={wholesalerId} isAdmin={isAdmin} ready={!!user} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Orders tab — the rep-scoped order-working console
// ══════════════════════════════════════════════════════════════════════════════

// "mine" = only the stages the VIEWER personally works (backend `my_stages`). It is the
// default for anyone who has a station, because «الكل» meant a designer opened a rep with
// 402 rows — 276 قيد التطريز, 120 قيد التجهيز, 1 قيد الكوي — and 5 of them were his.
// Distinct from "actionable": a preparer's «جاهز للاستلام» rows are their work but are
// deliberately NOT bulk-advanceable (delivery needs the modal), so they'd vanish from
// "actionable" while still belonging in "mine".
type CompletionView = "all" | "actionable" | "done" | "mine";

function OrdersTab({
  wholesalerId,
  isAdmin,
  ready,
}: {
  wholesalerId: string;
  isAdmin: boolean;
  ready: boolean;
}) {
  const [orders, setOrders] = useState<WholesalerOrderRow[]>([]);
  const [accountSummary, setAccountSummary] = useState<WholesalerAccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [zone, setZone] = useState<FullSetZone | "">("");
  const [view, setView] = useState<CompletionView>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  // TRUE once sessionStorage has been read on mount (see "Session persistence" above) —
  // gates the data fetch (so a restored zone doesn't fetch twice: once with the stale
  // default then again with the restored value) and the write-back effect below.
  const [restored, setRestored] = useState(false);
  // TRUE after the first successful fetch — the restored selection must not be pruned
  // against the EMPTY pre-fetch order list (mirrors StationConsole's loadedOnce).
  const [loadedOnce, setLoadedOnce] = useState(false);
  // The stages this viewer personally works, from the backend. [] = manager/admin/مفصل,
  // who have no station and therefore stay on «الكل».
  const [myStages, setMyStages] = useState<OrderStatus[]>([]);
  // Did sessionStorage already hold a view? If so it is the worker's own last choice and
  // outranks the stage default — otherwise switching to «الكل» would not survive a tap
  // into an order and back.
  const hadStoredView = useRef(false);
  // The stage default is applied at most ONCE per rep, on the first load. Without this the
  // zone-chip refetch would drag the worker back to «مرحلتي» every time they filtered.
  const stageDefaultSettled = useRef(false);
  // TRUE once the scroll offset has been re-applied (or deliberately skipped) — see
  // "Scroll restore" below.
  const [scrollReady, setScrollReady] = useState(false);

  // Restore this rep's last zone/view/search/selection.
  useEffect(() => {
    const stored = readStored(wholesalerId);
    if (isValidZone(stored.zone)) setZone(stored.zone);
    if (isValidCompletionView(stored.view)) setView(stored.view);
    if (typeof stored.search === "string") setSearch(stored.search);
    if (Array.isArray(stored.selected)) setSelected(new Set(stored.selected));
    hadStoredView.current = isValidCompletionView(stored.view);
    stageDefaultSettled.current = false;
    setScrollReady(false);
    setRestored(true);
  }, [wholesalerId]);

  // Mirror the UI state so back-navigation restores it exactly.
  useEffect(() => {
    if (!restored) return;
    writeStored(wholesalerId, { zone, view, search, selected: [...selected] });
  }, [wholesalerId, zone, view, search, selected, restored]);

  // Zone is the only server-side filter (refetches); completion/search are client-side.
  const load = useCallback(() => {
    if (!wholesalerId) return;
    setLoading(true);
    setFetchError(false);
    getWholesalerOrders(wholesalerId, { zone: zone || undefined, isAdmin })
      .then(({ orders: rows, summary, myStages: stages }) => {
        setOrders(rows);
        setAccountSummary(summary);
        setMyStages(stages);
        setLoadedOnce(true);
        // Open on the viewer's own station the first time they land on this rep. Batched
        // with setOrders and applied while `loading` is still true, so the list never
        // flashes «الكل» before snapping down to the smaller stage view.
        if (!stageDefaultSettled.current) {
          stageDefaultSettled.current = true;
          if (stages.length === 0) {
            // No station (manager/admin/مفصل). A "mine" left in storage — a changed role,
            // a shared device — would filter to nothing, so fall back to «الكل».
            setView((v) => (v === "mine" ? "all" : v));
          } else if (!hadStoredView.current) {
            setView("mine");
          }
        }
      })
      .catch((err) => {
        toast.error(getApiErrorMessage(err, "تعذر تحميل الطلبات"));
        setFetchError(true);
      })
      .finally(() => setLoading(false));
  }, [wholesalerId, zone, isAdmin]);

  useEffect(() => {
    if (!ready || !restored) return;
    load();
  }, [ready, restored, load]);

  // ─── Scroll restore ─────────────────────────────────────────────────────────
  // Zone/view/search/selection already survived back-navigation; the scroll offset did not,
  // and with 400+ rows that is what actually reads as "it forgot where I was". The reason
  // it cannot be left to the browser: coming back re-mounts this tab with `orders` empty,
  // so it paints six skeletons and the document is a few hundred px tall at exactly the
  // moment the offset would be re-applied — it clamps to 0, and by the time the rows land
  // the position is gone. So we remember it ourselves and re-apply AFTER the rows paint.

  // Save. Trailing-throttled: a fast flick on a low-end Android would otherwise re-serialise
  // the whole bucket every frame. Gated on `scrollReady` so a scroll event fired while the
  // list is still short (including the browser's own restore attempt) cannot overwrite the
  // saved offset with ~0 before we have read it.
  useEffect(() => {
    if (!scrollReady) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        writeStored(wholesalerId, { scrollY: Math.round(window.scrollY) });
      }, 200);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
    };
  }, [wholesalerId, scrollReady]);

  // Restore, once, on the first render that actually has rows in it.
  useEffect(() => {
    if (scrollReady || loading || !loadedOnce) return;
    const y = readStored(wholesalerId).scrollY;
    setScrollReady(true); // arms the saver above, even when there is nothing to restore
    if (typeof y !== "number" || y <= 0) return;
    if (window.scrollY > 4) return; // they already started scrolling — don't yank them back
    // Clamped, so a shorter filtered list can't leave the page stranded past its own end.
    const apply = () => {
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      // behavior:"instant" is REQUIRED here, not a preference. globals.css:499 sets
      // `scroll-behavior: smooth` on the root, so the plain scrollTo(0, y) form starts an
      // ANIMATION — and the router's own post-navigation scroll cancels it before it
      // travels. Measured in a real browser: the restore ran with the correct offset and
      // the page never moved, no scroll event ever fired. Restoring a remembered position
      // should be a jump anyway, not a visible ride down 281 rows.
      window.scrollTo({ top: Math.min(y, max), left: 0, behavior: "instant" });
    };
    // Apply immediately: the rows are committed and laid out by the time an effect runs, so
    // this is enough on its own. It must NOT be left to requestAnimationFrame alone — a tab
    // that is not painting never fires one, and the restore would silently never happen
    // (measured in a backgrounded tab: rAF callbacks 0, scrollTo calls 0).
    apply();
    // Then once more next frame, to absorb a late height change (images, fonts) that would
    // otherwise leave the offset slightly off. Harmless when it never fires.
    const raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
  }, [wholesalerId, loading, loadedOnce, scrollReady]);

  // Selection can only reference orders that still exist AND are still advanceable
  // (a reload prunes it). Gated on loadedOnce so a RESTORED selection isn't wiped
  // against the empty pre-fetch order list.
  useEffect(() => {
    if (!loadedOnce) return;
    setSelected((prev) => {
      const valid = new Set(orders.filter((o) => o.canAdvance).map((o) => o.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [orders, loadedOnce]);

  const myStageSet = useMemo(() => new Set<string>(myStages), [myStages]);

  const filtered = useMemo(() => {
    let out = orders;
    if (view === "actionable") out = out.filter((o) => o.canAdvance);
    else if (view === "done") out = out.filter((o) => o.isDone);
    // A viewer with no station falls through to «الكل» rather than an empty list.
    else if (view === "mine" && myStageSet.size > 0)
      out = out.filter((o) => myStageSet.has(o.status));
    if (search.trim()) {
      // Spelling-insensitive — see lib/arabic.ts. 28% of student names carry a
      // variant character («سرى» vs «سري»), and a raw includes() hid every one of
      // them from whoever typed the other spelling.
      out = out.filter((o) => matchesAr(o.studentName, search));
    }
    return out;
  }, [orders, view, search, myStageSet]);

  // Only advanceable rows in the current view can be batch-completed.
  const selectableIds = useMemo(
    () => filtered.filter((o) => o.canAdvance).map((o) => o.id),
    [filtered]
  );
  const allSelectableChecked =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      if (allSelectableChecked) {
        const next = new Set(prev);
        selectableIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...selectableIds]);
    });

  const selectedCount = selected.size;

  async function doBulkComplete() {
    if (selectedCount === 0) return;
    setBulkLoading(true);
    try {
      const res = await advanceBulk([...selected]);
      if (res.advanced > 0) {
        toast.success(
          res.skipped > 0
            ? `تم إكمال ${res.advanced} طلب · تخطّي ${res.skipped}`
            : `تم إكمال ${res.advanced} طلب`
        );
      } else {
        toast.error("لم يكن بالإمكان إكمال أي طلب من المحدد");
      }
      load(); // refresh statuses + can_advance
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إكمال الطلبات"));
    } finally {
      setBulkLoading(false);
    }
  }

  const counts = useMemo(
    () => ({
      total: orders.length,
      actionable: orders.filter((o) => o.canAdvance).length,
      done: orders.filter((o) => o.isDone).length,
      mine: orders.filter((o) => myStageSet.has(o.status)).length,
    }),
    [orders, myStageSet]
  );
  // Opening an order should return to THIS rep's page (not the generic /staff home).
  const backFrom = `/staff/wholesalers/${wholesalerId}/students`;

  return (
    <div className="space-y-4">
      {accountSummary && <WholesalerSummary summary={accountSummary} />}
      {/* Zone chips — horizontal scroll on mobile */}
      <nav
        aria-label="تصفية حسب مكان التطريز"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ZoneChip label="الكل" active={zone === ""} onClick={() => setZone("")} />
        {FULLSET_ZONE_ORDER.map((z) => (
          <ZoneChip
            key={z}
            label={FULLSET_ZONE_LABELS[z]}
            active={zone === z}
            onClick={() => setZone(z)}
          />
        ))}
      </nav>

      {/* Completion segmented control + search */}
      <div className="surface-card space-y-3 rounded-2xl p-3.5">
        <div className="flex flex-wrap gap-2">
          {([
            // «مرحلتي» leads because it is the default — but only for a viewer who HAS a
            // station. A manager/admin/مفصل gets the original three, unchanged.
            ...(myStages.length > 0
              ? [{ id: "mine" as CompletionView, label: `مرحلتي (${counts.mine})` }]
              : []),
            { id: "all", label: `الكل (${counts.total})` },
            { id: "actionable", label: `يخصّني الآن (${counts.actionable})` },
            { id: "done", label: `منجز (${counts.done})` },
          ] as { id: CompletionView; label: string }[]).map((o) => (
            <Button
              key={o.id}
              size="sm"
              variant={view === o.id ? "primary" : "ghost"}
              onClick={() => setView(o.id)}
            >
              {o.label}
            </Button>
          ))}
        </div>
        <Input
          type="search"
          placeholder="بحث باسم الطالب…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full"
          aria-label="بحث باسم الطالب"
        />
      </div>

      {loading ? (
        <div className="space-y-2.5" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : fetchError ? (
        <div className="rounded-2xl border border-[var(--color-danger)]/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
          <p className="text-base font-semibold text-ink">تعذر تحميل الطلبات</p>
          <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
          <Button className="mt-4" onClick={load}>إعادة المحاولة</Button>
        </div>
      ) : filtered.length === 0 ? (
        // «مرحلتي» is the DEFAULT now, so "nothing at my station for this rep" is a normal,
        // frequent landing — it has to read as an answer with a way onward, not as a broken
        // page. Requires counts.total > 0: a rep with no orders at all is genuinely empty,
        // and offering «عرض كل الطلبات (0)» there would be a dead end. Neutral wording, not
        // «أنهيت», because the usual reason is that the work was never his, not that he
        // finished it. Every other filter keeps the original one-liner.
        view === "mine" && !search.trim() && counts.total > 0 ? (
          // PIECES — `counts.total` is `orders.length`, one row per piece. This screen saying
          // «طلب» is why the same rep read 40 on /admin (bundles) and 118 here.
          <EmptyState
            title="لا يوجد عمل يخصّك عند هذا الممثل"
            message={`لا توجد قطع في مرحلتك هنا — لدى هذا الممثل ${counts.total} قطعة في مراحل أخرى.`}
            action={
              <Button size="sm" variant="ghost" onClick={() => setView("all")}>
                عرض كل القطع ({counts.total})
              </Button>
            }
          />
        ) : (
          <EmptyState message="لا توجد طلبات مطابقة لهذا التصفية." />
        )
      ) : (
        <>
          {/* Select-all-completable affordance */}
          {selectableIds.length > 0 && (
            <button
              type="button"
              onClick={toggleAll}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink-soft transition-colors hover:border-orange-ink/30"
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-md border-2 ${
                  allSelectableChecked
                    ? "border-orange-ink bg-orange-ink text-white"
                    : "border-ink/30"
                }`}
                aria-hidden
              >
                {allSelectableChecked ? "✓" : ""}
              </span>
              تحديد كل القابل للإكمال ({selectableIds.length})
            </button>
          )}

          <ul className="space-y-2.5">
            {filtered.map((o) => (
              <OrderRow
                key={o.id}
                order={o}
                checked={selected.has(o.id)}
                onToggle={() => toggleOne(o.id)}
                pill={statusPill(o.status)}
                backFrom={backFrom}
              />
            ))}
          </ul>
        </>
      )}

      {/* Sticky bulk-action bar — clears the desktop sidebar via lg:ms-64 */}
      {selectedCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur lg:ms-64">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="min-h-11 px-2 text-sm font-medium text-ink-soft hover:text-ink"
            >
              إلغاء التحديد ({selectedCount})
            </button>
            <Button onClick={doBulkComplete} loading={bulkLoading} className="min-w-[8rem]">
              إكمال ({selectedCount})
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ZoneChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-pill px-4 text-sm font-semibold transition-colors ${
        active
          ? "bg-orange-ink text-white"
          : "bg-surface text-ink-soft ring-1 ring-ink/10 hover:bg-surface-sink"
      }`}
    >
      {label}
    </button>
  );
}

function OrderRow({
  order,
  checked,
  onToggle,
  pill,
  backFrom,
}: {
  order: WholesalerOrderRow;
  checked: boolean;
  onToggle: () => void;
  pill: string;
  backFrom: string;
}) {
  const overdue = isOverdueOrder(order);

  return (
    <li className="flex items-stretch gap-1 rounded-2xl border border-line bg-surface shadow-[var(--shadow-soft)]">
      {/* Checkbox — disabled when this staff can't advance the order (no ghost 409s) */}
      <button
        type="button"
        onClick={onToggle}
        disabled={!order.canAdvance}
        aria-label={order.canAdvance ? "تحديد الطلب" : "لا يمكنك إكمال هذا الطلب الآن"}
        aria-pressed={checked}
        className={`flex w-14 shrink-0 items-center justify-center rounded-s-2xl transition-colors ${
          order.canAdvance ? "hover:bg-surface-sink" : "cursor-not-allowed opacity-40"
        }`}
      >
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-md border-2 text-sm ${
            !order.canAdvance
              ? "border-ink/15"
              : checked
                ? "border-orange-ink bg-orange-ink text-white"
                : "border-ink/30"
          }`}
          aria-hidden
        >
          {checked && order.canAdvance ? "✓" : ""}
        </span>
      </button>

      {/* Body — tap opens the full order */}
      <Link
        href={`/staff/orders/${order.id}?from=${encodeURIComponent(backFrom)}`}
        className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 pe-4 ps-1"
      >
        <div className="min-w-0">
          <p className="truncate font-display text-[15px] font-bold text-ink">
            {order.studentName}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-soft">
            {order.productName}
            {order.batchName ? ` · ${order.batchName}` : ""}
          </p>
          {order.adminAmount != null && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs"><span className="text-ink-soft">سعر الإدارة: <b className="text-ink" dir="ltr">{formatIQD(order.adminAmount)}</b></span><span className="text-ink-soft">سعر الممثل: <b className="text-orange-ink" dir="ltr">{formatIQD(order.wholesalerAmount || 0)}</b></span></div>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${pill}`}>
            {order.statusLabel}
          </span>
          {overdue && (
            <span className="rounded-full bg-[var(--color-danger)]/10 px-2 py-0.5 text-[10px] font-bold text-[var(--color-danger)]">
              متأخر
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

function WholesalerSummary({ summary }: { summary: WholesalerAccountSummary }) {
  const { inventory, money } = summary;
  const inventoryRows = [
    ["وشاح ملكي", inventory.sashRoyal],
    ["وشاح عادي", inventory.sashNormal],
    ["قبعة ملكية", inventory.capRoyal],
    ["قبعة عادية", inventory.capNormal],
  ] as const;
  return (
    <section className="space-y-3" aria-label="الجرد والحساب المؤكد">
      <div className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-ink">الجرد المؤكد</h2>
            <p className="mt-0.5 text-xs text-ink-soft">قطع الطلبات الموافق عليها وغير الملغاة</p>
          </div>
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
            مؤكد فقط
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line sm:grid-cols-4">
          {inventoryRows.map(([label, value]) => (
            <div key={label} className="bg-surface-sink p-3 text-center">
              <p className="text-xs font-semibold text-ink-soft">{label}</p>
              <Count
                value={value}
                unit="piece"
                className="mt-1 block text-lg font-bold text-ink"
                unitClassName="text-[10px] font-medium text-ink-soft"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4">
        <div>
          <h2 className="text-sm font-bold text-ink">الحساب المؤكد</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            لا يتغير عند تصفية قائمة العمل أدناه
          </p>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <MoneyTotal label="يجمعه الممثل من الطلاب" value={money.studentTotal} accent />
          <MoneyTotal label="حصة الإدارة" value={money.adminTotal} />
          <MoneyTotal label="ربح الممثل" value={money.representativeProfit} positive />
        </div>
        <p className="mt-3 rounded-xl bg-ink/[0.04] px-3 py-2 text-sm font-semibold text-ink">
          ربح الممثل = {formatIQD(money.studentTotal)} − {formatIQD(money.adminTotal)} ={" "}
          <span className="text-emerald-700">{formatIQD(money.representativeProfit)}</span>
        </p>

        <CalculationDetails summary="شرح الحساب بنداً بنداً" className="mt-3">
          {money.lines.length === 0 ? (
            <p>لا توجد مبالغ مؤكدة لهذا الممثل.</p>
          ) : (
            <>
              <div className="space-y-2 sm:hidden">
                {money.lines.map((line, index) => (
                  <div
                    key={`${line.label}-${index}`}
                    className={`rounded-xl p-3 ${
                      line.kind === "adjustment" ? "bg-amber-50 text-amber-900" : "bg-surface"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold">{line.label}</p>
                      {line.qty > 0 && <span className="text-xs">×{line.qty}</span>}
                    </div>
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                      <MoneyCell label="الطلاب" value={line.studentAmount} />
                      <MoneyCell label="الإدارة" value={line.adminAmount} />
                      <MoneyCell label="ربح الممثل" value={line.representativeProfit} />
                    </dl>
                  </div>
                ))}
              </div>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[520px] border-collapse text-right text-xs">
                  <thead>
                    <tr className="border-b border-line text-ink-soft">
                      <th className="pb-2 pe-2 font-semibold">البند المحفوظ</th>
                      <th className="px-2 pb-2 font-semibold">العدد</th>
                      <th className="px-2 pb-2 font-semibold">يدفعه الطلاب</th>
                      <th className="px-2 pb-2 font-semibold">حصة الإدارة</th>
                      <th className="ps-2 pb-2 font-semibold">ربح الممثل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {money.lines.map((line, index) => (
                      <tr
                        key={`${line.label}-${index}`}
                        className={`border-b border-line/60 last:border-0 ${
                          line.kind === "adjustment" ? "bg-amber-50 text-amber-900" : ""
                        }`}
                      >
                        <td className="py-2 pe-2 font-medium">{line.label}</td>
                        <td className="px-2 py-2" dir="ltr">{line.qty || "—"}</td>
                        <td className="px-2 py-2" dir="ltr">{formatIQD(line.studentAmount)}</td>
                        <td className="px-2 py-2" dir="ltr">{formatIQD(line.adminAmount)}</td>
                        <td className="ps-2 py-2 font-semibold" dir="ltr">
                          {formatIQD(line.representativeProfit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {money.lines.some((line) => line.kind === "adjustment") && (
                <p className="mt-3 text-[11px] leading-relaxed text-amber-800">
                  «تسوية / سجل قديم» تعني أن المبلغ النهائي المحفوظ يختلف عن تفاصيل البنود
                  المتاحة. تظهر التسوية صراحةً حتى يبقى الإجمالي مطابقاً للحساب المعتمد.
                </p>
              )}
            </>
          )}
        </CalculationDetails>
      </div>
    </section>
  );
}

function MoneyTotal({
  label,
  value,
  accent = false,
  positive = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
  positive?: boolean;
}) {
  return (
    <div className="rounded-xl bg-surface-sink p-3">
      <p className="text-xs text-ink-soft">{label}</p>
      <p
        className={`mt-1 text-base font-bold tabular-nums ${
          accent ? "text-orange-ink" : positive ? "text-emerald-700" : "text-ink"
        }`}
        dir="ltr"
      >
        {formatIQD(value)}
      </p>
    </div>
  );
}

function MoneyCell({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-ink-soft">{label}</dt>
      <dd className="mt-0.5 font-semibold text-ink" dir="ltr">{formatIQD(value)}</dd>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Roster tab — approval + completion status per student (the original view)
// ══════════════════════════════════════════════════════════════════════════════

interface RosterApiRow {
  id: string;
  name: string;
  phone: string;
  status: StudentApprovalStatus;
  university_name: string | null;
  department: string | null;
  order_status: string | null;
  is_completed?: boolean;
}

type CompletionFilter = "" | "completed" | "not_completed";
const PAGE_SIZE = 25;

function statusLabel(s: StudentApprovalStatus): string {
  if (s === "approved") return "موافق عليه";
  if (s === "rejected") return "مرفوض";
  return "بانتظار الموافقة";
}
function statusPillClass(s: StudentApprovalStatus): string {
  if (s === "approved") return "border-orange-ink/30 bg-orange-ink/10 text-orange-ink";
  if (s === "rejected") return "border-[var(--color-danger)]/25 bg-[var(--color-danger)]/8 text-[var(--color-danger)]";
  return "border-line bg-surface-sink text-ink-soft";
}

function RosterTab({
  wholesalerId,
  isAdmin,
  ready,
}: {
  wholesalerId: string;
  isAdmin: boolean;
  ready: boolean;
}) {
  const [rows, setRows] = useState<WholesalerStudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | StudentApprovalStatus>("");
  const [completion, setCompletion] = useState<CompletionFilter>("");
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    if (!wholesalerId) return;
    setLoading(true);
    setFetchError(false);
    const endpoint = isAdmin
      ? `/admin/wholesalers/${wholesalerId}/students`
      : `/staff/wholesalers/${wholesalerId}/students`;
    api
      .get<{ data: RosterApiRow[] }>(endpoint)
      .then(({ data }) => {
        setRows(
          (data.data || []).map((r) => ({
            id: r.id,
            name: r.name,
            phone: r.phone,
            status: r.status,
            universityName: r.university_name,
            department: r.department,
            orderStatus: (r.order_status as OrderStatus | null) ?? null,
            isCompleted: Boolean(r.is_completed),
          }))
        );
      })
      .catch((err) => {
        toast.error(getApiErrorMessage(err, "تعذر تحميل الطلاب"));
        setFetchError(true);
      })
      .finally(() => setLoading(false));
  }, [wholesalerId, isAdmin]);

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, load]);

  const filtersKey = `${search}|${statusFilter}|${completion}`;
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey);
  if (prevFiltersKey !== filtersKey) {
    setPrevFiltersKey(filtersKey);
    setPage(1);
  }

  const filtered = useMemo(() => {
    let out = rows;
    if (search.trim()) {
      out = out.filter((r) => matchesAr(r.name, search));
    }
    if (statusFilter) out = out.filter((r) => r.status === statusFilter);
    if (completion) {
      const wantCompleted = completion === "completed";
      out = out.filter((r) => r.isCompleted === wantCompleted);
    }
    return out;
  }, [rows, search, statusFilter, completion]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (loading) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-28 w-full rounded-2xl" />
        ))}
      </div>
    );
  }
  if (fetchError) {
    return (
      <div className="rounded-2xl border border-[var(--color-danger)]/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
        <p className="text-base font-semibold text-ink">تعذر تحميل بيانات الطلاب</p>
        <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
        <Button className="mt-4" onClick={load}>إعادة المحاولة</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="surface-card space-y-3 rounded-2xl p-3.5">
        <Input
          type="search"
          placeholder="بحث باسم الطالب…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full"
          aria-label="بحث باسم الطالب"
        />
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted">حالة الموافقة</p>
          <div className="flex flex-wrap gap-2">
            {[
              { id: "", label: "الكل" },
              { id: "pending_approval", label: "بانتظار" },
              { id: "approved", label: "موافق" },
              { id: "rejected", label: "مرفوض" },
            ].map((o) => (
              <Button
                key={o.id}
                size="sm"
                variant={statusFilter === (o.id as "" | StudentApprovalStatus) ? "primary" : "ghost"}
                onClick={() => setStatusFilter(o.id as "" | StudentApprovalStatus)}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted">حالة الاكتمال</p>
          <div className="flex flex-wrap gap-2">
            {[
              { id: "", label: "الكل" },
              { id: "completed", label: "مكتمل" },
              { id: "not_completed", label: "غير مكتمل" },
            ].map((o) => (
              <Button
                key={o.id}
                size="sm"
                variant={completion === (o.id as CompletionFilter) ? "primary" : "ghost"}
                onClick={() => setCompletion(o.id as CompletionFilter)}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="لا يوجد طلاب مطابقون لمعايير البحث." />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {paginated.map((s) => (
              <article
                key={s.id}
                className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-base font-bold text-ink">{s.name}</p>
                    <p className="text-sm text-ink-soft" dir="ltr">{s.phone}</p>
                    <p className="mt-1 text-xs text-muted">
                      {s.universityName || "—"}
                      {s.department ? ` — ${s.department}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusPillClass(s.status)}`}>
                      {statusLabel(s.status)}
                    </span>
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
                        s.isCompleted
                          ? "border-orange-ink/30 bg-orange-ink/10 text-orange-ink"
                          : "border-line bg-surface-sink text-muted"
                      }`}
                    >
                      {s.isCompleted ? "مكتمل" : "غير مكتمل"}
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {totalPages > 1 && (
            <nav className="mt-4 flex items-center justify-between gap-3 text-sm" aria-label="التنقل بين صفحات الطلاب">
              <span className="text-ink-soft">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} من {filtered.length}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage((p) => p - 1)} aria-label="الصفحة السابقة">→</Button>
                <Button size="sm" variant="ghost" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} aria-label="الصفحة التالية">←</Button>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
