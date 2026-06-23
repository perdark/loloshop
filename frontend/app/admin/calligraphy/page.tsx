"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { getApiErrorMessage } from "@/lib/api";
import {
  absUrl,
  calDownloadUrl,
  createCalJob,
  getCalJob,
  getCalNames,
  getCalWholesalers,
  linkPlate,
  processCalJob,
  rerollPlate,
  type CalGrabRow,
  type CalPlate,
  type CalWholesaler,
  type CreateJobBody,
} from "@/lib/calligraphy";

// ─── Types ──────────────────────────────────────────────────────────────────

type InputMode = "typed" | "wholesaler" | "txt";
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
  rerolling,
  linking,
}: {
  plate: CalPlate;
  onReroll: (id: string) => Promise<void>;
  onLink: (id: string) => Promise<void>;
  rerolling: boolean;
  linking: boolean;
}) {
  const imgUrl = absUrl(plate.plate_path);

  return (
    <article className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-3 shadow-sm">
      {/* image */}
      {plate.status === "done" && imgUrl ? (
        <div className="overflow-hidden rounded-xl bg-gray-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgUrl}
            alt={plate.render_text}
            className="w-full object-contain"
            loading="lazy"
          />
        </div>
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
        <StatusPill status={plate.status} />
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
          <a
            href={imgUrl}
            download
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-line bg-beige px-3.5 py-1.5 text-xs font-semibold text-ink transition-all duration-200 hover:border-orange/40 hover:text-orange-ink"
          >
            تنزيل
          </a>
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CalligraphyPage() {
  // ── mode + model ────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<InputMode>("typed");
  const [model, setModel] = useState<ModelMode>("standard");

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

  // ── job state ───────────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [plates, setPlates] = useState<CalPlate[]>([]);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [cost, setCost] = useState(0);

  // ── per-plate action states ─────────────────────────────────────────────────
  const [rerollingId, setRerollingId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);

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

  // ── generate loop ────────────────────────────────────────────────────────────
  async function runJob(body: CreateJobBody) {
    setRunning(true);
    try {
      const job = await createCalJob(body);
      setJobId(job.job_id);
      setPlates(job.plates);
      setTotal(job.total);
      setDone(0);
      setCost(0);

      let remaining = job.total;
      while (remaining > 0) {
        const r = await processCalJob(job.job_id);
        setDone(r.done);
        setCost(r.job_cost);
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
      setCost(full.job_cost);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "فشل التوليد"));
    } finally {
      setRunning(false);
    }
  }

  function buildItems(): CreateJobBody | null {
    if (mode === "typed") {
      const lines = typedText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (!lines.length) {
        toast.error("أدخل أسماء في المربع");
        return null;
      }
      return { source: "typed", model, items: lines.map((t) => ({ render_text: t })) };
    }

    if (mode === "txt") {
      if (!txtLines.length) {
        toast.error("اختر ملف .txt يحتوي على أسماء");
        return null;
      }
      return {
        source: "txt",
        model,
        items: txtLines.map((t) => ({ render_text: t })),
      };
    }

    // wholesaler
    if (!selectedWid) {
      toast.error("اختر ممثلاً");
      return null;
    }
    const selected = grabRows.filter((r) => checkedIds.has(r.order_item_id));
    if (!selected.length) {
      toast.error("اختر أسماء من القائمة");
      return null;
    }
    return {
      source: "wholesaler",
      model,
      wholesaler_id: selectedWid,
      items: selected.map((r) => ({
        render_text: r.render_text,
        student_id: r.student_id,
        order_item_id: r.order_item_id,
      })),
    };
  }

  function handleGenerate() {
    const body = buildItems();
    if (body) runJob(body);
  }

  // ── reroll ───────────────────────────────────────────────────────────────────
  async function handleReroll(id: string) {
    setRerollingId(id);
    try {
      const updated = await rerollPlate(id);
      setPlates((prev) => prev.map((p) => (p.id === id ? updated : p)));
      if (jobId) {
        const full = await getCalJob(jobId);
        setCost(full.job_cost);
      }
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
          {(
            [
              { id: "typed" as InputMode, label: "كتابة / لصق" },
              { id: "wholesaler" as InputMode, label: "حسب الممثل" },
              { id: "txt" as InputMode, label: "رفع ملف .txt" },
            ] as const
          ).map((tab) => (
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
              placeholder={"محمد علي\nفاطمة حسن\nأحمد كريم"}
              className="w-full rounded-xl border border-line bg-beige px-3 py-2.5 text-sm text-ink placeholder:text-ink/30 focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15 disabled:opacity-60"
            />
            <p className="mt-1 text-xs text-ink-soft">
              {typedText
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(Boolean).length}{" "}
              اسم
            </p>
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
                    <li key={r.order_item_id} className="flex items-center gap-3 px-3 py-2.5">
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
                        <StatusPill status={r.plate_status ?? "pending"} />
                      </label>
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
              <p className="text-xs text-ink-soft">
                تم قراءة {txtLines.length} اسم من الملف
              </p>
            )}
          </div>
        )}

        {/* model toggle */}
        <div className="mb-5">
          <p className="mb-1.5 text-xs font-semibold text-ink-soft">جودة التوليد</p>
          <div className="flex gap-2">
            {(
              [
                { id: "standard" as ModelMode, label: "عادي" },
                { id: "premium" as ModelMode, label: "فاخر" },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setModel(m.id)}
                disabled={running}
                className={`min-h-11 rounded-full px-5 py-2 text-sm font-semibold transition-all duration-200 disabled:opacity-60 ${
                  model === m.id
                    ? "bg-ink text-cream"
                    : "border border-line bg-beige text-ink hover:border-orange/40 hover:text-orange-ink"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* generate button */}
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
      </section>

      {/* ── Progress ──────────────────────────────────────────────────────── */}
      {(running || (jobId && total > 0)) && (
        <section className="surface-card rounded-2xl p-4 mb-6">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-ink">
              التقدم: {done} / {total}
            </p>
            <p className="text-sm tabular-nums text-ink-soft" dir="ltr">
              $ {cost.toFixed(2)}
            </p>
          </div>
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2.5 overflow-hidden rounded-full bg-orange/15"
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
                rerolling={rerollingId === plate.id}
                linking={linkingId === plate.id}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
