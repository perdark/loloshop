"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { getApiErrorMessage } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import {
  absUrl,
  calDownloadUrl,
  createCalJob,
  generateFromQueue,
  getCalJob,
  getCalNames,
  getCalQueue,
  getCalWholesalers,
  getRecentPlates,
  isRealName,
  linkPlate,
  MIN_BATCH,
  processCalJob,
  rerollPlate,
  VARIANT_LABEL,
  type CalJob,
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
  onLink,
  onPreview,
  onEdit,
  rerolling,
  linking,
}: {
  plate: CalPlate;
  onReroll: (id: string) => Promise<void>;
  onLink: (id: string) => Promise<void>;
  onPreview: (plate: CalPlate) => void;
  onEdit: (plate: CalPlate) => void;
  rerolling: boolean;
  linking: boolean;
}) {
  const imgUrl = absUrl(plate.plate_path);

  return (
    <article className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-3 shadow-sm">
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
      <div className="flex items-center justify-between gap-2">
        <p className="font-display text-sm font-semibold text-ink leading-snug">
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

        {plate.order_item_id && (
          plate.linked ? (
            <span className="inline-flex min-h-11 items-center rounded-full bg-green-50 px-3.5 py-1.5 text-xs font-semibold text-green-700">
              مرتبط ✓
            </span>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={linking || plate.status !== "done"}
              loading={linking}
              onClick={() => onLink(plate.id)}
            >
              ربط بالطلب
            </Button>
          )
        )}
      </div>
    </article>
  );
}

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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CalligraphyPage() {
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
  const [selectedWid, setSelectedWid] = useState("");
  const [grabRows, setGrabRows] = useState<CalGrabRow[]>([]);
  const [grabLoading, setGrabLoading] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  // element_text per order_item_id — only used for cap rows in wholesaler mode
  const [capElements, setCapElements] = useState<Record<string, string>>({});

  // ── queue ────────────────────────────────────────────────────────────────────
  const [queue, setQueue] = useState<CalQueue | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);

  // ── job state ───────────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [plates, setPlates] = useState<CalPlate[]>([]);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);

  // ── per-plate action states ─────────────────────────────────────────────────
  const [rerollingId, setRerollingId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);

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
      .finally(() => setWLoading(false));
  }, []);

  // ── fetch names when wholesaler selected ─────────────────────────────────────
  const loadGrab = useCallback(async (wid: string) => {
    if (!wid) return;
    setGrabLoading(true);
    setGrabRows([]);
    setCheckedIds(new Set());
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

  // ── load queue ───────────────────────────────────────────────────────────────
  const refreshQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      const q = await getCalQueue();
      setQueue(q);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحميل الطابور"));
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "queue") {
      refreshQueue();
    }
  }, [mode, refreshQueue]);

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
    }

    restore();
  }, []);

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
  async function runCreatedJob(job: CalJob) {
    setJobId(job.job_id);
    setPlates(job.plates);
    setTotal(job.total);
    setDone(0);

    let remaining = job.total;
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
    // refresh to capture all final states
    const full = await getCalJob(job.job_id);
    setPlates(full.plates);
    setDone(full.done);
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

  // ── queue generate ───────────────────────────────────────────────────────────
  async function runQueue(variant: CalVariant, mode: "full" | "all") {
    setRunning(true);
    try {
      const job = await generateFromQueue(variant, mode);
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

    if (mode === "typed") {
      const lines = typedText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!lines.length) {
        toast.error("أدخل أسماء في المربع");
        return null;
      }
      base = { source: "typed", model, variant: typedVariant };
      if (typedVariant === "cap") {
        allItems = lines.map((line) => {
          const [namePart, ...rest] = line.split("|");
          const text = namePart.trim();
          const element = rest.join("|").trim();
          return { render_text: text, variant: "cap" as CalVariant, ...(element ? { element_text: element } : {}) };
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
      if (typedVariant === "cap") {
        allItems = txtLines.map((line) => {
          const [namePart, ...rest] = line.split("|");
          const text = namePart.trim();
          const element = rest.join("|").trim();
          return { render_text: text, variant: "cap" as CalVariant, ...(element ? { element_text: element } : {}) };
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
        const isCap = r.variant === "cap";
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

  // ── link ─────────────────────────────────────────────────────────────────────
  async function handleLink(id: string) {
    setLinkingId(id);
    try {
      await linkPlate(id);
      setPlates((prev) =>
        prev.map((p) => (p.id === id ? { ...p, linked: true } : p))
      );
      toast.success("تم ربط الصورة بالطلب");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "فشل الربط بالطلب"));
    } finally {
      setLinkingId(null);
    }
  }

  // ── remaining ungenerated in wholesaler list ─────────────────────────────────
  const pendingGrabCount = grabRows.filter(
    (r) => checkedIds.has(r.order_item_id) && r.plate_status !== "done"
  ).length;

  // ── progress ─────────────────────────────────────────────────────────────────
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  // ── tabs config ──────────────────────────────────────────────────────────────
  const tabs = [
    { id: "queue" as InputMode, label: "الطابور (تلقائي)" },
    { id: "typed" as InputMode, label: "كتابة / لصق" },
    { id: "wholesaler" as InputMode, label: "حسب الممثل" },
    { id: "txt" as InputMode, label: "رفع ملف .txt" },
  ] as const;

  return (
    <div dir="rtl" lang="ar">
      <PageHeader
        title="الخط العربي"
        subtitle="توليد لوحات الأسماء بالخط العربي وربطها بالطلبات"
      />

      {/* ── Controls card ─────────────────────────────────────────────────── */}
      <section className="surface-card rounded-2xl p-4 lg:p-6 mb-6">
        {/* mode tabs */}
        <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="طريقة الإدخال">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={mode === tab.id}
              onClick={() => setMode(tab.id)}
              className={`min-h-11 rounded-full px-5 py-2 text-sm font-semibold transition-all duration-200 ${
                mode === tab.id
                  ? "bg-orange-ink text-white shadow-sm"
                  : "border border-line bg-beige text-ink hover:border-orange/40 hover:text-orange-ink"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Queue panel ──────────────────────────────────────────────────── */}
        {mode === "queue" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink-soft">
                الطلبات المعلّقة مرتّبة حسب النوع — يمكنك توليدها دفعةً واحدة
              </p>
              <button
                type="button"
                onClick={refreshQueue}
                disabled={queueLoading || running}
                className="flex items-center gap-1.5 rounded-full border border-line bg-beige px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:border-orange/40 hover:text-orange-ink disabled:opacity-50"
              >
                {queueLoading ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <span>↻</span>
                )}
                تحديث
              </button>
            </div>

            {queueLoading && !queue ? (
              <div className="flex items-center gap-2 text-sm text-ink-soft py-4">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-orange border-t-transparent" />
                جارٍ التحميل…
              </div>
            ) : queue ? (
              <div className="grid gap-4 sm:grid-cols-3">
                {(["front", "back", "cap"] as CalVariant[]).map((v) => (
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
                  { id: "cap" as CalVariant, label: "القبعة (اسم + عنصر)" },
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
                typedVariant === "cap"
                  ? "لمار | فراشة\nيوسف | شجرة\nعبدالله"
                  : "محمد علي\nفاطمة حسن\nأحمد كريم"
              }
              className="w-full rounded-xl border border-line bg-beige px-3 py-2.5 text-sm text-ink placeholder:text-ink/30 focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15 disabled:opacity-60"
            />
            {typedVariant === "cap" && (
              <p className="mt-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                للقبعة: اكتب الاسم ثم | ثم العنصر، مثال: <span className="font-semibold">لمار | فراشة</span> (العنصر اختياري)
              </p>
            )}
            <NameCountHint
              lines={typedText
                .split(/\r?\n/)
                .map((l) => (typedVariant === "cap" ? l.split("|")[0] : l).trim())
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
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-ink-soft">
                    أسماء التطريز (اختر المطلوب توليده)
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-orange-ink underline-offset-2 hover:underline"
                      onClick={() =>
                        setCheckedIds(new Set(grabRows.map((r) => r.order_item_id)))
                      }
                    >
                      تحديد الكل
                    </button>
                    <button
                      type="button"
                      className="text-xs text-ink-soft underline-offset-2 hover:underline"
                      onClick={() => setCheckedIds(new Set())}
                    >
                      إلغاء الكل
                    </button>
                  </div>
                </div>
                <ul className="max-h-72 overflow-y-auto rounded-xl border border-line bg-beige divide-y divide-line">
                  {grabRows.map((r) => (
                    <li key={r.order_item_id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
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
                        className="h-4 w-4 accent-orange-ink"
                      />
                      <label
                        htmlFor={`grab-${r.order_item_id}`}
                        className="flex flex-1 cursor-pointer items-center justify-between gap-2"
                      >
                        <span className="text-sm text-ink">{r.render_text}</span>
                        <span className="text-xs text-ink-soft">{r.student_name}</span>
                        <span className="rounded-full bg-beige px-2 py-0.5 text-[11px] text-ink-soft border border-line shrink-0">
                          {VARIANT_LABEL[r.variant] ?? r.variant}
                        </span>
                        <StatusPill status={r.plate_status ?? "pending"} />
                      </label>
                      {r.variant === "cap" && (
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
                          className="min-h-9 w-28 rounded-lg border border-line bg-white px-2 py-1 text-xs text-ink placeholder:text-ink/30 focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15"
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
              className="block w-full text-sm text-ink file:me-3 file:min-h-[36px] file:cursor-pointer file:rounded-full file:border-0 file:bg-orange-ink file:px-4 file:text-xs file:font-semibold file:text-white hover:file:opacity-90 disabled:opacity-60"
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

      {/* ── Proof grid ────────────────────────────────────────────────────── */}
      {plates.length > 0 && (
        <section>
          <h2 className="mb-4 font-display text-lg font-bold text-ink">
            اللوحات ({plates.length})
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {plates.map((plate) => (
              <PlateCard
                key={plate.id}
                plate={plate}
                onReroll={handleReroll}
                onLink={handleLink}
                onPreview={setPreview}
                onEdit={setCompositorPlate}
                rerolling={rerollingId === plate.id}
                linking={linkingId === plate.id}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Full-size plate preview ───────────────────────────────────────────── */}
      {preview && absUrl(preview.plate_path) && (
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
        </div>
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
