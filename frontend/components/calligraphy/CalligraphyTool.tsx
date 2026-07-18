"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { getApiErrorMessage } from "@/lib/api";
import { isAuthenticated, getUser } from "@/lib/auth";
import {
  absUrl,
  calDownloadUrl,
  createCalJob,
  generateFromQueue,
  getCalJob,
  getCalNames,
  getCalQueue,
  getCalWholesalers,
  getOrdersZones,
  getRecentPlates,
  isRealName,
  MIN_BATCH,
  platesZipBlob,
  processCalJob,
  rerollPlate,
  sendCalOrder,
  VARIANT_LABEL,
  type CalJob,
  type CalOrderZones,
  type CalQueue,
  type CalQueueZone,
  type CalGrabRow,
  type CalPlate,
  type CalVariant,
  type CalWholesaler,
  type CreateJobBody,
} from "@/lib/calligraphy";
import { PlateCompositor } from "@/components/calligraphy/PlateCompositor";

// ─── Types ──────────────────────────────────────────────────────────────────

type InputMode = "queue" | "typed" | "wholesaler" | "txt";
type ModelMode = "standard" | "premium";
type GridFilter = "all" | "awaiting" | "sent" | "no_order";

// ─── Status pill colours ─────────────────────────────────────────────────────

function StatusPill({ status }: { status: CalPlate["status"] | string }) {
  const map: Record<string, string> = {
    done: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-700",
    pending: "bg-amber-100 text-amber-800",
  };
  const label: Record<string, string> = {
    done: "تم",
    failed: "فشل",
    pending: "قيد الانتظار",
  };
  const cls = map[status] ?? "bg-gray-100 text-gray-700";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}
    >
      {label[status] ?? status}
    </span>
  );
}

// ─── Plate card ──────────────────────────────────────────────────────────────

function PlateCard({
  plate,
  onReroll,
  onPreview,
  onEdit,
  rerolling,
}: {
  plate: CalPlate;
  onReroll: (id: string) => Promise<void>;
  onPreview: (plate: CalPlate) => void;
  onEdit: (plate: CalPlate) => void;
  rerolling: boolean;
}) {
  const imgUrl = absUrl(plate.plate_path);

  return (
    <article className="flex min-w-0 flex-col gap-2 overflow-hidden rounded-2xl border border-line bg-white p-3 shadow-sm">
      {/* image — click to preview full size */}
      {plate.status === "done" && imgUrl ? (
        <button
          type="button"
          onClick={() => onPreview(plate)}
          className="group relative overflow-hidden rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-orange-ink/40"
          aria-label={`معاينة ${plate.render_text}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgUrl}
            alt={plate.render_text}
            className="w-full object-contain transition-transform duration-200 group-hover:scale-[1.03]"
            loading="lazy"
          />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink/0 text-xs font-semibold text-white opacity-0 transition-all duration-200 group-hover:bg-ink/30 group-hover:opacity-100">
            معاينة
          </span>
        </button>
      ) : plate.status === "failed" ? (
        <div className="flex min-h-[80px] items-center justify-center rounded-xl bg-red-50 p-3">
          <p className="text-center text-xs text-red-600">
            {plate.error ?? "فشل التوليد"}
          </p>
        </div>
      ) : (
        <div className="flex min-h-[80px] items-center justify-center rounded-xl bg-amber-50">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
        </div>
      )}

      {/* name + status */}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 break-words font-display text-sm font-semibold leading-snug text-ink">
          {plate.render_text}
        </p>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          <span className="rounded-full bg-beige px-2 py-0.5 text-[11px] text-ink-soft border border-line">
            {VARIANT_LABEL[plate.variant] ?? plate.variant}
          </span>
          {plate.element_text && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 border border-amber-200">
              + {plate.element_text}
            </span>
          )}
          <StatusPill status={plate.status} />
        </div>
      </div>

      {/* actions */}
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          disabled={rerolling}
          loading={rerolling}
          onClick={() => onReroll(plate.id)}
        >
          إعادة التوليد
        </Button>

        {plate.status === "done" && imgUrl && (
          <>
            <a
              href={imgUrl}
              download
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-line bg-beige px-3.5 py-1.5 text-xs font-semibold text-ink transition-all duration-200 hover:border-orange/40 hover:text-orange-ink"
            >
              تنزيل
            </a>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onEdit(plate)}
            >
              تحرير / صورة
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

// ─── Order group (plates grouped by student/order) ───────────────────────────
// «ربط بالطلب» is gone: plates auto-attach on generation. The group header carries
// the student (clickable → the order), zone ✓/✗ chips and the one send button.

interface PlateGroup {
  key: string;
  orderId: string | null;
  studentName: string | null;
  productName: string | null;
  wholesalerId: string | null;
  wholesalerName: string | null;
  plates: CalPlate[];
}

const ORDER_STATUS_AR: Record<string, string> = {
  design_complete: "بانتظار التصميم",
  converting: "قيد التحويل",
  embroidery: "قيد التطريز",
  pressing: "قيد الكوي",
  preparing: "قيد التجهيز",
  ready: "جاهز للاستلام",
  delivered: "تم التسليم",
  cancelled: "ملغي",
};

// ─── Name-count hint (valid / junk / under-minimum) ──────────────────────────

function NameCountHint({ lines }: { lines: string[] }) {
  const valid = lines.filter(isRealName).length;
  const junk = lines.length - valid;
  return (
    <p className="mt-1 text-xs text-ink-soft">
      <span className="font-semibold text-ink">{valid}</span> اسم صالح
      {junk > 0 && (
        <span className="text-red-600"> · {junk} غير صالح (سيُستبعد)</span>
      )}
      {valid > 0 && valid < MIN_BATCH && (
        <span className="text-amber-600"> · أقل من {MIN_BATCH} — التكلفة لكل ورقة ثابتة</span>
      )}
    </p>
  );
}

// ─── Queue zone card ─────────────────────────────────────────────────────────

function QueueZoneCard({
  variant,
  zone,
  running,
  onGenerate,
}: {
  variant: CalVariant;
  zone: CalQueueZone;
  running: boolean;
  onGenerate: (variant: CalVariant, mode: "full" | "all") => void;
}) {
  const [confirmAll, setConfirmAll] = useState(false);
  const full = Math.floor(zone.pending / 10);
  const leftover = zone.pending % 10;

  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display font-bold text-ink text-base">
            {VARIANT_LABEL[variant]}
          </h3>
          <p className="text-sm text-ink-soft mt-0.5">
            <span className="font-semibold text-ink">{zone.pending}</span> بانتظار
          </p>
        </div>
        <span className="rounded-full bg-beige border border-line px-2.5 py-1 text-xs font-semibold text-ink-soft shrink-0">
          {variant}
        </span>
      </div>

      {/* sheet breakdown */}
      <div className="rounded-xl bg-beige border border-line px-3 py-2.5 text-xs text-ink-soft space-y-0.5">
        <p>
          <span className="font-semibold text-ink">{full}</span> ورقة كاملة جاهزة (×10)
        </p>
        {leftover > 0 && (
          <p className="text-amber-700">
            + <span className="font-semibold">{leftover}</span> بانتظار اكتمال الورقة
          </p>
        )}
        <p className="text-ink/50 pt-0.5">التكلفة الأقل: ١٠ أسماء بالورقة</p>
      </div>

      {/* action buttons */}
      <div className="flex flex-col gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={full < 1 || running}
          loading={running && full >= 1}
          onClick={() => onGenerate(variant, "full")}
          fullWidth
        >
          ولّد الأوراق الكاملة ({full}×10)
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={zone.pending < 1 || running}
          onClick={() => {
            if (leftover > 0) {
              setConfirmAll(true);
            } else {
              onGenerate(variant, "all");
            }
          }}
          fullWidth
        >
          ولّد الكل ({zone.pending})
        </Button>
      </div>

      {/* confirm "all" when leftover > 0 */}
      <Modal
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title="تأكيد توليد الكل"
        footer={
          <>
            <Button variant="ghost" fullWidth onClick={() => setConfirmAll(false)}>
              إلغاء
            </Button>
            <Button
              variant="primary"
              fullWidth
              onClick={() => {
                setConfirmAll(false);
                onGenerate(variant, "all");
              }}
            >
              متابعة
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          المتبقّي <span className="font-bold">{leftover}</span> سيُولَّد كورقة كاملة بتكلفة أعلى (~$0.10).
          هل تريد المتابعة؟
        </div>
      </Modal>
    </div>
  );
}

// ─── Session persistence — «getting back perfectly» (mirrors StationConsole) ────
// The worker sets the plates filter chip / ممثل selects / name search / sticky-bar
// collapse, then taps a student's name (→ /staff/orders/[id]?from=<path>); on back
// this component remounts and must land exactly where they left off. Only display/
// filter state is mirrored — fetched data (jobs/plates/queue), in-flight generation,
// modals, and textarea drafts (typed/txt/wholesaler-grab inputs + the download-folder
// handle) are deliberately excluded. Safe to lazy-init: all three mounts (admin
// layout, /staff/calligraphy, /design-support/calligraphy) gate behind a client-side
// auth loading check, so this component never renders during SSR/prerender.
interface StoredCalligraphyState {
  gridFilter?: GridFilter;
  gridWid?: string;
  queueWid?: string;
  searchText?: string;
  controlsOpen?: boolean;
}
const STORAGE_KEY = "loloshop-calligraphy";

function readStoredCalligraphy(): StoredCalligraphyState {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}") as StoredCalligraphyState;
  } catch {
    return {};
  }
}

function validGridFilter(v: GridFilter | undefined): GridFilter {
  return v === "awaiting" || v === "sent" || v === "no_order" ? v : "all";
}

// ─── Main tool ─────────────────────────────────────────────────────────────────
// Shared by the admin page (`/admin/calligraphy`) and the designer/staff page
// (`/staff/calligraphy`). Both are thin wrappers around this component. It talks to
// /calligraphy/* via the JWT axios instance in lib/calligraphy.ts, so it works for
// any allowed role (admin + manager/designer staff — see routes/calligraphy.js).

export function CalligraphyTool({ backHref }: { backHref?: string } = {}) {
  // ── portal mount guard (createPortal needs document.body, client-only) ────────
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Current path — appended as ?from= so the order page's back button returns HERE.
  const pathname = usePathname();

  // Role gating (send + order links). The tool is shared by admin, staff
  // designer/manager AND design_helper — helpers generate plates but never push
  // orders (their desk flow goes through محمد هيثم) and can't open /staff routes.
  const me = getUser();
  const myStaffTypes: string[] =
    (me as unknown as { staff_types?: string[] })?.staff_types ??
    ((me as unknown as { staff_type?: string })?.staff_type
      ? [(me as unknown as { staff_type?: string }).staff_type as string]
      : []);
  const canSendOrders =
    me?.role === "admin" ||
    (me?.role === "staff" && myStaffTypes.some((t) => t === "designer" || t === "manager"));
  const canOpenOrders = me?.role === "admin" || me?.role === "staff";

  // Restore the last UI state for this session (see StoredCalligraphyState above).
  const [stored] = useState<StoredCalligraphyState>(() => readStoredCalligraphy());

  // ── mode + model ────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<InputMode>("queue");
  const model: ModelMode = "standard";

  // ── variant (typed + txt modes) ─────────────────────────────────────────────
  const [typedVariant, setTypedVariant] = useState<CalVariant>("front");

  // ── typed / txt inputs ──────────────────────────────────────────────────────
  const [typedText, setTypedText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [txtLines, setTxtLines] = useState<string[]>([]);

  // ── wholesaler grab ─────────────────────────────────────────────────────────
  const [wholesalers, setWholesalers] = useState<CalWholesaler[]>([]);
  const [wLoading, setWLoading] = useState(false);
  const [wholesalersLoaded, setWholesalersLoaded] = useState(false);
  const [selectedWid, setSelectedWid] = useState("");
  const [grabRows, setGrabRows] = useState<CalGrabRow[]>([]);
  const [grabLoading, setGrabLoading] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  // زون filter for the wholesaler grab list — امامي / خلف / قبعة (cap+cap_side grouped)
  const [zoneFilter, setZoneFilter] = useState<Set<"front" | "back" | "cap">>(
    new Set(["front", "back", "cap"]),
  );
  // element_text per order_item_id — only used for cap rows in wholesaler mode
  const [capElements, setCapElements] = useState<Record<string, string>>({});

  // ── queue ────────────────────────────────────────────────────────────────────
  const [queue, setQueue] = useState<CalQueue | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState(false);
  // ممثل filter for the automatic queue (counts + generation scope). "" = الكل.
  const [queueWid, setQueueWid] = useState(stored.queueWid ?? "");

  // ── job state ───────────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [plates, setPlates] = useState<CalPlate[]>([]);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);

  // ── per-plate action states ─────────────────────────────────────────────────
  const [rerollingId, setRerollingId] = useState<string | null>(null);

  // ── order zones + send («تحويل للتطريز») ─────────────────────────────────────
  const [orderZones, setOrderZones] = useState<Record<string, CalOrderZones>>({});
  const [sendingOrderId, setSendingOrderId] = useState<string | null>(null);
  // Confirm dialog when sending an order whose zones still miss images.
  const [sendConfirm, setSendConfirm] = useState<{ orderId: string; missing: string[] } | null>(null);

  // ── grid filters (sticky bar) ────────────────────────────────────────────────
  const [gridFilter, setGridFilter] = useState<GridFilter>(validGridFilter(stored.gridFilter));
  const [gridWid, setGridWid] = useState(stored.gridWid ?? "");
  const [searchText, setSearchText] = useState(stored.searchText ?? "");
  // Generation controls collapse behind the sticky bar once results exist.
  const [controlsOpen, setControlsOpen] = useState(stored.controlsOpen ?? true);
  const [folderSaving, setFolderSaving] = useState(false);

  // ── confirm gate (junk names / small batch / under-filled zone) ───────────────
  const [confirm, setConfirm] = useState<{
    body: CreateJobBody;
    junk: string[];
    validCount: number;
    underfilled?: { variant: CalVariant; count: number }[];
  } | null>(null);

  // ── full-size plate preview (click a result) ─────────────────────────────────
  const [preview, setPreview] = useState<CalPlate | null>(null);

  // ── plate compositor (overlay editor) ────────────────────────────────────────
  const [compositorPlate, setCompositorPlate] = useState<CalPlate | null>(null);
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPreview(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [preview]);

  // ── in-flight elapsed timer (so the spinner is never a blank "is it stuck?") ──
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return;
    }
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);

  // ── load wholesalers once ────────────────────────────────────────────────────
  useEffect(() => {
    setWLoading(true);
    getCalWholesalers()
      .then(setWholesalers)
      .catch(() => toast.error("تعذر تحميل الممثلين"))
      .finally(() => {
        setWLoading(false);
        setWholesalersLoaded(true);
      });
  }, []);

  // A restored ممثل filter (plates grid or auto-generation queue) may reference a
  // wholesaler that no longer exists — degrade gracefully to "كل الممثلين" once the
  // real list has loaded. Gated on wholesalersLoaded so a VALID restored id is never
  // wiped against the empty pre-fetch array.
  useEffect(() => {
    if (!wholesalersLoaded) return;
    const validIds = new Set(wholesalers.map((w) => w.id));
    setGridWid((prev) => (prev && !validIds.has(prev) ? "" : prev));
    setQueueWid((prev) => (prev && !validIds.has(prev) ? "" : prev));
  }, [wholesalers, wholesalersLoaded]);

  // Mirror the UI state so back-navigation restores it exactly (sessionStorage key
  // above). Fetched data/progress/modals/drafts are deliberately excluded — see the
  // StoredCalligraphyState comment.
  useEffect(() => {
    try {
      const snapshot: StoredCalligraphyState = {
        gridFilter,
        gridWid,
        queueWid,
        searchText,
        controlsOpen,
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      /* storage full/unavailable — persistence is best-effort */
    }
  }, [gridFilter, gridWid, queueWid, searchText, controlsOpen]);

  // ── fetch names when wholesaler selected ─────────────────────────────────────
  const loadGrab = useCallback(async (wid: string) => {
    if (!wid) return;
    setGrabLoading(true);
    setGrabRows([]);
    setCheckedIds(new Set());
    setZoneFilter(new Set(["front", "back", "cap"]));
    try {
      const rows = await getCalNames(wid);
      setGrabRows(rows);
      // pre-select rows without a done plate
      const pending = new Set(
        rows
          .filter((r) => r.plate_status !== "done")
          .map((r) => r.order_item_id)
      );
      setCheckedIds(pending);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحميل الأسماء"));
    } finally {
      setGrabLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedWid) loadGrab(selectedWid);
  }, [selectedWid, loadGrab]);

  // ── load queue (scoped to the selected ممثل when set) ────────────────────────
  const refreshQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(false);
    try {
      const q = await getCalQueue(queueWid || null);
      setQueue(q);
    } catch (e) {
      setQueueError(true);
      toast.error(getApiErrorMessage(e, "تعذر تحميل الطابور"));
    } finally {
      setQueueLoading(false);
    }
  }, [queueWid]);

  useEffect(() => {
    if (mode === "queue") {
      refreshQueue();
    }
  }, [mode, refreshQueue]);

  // ── order zone/send status for every order that has plates on screen ─────────
  const orderIdsKey = useMemo(() => {
    const ids = [...new Set(plates.map((p) => p.order_id).filter(Boolean))] as string[];
    ids.sort();
    return ids.join(",");
  }, [plates]);

  const refreshZones = useCallback(async () => {
    const ids = orderIdsKey ? orderIdsKey.split(",") : [];
    if (!ids.length) return;
    try {
      const rows = await getOrdersZones(ids);
      setOrderZones((prev) => {
        const next = { ...prev };
        for (const r of rows) next[r.order_id] = r;
        return next;
      });
    } catch {
      // zone chips are best-effort — the send button still validates server-side
    }
  }, [orderIdsKey]);

  useEffect(() => {
    refreshZones();
  }, [refreshZones]);

  // ── persistence: mount effect (restore last job + recent plates) ─────────────
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (!isAuthenticated()) return;

    async function restore() {
      const savedJobId = localStorage.getItem("cal_last_job");
      let jobRestored = false;

      if (savedJobId) {
        try {
          const job = await getCalJob(savedJobId);
          setJobId(job.job_id);
          setPlates(job.plates);
          setDone(job.done);
          setTotal(job.total);
          jobRestored = true;
        } catch {
          // job not found or expired — clear the key
          localStorage.removeItem("cal_last_job");
        }
      }

      if (!jobRestored) {
        try {
          const recent = await getRecentPlates(60);
          if (recent.length > 0) {
            setPlates(recent);
          }
        } catch {
          // silent — recent plates are best-effort
        }
      }
      // Results restored → tuck the generation controls behind the sticky bar, unless
      // the worker already had a controlsOpen preference restored this session (their
      // own toggle wins over this first-load default — see StoredCalligraphyState).
      if (stored.controlsOpen === undefined) setControlsOpen(false);
    }

    restore();
  }, [stored.controlsOpen]);

  // ── read .txt file ───────────────────────────────────────────────────────────
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const lines = String(ev.target?.result ?? "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      setTxtLines(lines);
    };
    reader.readAsText(file, "utf-8");
  }

  // ── core processing loop (shared by runJob and runQueue) ─────────────────────
  // The backend enqueues generation on job creation (pg-boss worker) — the browser
  // only WATCHES progress now. Closing the tab no longer stops generation; reopening
  // + fetching the job (cal_last_job) shows the finished plates. If the worker is
  // down (no progress for ~2 min), we fall back to the old client-driven /process
  // loop so generation never hard-blocks on the worker.
  async function runCreatedJob(job: CalJob) {
    setJobId(job.job_id);
    setPlates(job.plates);
    setTotal(job.total);
    setDone(0);

    let stalledPolls = 0;
    let lastDone = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 4000));
      const snap = await getCalJob(job.job_id);
      setPlates(snap.plates);
      setDone(snap.done);
      const finished = snap.plates.every((p) => p.status !== "pending");
      if (finished) break;
      stalledPolls = snap.done === lastDone ? stalledPolls + 1 : 0;
      lastDone = snap.done;
      if (stalledPolls >= 30) {
        toast.message("المولّد الخلفي متوقف — نكمل التوليد من المتصفح");
        let remaining = snap.total - snap.done;
        while (remaining > 0) {
          const r = await processCalJob(job.job_id);
          setDone(r.done);
          setPlates((prev) =>
            prev.map((p) => r.plates.find((u) => u.id === p.id) ?? p)
          );
          if (r.review) {
            toast.error("تعذّر تقطيع إحدى الأوراق — راجِعها يدويًا");
          }
          if (r.processed === 0 && r.remaining > 0) break; // batch failed; stop
          remaining = r.remaining;
        }
        break;
      }
    }
    // refresh to capture all final states
    const full = await getCalJob(job.job_id);
    setPlates(full.plates);
    setDone(full.done);
    // Generation finished → collapse the controls so results lead the page.
    setControlsOpen(false);
  }

  // ── generate loop ────────────────────────────────────────────────────────────
  async function runJob(body: CreateJobBody) {
    setRunning(true);
    try {
      const job = await createCalJob(body);
      if (job.dropped && job.dropped.length) {
        toast.message(`تم استبعاد ${job.dropped.length} اسم غير صالح`);
      }
      localStorage.setItem("cal_last_job", job.job_id);
      await runCreatedJob(job);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "فشل التوليد"));
    } finally {
      setRunning(false);
    }
  }

  // ── queue generate (scoped to the selected ممثل when set) ────────────────────
  async function runQueue(variant: CalVariant, mode: "full" | "all") {
    setRunning(true);
    try {
      const job = await generateFromQueue(variant, mode, queueWid || null);
      localStorage.setItem("cal_last_job", job.job_id);
      await runCreatedJob(job);
      await refreshQueue();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذّر التوليد من الطابور"));
    } finally {
      setRunning(false);
    }
  }

  // Returns the job body (valid names only) plus the junk names that were excluded,
  // so junk never reaches the paid generator. null = nothing usable (with a toast).
  function buildItems(): { body: CreateJobBody; junk: string[] } | null {
    let allItems: CreateJobBody["items"] = [];
    let base: Omit<CreateJobBody, "items">;

    const isCapLike = (v: CalVariant) => v === "cap" || v === "cap_side";

    if (mode === "typed") {
      const lines = typedText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!lines.length) {
        toast.error("أدخل أسماء في المربع");
        return null;
      }
      base = { source: "typed", model, variant: typedVariant };
      if (isCapLike(typedVariant)) {
        allItems = lines.map((line) => {
          const [namePart, ...rest] = line.split("|");
          const text = namePart.trim();
          const element = rest.join("|").trim();
          return { render_text: text, variant: typedVariant, ...(element ? { element_text: element } : {}) };
        });
      } else {
        allItems = lines.map((t) => ({ render_text: t, variant: typedVariant }));
      }
    } else if (mode === "txt") {
      if (!txtLines.length) {
        toast.error("اختر ملف .txt يحتوي على أسماء");
        return null;
      }
      base = { source: "txt", model, variant: typedVariant };
      if (isCapLike(typedVariant)) {
        allItems = txtLines.map((line) => {
          const [namePart, ...rest] = line.split("|");
          const text = namePart.trim();
          const element = rest.join("|").trim();
          return { render_text: text, variant: typedVariant, ...(element ? { element_text: element } : {}) };
        });
      } else {
        allItems = txtLines.map((t) => ({ render_text: t, variant: typedVariant }));
      }
    } else {
      // wholesaler mode
      if (!selectedWid) {
        toast.error("اختر ممثلاً");
        return null;
      }
      const selected = grabRows.filter((r) => checkedIds.has(r.order_item_id));
      if (!selected.length) {
        toast.error("اختر أسماء من القائمة");
        return null;
      }
      base = { source: "wholesaler", model, wholesaler_id: selectedWid };
      allItems = selected.map((r) => {
        const isCap = isCapLike(r.variant);
        const element = isCap ? (capElements[r.order_item_id] ?? "").trim() : "";
        return {
          render_text: r.render_text,
          student_id: r.student_id,
          order_item_id: r.order_item_id,
          variant: r.variant,
          ...(isCap && element ? { element_text: element } : {}),
        };
      });
    }

    const valid = allItems.filter((it) => isRealName(it.render_text));
    const junk = allItems.filter((it) => !isRealName(it.render_text)).map((it) => it.render_text);
    if (!valid.length) {
      toast.error("لا توجد أسماء صالحة — يجب أن يحتوي الاسم على حروف عربية");
      return null;
    }
    return { body: { ...base, items: valid }, junk };
  }

  function handleGenerate() {
    const built = buildItems();
    if (!built) return;
    const { body, junk } = built;

    // Per-zone under-filled check: group valid items by variant and find any zone < MIN_BATCH
    const byVariant: Record<string, number> = {};
    for (const item of body.items) {
      const v = item.variant ?? "front";
      byVariant[v] = (byVariant[v] ?? 0) + 1;
    }
    const underfilled = (Object.entries(byVariant) as [CalVariant, number][])
      .filter(([, count]) => count < MIN_BATCH)
      .map(([variant, count]) => ({ variant, count }));

    // Show confirm if: junk excluded, total < MIN_BATCH, OR any per-zone underfilling
    if (junk.length > 0 || body.items.length < MIN_BATCH || underfilled.length > 0) {
      setConfirm({ body, junk, validCount: body.items.length, underfilled: underfilled.length > 0 ? underfilled : undefined });
      return;
    }
    runJob(body);
  }

  // ── reroll ───────────────────────────────────────────────────────────────────
  async function handleReroll(id: string) {
    setRerollingId(id);
    try {
      const updated = await rerollPlate(id);
      setPlates((prev) => prev.map((p) => (p.id === id ? updated : p)));
      toast.success("تم إعادة توليد الصورة");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "فشل إعادة التوليد"));
    } finally {
      setRerollingId(null);
    }
  }

  // ── «تحويل للتطريز» — push the order out of بانتظار التصميم ───────────────────
  async function doSendOrder(orderId: string) {
    setSendingOrderId(orderId);
    try {
      const r = await sendCalOrder(orderId);
      toast.success("تم تحويل الطلب للتطريز");
      // Flip the group's status locally + re-pull the authoritative zone state.
      setPlates((prev) =>
        prev.map((p) => (p.order_id === orderId ? { ...p, order_status: r.status } : p))
      );
      setOrderZones((prev) => {
        const cur = prev[orderId];
        return cur
          ? { ...prev, [orderId]: { ...cur, order_status: r.status, can_send: false, send_label: null } }
          : prev;
      });
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحويل الطلب"));
    } finally {
      setSendingOrderId(null);
    }
  }

  function handleSendClick(orderId: string) {
    const z = orderZones[orderId];
    const missing = (z?.zones ?? []).filter((x) => !x.has_image).map((x) => x.label);
    if (missing.length > 0) {
      setSendConfirm({ orderId, missing });
      return;
    }
    doSendOrder(orderId);
  }

  // ── grouping (by order) + sticky-bar filters ─────────────────────────────────
  const groups = useMemo<PlateGroup[]>(() => {
    const map = new Map<string, PlateGroup>();
    for (const p of plates) {
      const key = p.order_id ?? "__none__";
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          orderId: p.order_id ?? null,
          studentName: p.student_name ?? null,
          productName: p.product_name ?? null,
          wholesalerId: p.wholesaler_id ?? null,
          wholesalerName: p.wholesaler_name ?? null,
          plates: [],
        };
        map.set(key, g);
      }
      g.plates.push(p);
    }
    const list = [...map.values()];
    // «بدون طلب» group always last; the rest keep the plates' (newest-first) order.
    list.sort((a, b) => (a.orderId === null ? 1 : 0) - (b.orderId === null ? 1 : 0));
    return list;
  }, [plates]);

  const visibleGroups = useMemo(() => {
    const q = searchText.trim();
    return groups.filter((g) => {
      const z = g.orderId ? orderZones[g.orderId] : null;
      if (gridFilter === "awaiting" && !(z?.can_send)) return false;
      if (gridFilter === "sent" && !(g.orderId && z && !z.can_send && z.order_status !== "design_complete")) return false;
      if (gridFilter === "no_order" && g.orderId !== null) return false;
      if (gridWid && g.wholesalerId !== gridWid) return false;
      if (q) {
        const hay = `${g.studentName ?? ""} ${g.plates.map((p) => p.render_text).join(" ")}`;
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [groups, gridFilter, gridWid, searchText, orderZones]);

  const visiblePlates = useMemo(
    () => visibleGroups.flatMap((g) => g.plates),
    [visibleGroups]
  );

  // ── «تنزيل إلى مجلد…» — write every visible done plate into a user-picked folder
  //    (File System Access API, Chrome/Edge desktop). Fallback: ZIP of the same set.
  async function downloadToFolder() {
    const target = visiblePlates.filter((p) => p.status === "done" && p.plate_path);
    if (!target.length) {
      toast.error("لا توجد صور جاهزة ضمن الفلترة الحالية");
      return;
    }
    setFolderSaving(true);
    try {
      const w = window as unknown as {
        showDirectoryPicker?: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
      };
      if (w.showDirectoryPicker) {
        const dir = await w.showDirectoryPicker({ mode: "readwrite" });
        const used = new Set<string>();
        let ok = 0;
        for (const p of target) {
          const res = await fetch(absUrl(p.plate_path));
          if (!res.ok) continue;
          const blob = await res.blob();
          const base = (p.student_name || p.render_text || "name")
            .replace(/[\/\\:*?"<>|]+/g, "_")
            .slice(0, 40);
          const zone = VARIANT_LABEL[p.variant] ? `-${p.variant}` : "";
          let name = `${base}${zone}.png`;
          let n = 2;
          while (used.has(name)) name = `${base}${zone}-${n++}.png`;
          used.add(name);
          const fh = await dir.getFileHandle(name, { create: true });
          const ws = await fh.createWritable();
          await ws.write(blob);
          await ws.close();
          ok++;
        }
        toast.success(`تم حفظ ${ok} صورة في المجلد`);
      } else {
        // ZIP fallback (phones / Safari / Firefox)
        const blob = await platesZipBlob(target.map((p) => p.id));
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `calligraphy-${target.length}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast.success("تم تنزيل ملف ZIP بالصور");
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        toast.error(getApiErrorMessage(e, "تعذر حفظ الصور"));
      }
    } finally {
      setFolderSaving(false);
    }
  }

  // ── remaining ungenerated in wholesaler list ─────────────────────────────────
  const pendingGrabCount = grabRows.filter(
    (r) => checkedIds.has(r.order_item_id) && r.plate_status !== "done"
  ).length;

  // ── زون filter for the grab list — cap + cap_side both map to «قبعة» ──────────
  const zoneGroupOf = (v: CalVariant): "front" | "back" | "cap" =>
    v === "front" ? "front" : v === "back" ? "back" : "cap";
  const visibleGrabRows = grabRows.filter((r) => zoneFilter.has(zoneGroupOf(r.variant)));
  const toggleZone = (z: "front" | "back" | "cap") => {
    const turningOff = zoneFilter.has(z) && zoneFilter.size > 1;
    setZoneFilter((prev) => {
      const next = new Set(prev);
      if (next.has(z)) next.delete(z);
      else next.add(z);
      // never leave the list fully hidden — re-select the one just removed
      if (next.size === 0) next.add(z);
      return next;
    });
    // keep the selection in sync with the visible zones so «توليد المتبقي» matches
    setCheckedIds((prev) => {
      const next = new Set(prev);
      grabRows.forEach((r) => {
        if (zoneGroupOf(r.variant) !== z) return;
        if (turningOff) next.delete(r.order_item_id);
        else if (r.plate_status !== "done") next.add(r.order_item_id);
      });
      return next;
    });
  };

  // ── progress ─────────────────────────────────────────────────────────────────
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  // Manual inputs stay available, but the automatic queue is the daily primary flow.
  const manualModes = [
    { id: "typed" as InputMode, label: "لصق أسماء" },
    { id: "wholesaler" as InputMode, label: "طلبات ممثل" },
    { id: "txt" as InputMode, label: "ملف TXT" },
  ] as const;
  const queuePendingTotal = queue
    ? (["front", "back", "cap"] as CalVariant[]).reduce(
        (sum, variant) => sum + queue[variant].pending,
        0
      )
    : null;

  return (
    <div dir="rtl" lang="ar">
      {backHref && (
        <div className="mb-4">
          <Link
            href={backHref}
            className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-orange-ink hover:underline"
          >
            <span aria-hidden>→</span> رجوع
          </Link>
        </div>
      )}
      <PageHeader
        title="الخط العربي"
        subtitle="ابدأ بالطابور التلقائي، واستخدم الإدخال اليدوي للحالات الاستثنائية"
      />

      {/* ── Sticky workbench bar — filters + bulk download + controls toggle ── */}
      {plates.length > 0 && (
        <div className="sticky top-0 z-30 -mx-1 mb-4 rounded-2xl border border-line bg-[var(--shop-paper,#FAEBD7)]/95 px-3 py-2.5 shadow-[var(--shadow-soft)] backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={controlsOpen ? "secondary" : "primary"}
              onClick={() => setControlsOpen((v) => !v)}
            >
              {controlsOpen ? "إخفاء التوليد ▴" : "توليد المزيد ▾"}
            </Button>

            {/* status filter chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: "all" as const, label: "الكل" },
                  { id: "awaiting" as const, label: "بانتظار الإرسال" },
                  { id: "sent" as const, label: "مُرسلة" },
                  { id: "no_order" as const, label: "بدون طلب" },
                ]
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setGridFilter(f.id)}
                  className={`min-h-9 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    gridFilter === f.id
                      ? "bg-orange-ink text-white"
                      : "border border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* wholesaler filter */}
            <select
              value={gridWid}
              onChange={(e) => setGridWid(e.target.value)}
              className="min-h-9 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink-soft focus:border-orange-ink focus:outline-none"
              aria-label="فلترة حسب الممثل"
            >
              <option value="">كل الممثلين</option>
              {wholesalers.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>

            {/* name search */}
            <input
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              dir="rtl"
              placeholder="ابحث باسم الطالب…"
              className="min-h-9 w-40 grow rounded-full border border-line bg-surface px-3.5 py-1 text-xs text-ink placeholder:text-ink/40 focus:border-orange-ink focus:outline-none sm:w-48 sm:grow-0"
            />

            <Button
              size="sm"
              variant="secondary"
              loading={folderSaving}
              disabled={folderSaving}
              onClick={downloadToFolder}
            >
              تنزيل إلى مجلد…
            </Button>
          </div>
        </div>
      )}

      {/* ── Controls card ─────────────────────────────────────────────────── */}
      <section className={`surface-card rounded-2xl p-4 lg:p-6 mb-6 ${controlsOpen ? "" : "hidden"}`}>
        {/* The daily path is deliberately dominant; manual methods are secondary. */}
        <div className="mb-5 space-y-3" aria-label="طريقة الإدخال">
          <button
            type="button"
            aria-pressed={mode === "queue"}
            onClick={() => setMode("queue")}
            className={`flex min-h-16 w-full items-center justify-between gap-4 rounded-xl px-4 py-3 text-start transition-colors ${
              mode === "queue"
                ? "bg-orange-ink text-white"
                : "border border-orange-ink/30 bg-surface text-ink hover:border-orange-ink"
            }`}
          >
            <span className="min-w-0">
              <span className="block text-base font-bold">الطابور التلقائي</span>
              <span className={`mt-0.5 block text-xs ${mode === "queue" ? "text-white/85" : "text-ink-soft"}`}>
                الطلبات الجاهزة مرتبة حسب مكان التطريز
              </span>
            </span>
            <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${mode === "queue" ? "bg-white/20 text-white" : "bg-orange-ink/10 text-orange-ink"}`}>
              {queuePendingTotal == null ? "الأساسي" : `${queuePendingTotal} بانتظار`}
            </span>
          </button>

          <div className="border-t border-line pt-3">
            <p className="mb-2 text-xs font-semibold text-ink-soft">إدخال يدوي للحالات الخاصة</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {manualModes.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={mode === tab.id}
              onClick={() => setMode(tab.id)}
              className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                mode === tab.id
                  ? "border-orange-ink bg-orange-ink/10 text-orange-ink"
                  : "border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
            ))}
            </div>
          </div>
        </div>

        {/* ── Queue panel ──────────────────────────────────────────────────── */}
        {mode === "queue" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink-soft">
                الطلبات المعلّقة مرتّبة حسب النوع — يمكنك توليدها دفعةً واحدة
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {/* ممثل filter — scopes the counts AND what «ولّد» generates */}
                <select
                  value={queueWid}
                  onChange={(e) => setQueueWid(e.target.value)}
                  disabled={running}
                  className="min-h-11 rounded-full border border-line bg-beige px-3.5 py-2 text-xs font-semibold text-ink-soft focus:border-orange-ink focus:outline-none disabled:opacity-50"
                  aria-label="فلترة الطابور حسب الممثل"
                >
                  <option value="">كل الممثلين</option>
                  {wholesalers.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={refreshQueue}
                  disabled={queueLoading || running}
                  className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-line bg-beige px-4 py-2 text-xs font-semibold text-ink-soft transition-colors hover:border-orange/40 hover:text-orange-ink disabled:opacity-50"
                >
                  {queueLoading ? (
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <span>↻</span>
                  )}
                  تحديث
                </button>
              </div>
            </div>

            {queueLoading && !queue ? (
              <div className="flex items-center gap-2 text-sm text-ink-soft py-4">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-orange border-t-transparent" />
                جارٍ التحميل…
              </div>
            ) : queueError ? (
              <div className="rounded-xl border border-danger/25 bg-surface px-5 py-8 text-center" role="alert">
                <p className="font-bold text-ink">تعذر تحميل الطابور</p>
                <p className="mt-1 text-sm text-ink-soft">تحقق من الاتصال ثم أعد المحاولة.</p>
                <Button className="mt-4" variant="ghost" onClick={refreshQueue}>إعادة المحاولة</Button>
              </div>
            ) : queue ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {(["front", "back", "cap", "cap_side"] as CalVariant[]).map((v) => (
                  <QueueZoneCard
                    key={v}
                    variant={v}
                    zone={queue[v] as CalQueueZone}
                    running={running}
                    onGenerate={runQueue}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )}

        {/* variant segmented control — typed + txt modes only */}
        {(mode === "typed" || mode === "txt") && (
          <div className="mb-5">
            <p className="mb-2 text-xs font-semibold text-ink-soft">نوع التطريز</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: "front" as CalVariant, label: "الوجه الأمامي (زخرفة كاملة)" },
                  { id: "back" as CalVariant, label: "الوجه الخلفي (زخرفة أقل)" },
                  { id: "cap" as CalVariant, label: "القبعة — أعلى (اسم + عنصر)" },
                  { id: "cap_side" as CalVariant, label: "القبعة — جانب (اسم + عنصر)" },
                ]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={running}
                  onClick={() => setTypedVariant(opt.id)}
                  className={`min-h-11 rounded-full px-5 py-2 text-sm font-semibold transition-all duration-200 ${
                    typedVariant === opt.id
                      ? "bg-orange-ink text-white shadow-sm"
                      : "border border-line bg-beige text-ink hover:border-orange/40 hover:text-orange-ink"
                  } disabled:opacity-60`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* typed textarea */}
        {mode === "typed" && (
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-semibold text-ink-soft">
              أسماء الطلاب (اسم واحد في كل سطر)
            </label>
            <textarea
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              disabled={running}
              rows={8}
              dir="rtl"
              placeholder={
                typedVariant === "cap" || typedVariant === "cap_side"
                  ? "لمار | فراشة\nيوسف | شجرة\nعبدالله"
                  : "محمد علي\nفاطمة حسن\nأحمد كريم"
              }
              className="w-full rounded-xl border border-line bg-beige px-3 py-2.5 text-sm text-ink placeholder:text-ink/30 focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15 disabled:opacity-60"
            />
            {(typedVariant === "cap" || typedVariant === "cap_side") && (
              <p className="mt-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                للقبعة: اكتب الاسم ثم | ثم العنصر، مثال: <span className="font-semibold">لمار | فراشة</span> (العنصر اختياري)
              </p>
            )}
            <NameCountHint
              lines={typedText
                .split(/\r?\n/)
                .map((l) => ((typedVariant === "cap" || typedVariant === "cap_side") ? l.split("|")[0] : l).trim())
                .filter(Boolean)}
            />
          </div>
        )}

        {/* wholesaler grab */}
        {mode === "wholesaler" && (
          <div className="mb-4 space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ink-soft">
                الممثل
              </label>
              <select
                value={selectedWid}
                onChange={(e) => setSelectedWid(e.target.value)}
                disabled={running || wLoading}
                className="min-h-11 w-full rounded-xl border border-line bg-beige px-3 py-2 text-sm text-ink focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15 disabled:opacity-60"
              >
                <option value="">— اختر ممثلاً —</option>
                {wholesalers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.student_count} طالب)
                  </option>
                ))}
              </select>
            </div>

            {grabLoading && (
              <div className="flex items-center gap-2 text-sm text-ink-soft">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-orange border-t-transparent" />
                جارٍ التحميل…
              </div>
            )}

            {!grabLoading && grabRows.length > 0 && (
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  {([
                    { z: "front" as const, label: "امامي" },
                    { z: "back" as const, label: "خلف" },
                    { z: "cap" as const, label: "قبعة" },
                  ]).map(({ z, label }) => {
                    const on = zoneFilter.has(z);
                    return (
                      <button
                        key={z}
                        type="button"
                        onClick={() => toggleZone(z)}
                        className={`inline-flex min-h-11 items-center rounded-full border px-3 text-xs font-semibold transition ${
                          on
                            ? "border-orange-ink bg-orange-ink text-white"
                            : "border-line bg-beige text-ink-soft hover:border-orange-ink/40"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-ink-soft">
                    أسماء التطريز (اختر المطلوب توليده)
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center px-2 text-xs font-semibold text-orange-ink underline-offset-2 hover:underline"
                      onClick={() =>
                        setCheckedIds((prev) => {
                          const next = new Set(prev);
                          visibleGrabRows.forEach((r) => next.add(r.order_item_id));
                          return next;
                        })
                      }
                    >
                      تحديد الكل
                    </button>
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center px-2 text-xs font-semibold text-ink-soft underline-offset-2 hover:underline"
                      onClick={() =>
                        setCheckedIds((prev) => {
                          const next = new Set(prev);
                          visibleGrabRows.forEach((r) => next.delete(r.order_item_id));
                          return next;
                        })
                      }
                    >
                      إلغاء الكل
                    </button>
                  </div>
                </div>
                <ul className="max-h-72 divide-y divide-line overflow-x-hidden overflow-y-auto rounded-xl border border-line bg-beige">
                  {visibleGrabRows.map((r) => (
                    <li key={r.order_item_id} className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2.5 sm:gap-3">
                      <input
                        type="checkbox"
                        id={`grab-${r.order_item_id}`}
                        checked={checkedIds.has(r.order_item_id)}
                        onChange={(e) => {
                          const next = new Set(checkedIds);
                          if (e.target.checked) next.add(r.order_item_id);
                          else next.delete(r.order_item_id);
                          setCheckedIds(next);
                        }}
                        className="h-5 w-5 shrink-0 accent-orange-ink"
                      />
                      <label
                        htmlFor={`grab-${r.order_item_id}`}
                        className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 sm:flex-nowrap"
                      >
                        <span className="min-w-0 break-words text-sm text-ink">{r.render_text}</span>
                        <span className="min-w-0 break-words text-xs text-ink-soft">{r.student_name}</span>
                        <span className="rounded-full bg-beige px-2 py-0.5 text-[11px] text-ink-soft border border-line shrink-0">
                          {VARIANT_LABEL[r.variant] ?? r.variant}
                        </span>
                        <StatusPill status={r.plate_status ?? "pending"} />
                      </label>
                      {(r.variant === "cap" || r.variant === "cap_side") && (
                        <input
                          type="text"
                          dir="rtl"
                          placeholder="عنصر (اختياري)"
                          value={capElements[r.order_item_id] ?? ""}
                          onChange={(e) =>
                            setCapElements((prev) => ({
                              ...prev,
                              [r.order_item_id]: e.target.value,
                            }))
                          }
                          className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-xs text-ink placeholder:text-ink/50 focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15 sm:w-32"
                        />
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs text-ink-soft">
                  {checkedIds.size} محدد · {pendingGrabCount} لم يُولَّد بعد
                </p>
              </div>
            )}

            {!grabLoading && selectedWid && grabRows.length === 0 && (
              <p className="text-sm text-ink-soft">
                لا توجد أسماء تطريز مسجّلة لهذا الممثل
              </p>
            )}
          </div>
        )}

        {/* txt file */}
        {mode === "txt" && (
          <div className="mb-4 space-y-2">
            <label className="mb-1.5 block text-xs font-semibold text-ink-soft">
              ملف .txt (اسم واحد في كل سطر، ترميز UTF-8)
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,text/plain"
              disabled={running}
              onChange={handleFileChange}
              className="block min-h-11 w-full text-sm text-ink file:me-3 file:min-h-11 file:cursor-pointer file:rounded-full file:border-0 file:bg-orange-ink file:px-4 file:text-xs file:font-semibold file:text-white hover:file:opacity-90 disabled:opacity-60"
            />
            {txtLines.length > 0 && (
              <>
                <p className="text-xs text-ink-soft">
                  تم قراءة {txtLines.length} سطر من الملف
                </p>
                <NameCountHint lines={txtLines} />
              </>
            )}
          </div>
        )}

        {/* generate button — manual modes only */}
        {mode !== "queue" && (
          <Button
            onClick={handleGenerate}
            loading={running}
            disabled={running}
            size="lg"
          >
            {mode === "wholesaler" && pendingGrabCount > 0
              ? `توليد المتبقي (${pendingGrabCount})`
              : "توليد"}
          </Button>
        )}
      </section>

      {/* ── Progress ──────────────────────────────────────────────────────── */}
      {(running || (jobId && total > 0)) && (
        <section className="surface-card rounded-2xl p-4 mb-6">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-ink">
              التقدم: {done} / {total}
            </p>
            {running && (
              <p className="text-xs text-ink-soft">
                جارٍ توليد ورقة… قد تستغرق حتى دقيقة لكل ورقة ({elapsed} ثانية)
              </p>
            )}
          </div>
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className={`h-2.5 overflow-hidden rounded-full bg-orange/15 ${
              running ? "animate-pulse" : ""
            }`}
          >
            <div
              className="h-full rounded-full bg-orange-ink transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </section>
      )}

      {/* ── Download all ──────────────────────────────────────────────────── */}
      {jobId && done > 0 && (
        <section className="mb-6 flex flex-wrap gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              window.location.href = calDownloadUrl(jobId);
            }}
          >
            تنزيل الكل (ZIP)
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              window.location.href = calDownloadUrl(jobId, true);
            }}
          >
            تنزيل الكل مع الأوراق
          </Button>
        </section>
      )}

      {/* ── Workbench — plates grouped by student/order ───────────────────── */}
      {plates.length > 0 && (
        <section>
          <h2 className="mb-4 font-display text-lg font-bold text-ink">
            اللوحات ({visiblePlates.length}
            {visiblePlates.length !== plates.length ? ` من ${plates.length}` : ""})
          </h2>

          {visibleGroups.length === 0 && (
            <div className="rounded-2xl border border-dashed border-line bg-surface-sink p-8 text-center text-sm text-ink-soft">
              لا توجد نتائج ضمن الفلترة الحالية.
            </div>
          )}

          <div className="space-y-4">
            {visibleGroups.map((g) => {
              const z = g.orderId ? orderZones[g.orderId] : null;
              const statusKey = z?.order_status ?? g.plates[0]?.order_status ?? null;
              const sent = !!(g.orderId && statusKey && statusKey !== "design_complete");
              return (
                <article
                  key={g.key}
                  className="rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow-soft)] sm:p-4"
                >
                  {/* group header: student → order · product · status · zones · send */}
                  <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                    {g.orderId ? (
                      <>
                        {canOpenOrders ? (
                          <Link
                            href={`/staff/orders/${g.orderId}?from=${encodeURIComponent(pathname)}`}
                            className="min-w-0 truncate font-display text-base font-bold text-orange-ink underline-offset-4 hover:underline"
                          >
                            {g.studentName ?? "طالب"}
                          </Link>
                        ) : (
                          <span className="min-w-0 truncate font-display text-base font-bold text-ink">
                            {g.studentName ?? "طالب"}
                          </span>
                        )}
                        {g.productName && (
                          <span className="text-xs font-semibold text-ink-soft">{g.productName}</span>
                        )}
                        {statusKey && (
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                              sent
                                ? "bg-green-100 text-green-800"
                                : "bg-peach/70 text-orange-ink"
                            }`}
                          >
                            {ORDER_STATUS_AR[statusKey] ?? statusKey}
                          </span>
                        )}
                        {g.wholesalerName && (
                          <span className="rounded-full border border-line bg-beige px-2 py-0.5 text-[11px] text-ink-soft">
                            ممثل: {g.wholesalerName}
                          </span>
                        )}

                        {/* zone ✓/✗ chips */}
                        {z && z.zones.length > 0 && (
                          <span className="flex flex-wrap items-center gap-1">
                            {z.zones.map((zone) => (
                              <span
                                key={zone.key}
                                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                  zone.has_image
                                    ? "bg-green-50 text-green-700 border border-green-200"
                                    : "bg-amber-50 text-amber-700 border border-amber-200"
                                }`}
                                title={zone.has_image ? "الصورة جاهزة" : "بلا صورة بعد"}
                              >
                                {zone.label} {zone.has_image ? "✓" : "✗"}
                              </span>
                            ))}
                          </span>
                        )}

                        {/* the one action: تحويل للتطريز */}
                        {canSendOrders && z?.can_send && (
                          <Button
                            size="sm"
                            variant="primary"
                            className="ms-auto"
                            loading={sendingOrderId === g.orderId}
                            disabled={sendingOrderId !== null}
                            onClick={() => handleSendClick(g.orderId as string)}
                          >
                            {z.send_label ?? "تحويل للتطريز"}
                          </Button>
                        )}
                        {sent && (
                          <span className="ms-auto rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-700">
                            ✓ أُرسل
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="font-display text-base font-bold text-ink">
                        لوحات بدون طلب
                      </span>
                    )}
                  </div>

                  <div className="grid min-w-0 grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {g.plates.map((plate) => (
                      <PlateCard
                        key={plate.id}
                        plate={plate}
                        onReroll={handleReroll}
                        onPreview={setPreview}
                        onEdit={setCompositorPlate}
                        rerolling={rerollingId === plate.id}
                      />
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Send confirm — zones still missing artwork ─────────────────────── */}
      <Modal
        open={!!sendConfirm}
        onClose={() => setSendConfirm(null)}
        title="مواضع بلا صورة"
        footer={
          <>
            <Button variant="ghost" fullWidth onClick={() => setSendConfirm(null)}>
              إلغاء
            </Button>
            <Button
              variant="primary"
              fullWidth
              onClick={() => {
                if (sendConfirm) doSendOrder(sendConfirm.orderId);
                setSendConfirm(null);
              }}
            >
              تحويل على أي حال
            </Button>
          </>
        }
      >
        {sendConfirm && (
          <div className="space-y-2 text-sm text-ink">
            <p>هذا الطلب يحتوي مواضع تطريز بلا صورة حتى الآن:</p>
            <ul className="list-inside list-disc text-amber-700">
              {sendConfirm.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <p className="text-xs text-ink-soft">
              يمكنك توليد لوحاتها أولاً، أو تحويل الطلب كما هو وسيتولى المطرز الناقص.
            </p>
          </div>
        )}
      </Modal>

      {/* ── Full-size plate preview ───────────────────────────────────────────── */}
      {/* Portaled to <body> so the overlay escapes the admin layout's `.shop-paper`
          (`overflow-x: clip`) / staff layout stacking contexts — otherwise the
          fixed overlay is clipped/trapped and the ✕ / backdrop click can't be
          reached. Mirrors components/ui/Modal.tsx. `mounted` guards SSR (createPortal
          needs document.body). Backdrop click, ✕ (setPreview(null)) and the Escape
          handler above all still fire — React events bubble through the portal. */}
      {mounted && preview && absUrl(preview.plate_path) &&
        createPortal(
          <div
            className="animate-fade-page-in fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-ink/70 p-4 backdrop-blur-sm"
            onClick={() => setPreview(null)}
            role="dialog"
            aria-modal="true"
            aria-label={`معاينة ${preview.render_text}`}
          >
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="absolute end-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-xl text-ink shadow-lg transition hover:bg-white"
              aria-label="إغلاق"
            >
              ✕
            </button>
            <div
              className="flex max-h-[80dvh] w-full max-w-3xl flex-col items-center gap-3 overflow-auto rounded-2xl bg-white p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={absUrl(preview.plate_path)}
                alt={preview.render_text}
                className="max-h-[64dvh] w-auto max-w-full object-contain"
              />
              <p className="font-display text-lg font-bold text-ink">{preview.render_text}</p>
              <a
                href={absUrl(preview.plate_path)}
                download
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-orange-ink px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90"
              >
                تنزيل الصورة
              </a>
            </div>
          </div>,
          document.body
        )}

      {/* ── Confirm gate (junk excluded / small batch / underfilled zone) ─────── */}
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="تأكيد التوليد"
        footer={
          <>
            <Button variant="ghost" fullWidth onClick={() => setConfirm(null)}>
              إلغاء
            </Button>
            <Button
              variant="primary"
              fullWidth
              onClick={() => {
                if (confirm) runJob(confirm.body);
                setConfirm(null);
              }}
            >
              متابعة ({confirm?.validCount} اسم)
            </Button>
          </>
        }
      >
        {confirm && (
          <div className="space-y-3 text-sm text-ink">
            {confirm.junk.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                <p className="font-semibold text-red-700">
                  {confirm.junk.length} اسم غير صالح سيُستبعد (لن يُولَّد):
                </p>
                <p className="mt-1 break-words text-xs text-red-600">
                  {confirm.junk.slice(0, 12).join(" · ")}
                  {confirm.junk.length > 12 ? " …" : ""}
                </p>
              </div>
            )}
            {confirm.validCount < MIN_BATCH && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
                لديك <span className="font-bold">{confirm.validCount}</span> اسم فقط
                (أقل من {MIN_BATCH}). كل ورقة تكلّف نفس السعر سواء حملت اسمًا واحدًا أو
                {" "}{MIN_BATCH} — هل تريد المتابعة؟
              </div>
            )}
            {confirm.underfilled && confirm.underfilled.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
                <p className="font-semibold mb-1">بعض الأنواع بها أقل من {MIN_BATCH} أسماء:</p>
                <ul className="text-xs space-y-0.5">
                  {confirm.underfilled.map(({ variant, count }) => (
                    <li key={variant}>
                      {VARIANT_LABEL[variant]}: <span className="font-bold">{count}</span> فقط
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs">
                  كل نوع يُطبع بورقة منفصلة — الأقل من ١٠ يكلّف ورقة كاملة (~$0.10).
                </p>
              </div>
            )}
            <p className="text-xs text-ink-soft">
              سيتم توليد <span className="font-semibold text-ink">{confirm.validCount}</span> اسم صالح.
            </p>
          </div>
        )}
      </Modal>

      {/* ── Plate compositor (overlay editor) ───────────────────────────────── */}
      {compositorPlate && (
        <PlateCompositor
          plate={compositorPlate}
          onSaved={(p) => {
            setPlates((prev) => prev.map((x) => (x.id === p.id ? p : x)));
            setCompositorPlate(null);
          }}
          onClose={() => setCompositorPlate(null)}
        />
      )}
    </div>
  );
}
