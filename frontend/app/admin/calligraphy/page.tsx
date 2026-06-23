"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { getApiErrorMessage } from "@/lib/api";
import {
  absUrl,
  calDownloadUrl,
  createCalJob,
  getCalJob,
  getCalNames,
  getCalWholesalers,
  isRealName,
  linkPlate,
  MIN_BATCH,
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
  onPreview,
  rerolling,
  linking,
}: {
  plate: CalPlate;
  onReroll: (id: string) => Promise<void>;
  onLink: (id: string) => Promise<void>;
  onPreview: (plate: CalPlate) => void;
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
            معاينة 🔍
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CalligraphyPage() {
  // ── mode + model ────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<InputMode>("typed");
  const model: ModelMode = "standard";

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

  // ── per-plate action states ─────────────────────────────────────────────────
  const [rerollingId, setRerollingId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  // ── confirm gate (junk names / small batch — admin's choice) ─────────────────
  const [confirm, setConfirm] = useState<{
    body: CreateJobBody;
    junk: string[];
    validCount: number;
  } | null>(null);

  // ── full-size plate preview (click a result) ─────────────────────────────────
  const [preview, setPreview] = useState<CalPlate | null>(null);
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
      if (job.dropped && job.dropped.length) {
        toast.message(`تم استبعاد ${job.dropped.length} اسم غير صالح`);
      }
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
    } catch (e) {
      toast.error(getApiErrorMessage(e, "فشل التوليد"));
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
      base = { source: "typed", model };
      allItems = lines.map((t) => ({ render_text: t }));
    } else if (mode === "txt") {
      if (!txtLines.length) {
        toast.error("اختر ملف .txt يحتوي على أسماء");
        return null;
      }
      base = { source: "txt", model };
      allItems = txtLines.map((t) => ({ render_text: t }));
    } else {
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
      allItems = selected.map((r) => ({
        render_text: r.render_text,
        student_id: r.student_id,
        order_item_id: r.order_item_id,
      }));
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
    // Admin's choice: junk is always excluded, but if anything was excluded OR the
    // batch is under 10, confirm before spending — otherwise generate straight away.
    if (junk.length > 0 || body.items.length < MIN_BATCH) {
      setConfirm({ body, junk, validCount: body.items.length });
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
            <NameCountHint
              lines={typedText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)}
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
              <>
                <p className="text-xs text-ink-soft">
                  تم قراءة {txtLines.length} سطر من الملف
                </p>
                <NameCountHint lines={txtLines} />
              </>
            )}
          </div>
        )}

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

      {/* ── Confirm gate (junk excluded / small batch) ────────────────────────── */}
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
            <p className="text-xs text-ink-soft">
              سيتم توليد <span className="font-semibold text-ink">{confirm.validCount}</span> اسم صالح.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
