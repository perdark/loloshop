"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { CreateFullSetPayload } from "@/lib/wholesaler";
import type {
  CustomOrderConfig,
  CustomOrderPayload,
  StudentFullSetContext,
  StudentSearchHit,
} from "@/lib/staff";
import { FullSetOrderForm } from "@/components/wholesaler/FullSetOrderForm";
import { RetailOrderBuilder } from "@/components/staff/RetailOrderBuilder";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";

interface CustomOrderFormProps {
  config: CustomOrderConfig;
  submitting: boolean;
  /** Existing-student mode sends {student_id}; new mode sends {student_name, wholesaler_id}. */
  onSubmit: (payload: CustomOrderPayload) => void;
  onUploadImage: (file: File) => Promise<string>;
  onSearchStudents: (q: string) => Promise<StudentSearchHit[]>;
  /** Loads a picked student's existing طقم + effective pricing (pre-fills the form so
   *  a save EDITS the order — a blank form would wipe it via the optional-everything upsert). */
  onLoadStudentContext: (studentId: string) => Promise<StudentFullSetContext>;
  /** A تجزئة order is created by RetailOrderBuilder itself (its own endpoint), so the page
   *  is told after the fact instead of via onSubmit. */
  onRetailCreated: (result: {
    studentId: string;
    orders: { id: string }[];
    total: number;
  }) => void;
}

/**
 * «طلب مخصص» — shared by /admin/custom-order and the manager's /staff/custom-order
 * (the pages differ only in which API endpoints they call). Two student modes:
 * «طالب جديد» creates a name-only account; «طالب موجود» searches the real roster and
 * places/edits that student's طقم (the backend upserts — no duplicates).
 */
export function CustomOrderForm({
  config,
  submitting,
  onSubmit,
  onUploadImage,
  onSearchStudents,
  onLoadStudentContext,
  onRetailCreated,
}: CustomOrderFormProps) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [studentName, setStudentName] = useState("");
  const [wholesalerId, setWholesalerId] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [results, setResults] = useState<StudentSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<StudentSearchHit | null>(null);
  const [pickedCtx, setPickedCtx] = useState<StudentFullSetContext | null>(null);
  const [pickedLoading, setPickedLoading] = useState(false);

  function pickStudent(hit: StudentSearchHit) {
    setPicked(hit);
    setPickedCtx(null);
    // A تجزئة student gets the single-piece retail form instead, and the طقم read-back
    // 403s for them by design — so don't ask for it.
    if (!hit.full_set_eligible) return;
    setPickedLoading(true);
    onLoadStudentContext(hit.id)
      .then(setPickedCtx)
      .catch(() => {
        toast.error("تعذر تحميل طلب الطالب — أعد المحاولة");
        setPicked(null);
      })
      .finally(() => setPickedLoading(false));
  }

  useEffect(() => {
    if (mode !== "existing" || picked) return;
    const q = searchQ.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      onSearchStudents(q)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [mode, searchQ, picked, onSearchStudents]);

  // Which form the picked student gets is the server's call, mirrored here from the flag it
  // returns — the طقم endpoints 403 for a تجزئة student and the retail one 403s for everyone
  // else, so guessing would just produce a form that cannot save.
  const retailPick = mode === "existing" && picked && !picked.full_set_eligible ? picked : null;
  // A brand-new student with NO rep is a تجزئة order, so it gets the retail builder. Picking a
  // rep keeps the طقم form — that path is priced from the rep's التسعيرة and enters their
  // approval flow, which the retail builder deliberately does not do.
  const independentNew = mode === "new" && !wholesalerId;

  const selectedWholesaler = useMemo(
    () => config.wholesalers.find((w) => w.id === wholesalerId) || null,
    [config, wholesalerId]
  );
  // The server-loaded context is authoritative for a picked student (their rep's
  // real التسعيرة); the config lookup is only the pre-pick fallback.
  const pricing =
    mode === "existing"
      ? pickedCtx?.pricing ?? config.pricing ?? null
      : selectedWholesaler?.pricing ?? config.pricing ?? null;
  const existingInitial = mode === "existing" ? pickedCtx?.existing ?? null : null;

  const wholesalerOptions = [
    { value: "", label: "طلب مستقل بدون ممثل" },
    ...config.wholesalers.map((w) => ({
      value: w.id,
      label: `${w.name}${w.universityName ? ` — ${w.universityName}` : ""}`,
    })),
  ];

  function handleSubmit(payload: CreateFullSetPayload) {
    if (mode === "existing") {
      if (!picked) {
        toast.error("اختر الطالب أولاً");
        return;
      }
      onSubmit({ ...payload, student_id: picked.id });
      return;
    }
    const name = studentName.trim();
    if (!name) {
      toast.error("اسم الطالب مطلوب");
      return;
    }
    onSubmit({ ...payload, student_name: name, wholesaler_id: wholesalerId || null });
  }

  const modeChip = (value: "new" | "existing", label: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={`min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors ${
        mode === value
          ? "border-orange-ink bg-orange-ink text-white"
          : "border-line bg-beige text-ink-soft hover:border-orange-ink/40"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)]">
        <div className="mb-3 flex flex-wrap gap-2">
          {modeChip("new", "طالب جديد")}
          {modeChip("existing", "طالب موجود")}
        </div>

        {mode === "new" ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              {/* An independent order collects the full student record inside the retail
                  builder below (name + phone + gender + …), so this lone name field would
                  be a second, conflicting source for the same value. */}
              {!independentNew && (
                <Input
                  label="اسم الطالب"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  placeholder="الاسم الكامل للطالب"
                  maxLength={120}
                  autoFocus
                />
              )}
              <Select
                label="ربط الطلب"
                value={wholesalerId}
                onChange={(e) => setWholesalerId(e.target.value)}
                options={wholesalerOptions}
              />
            </div>
            <p className="mt-2 text-xs text-muted">
              {independentNew
                ? "طلب تجزئة بأسعار المفرد — نفس منتجات وخيارات المتجر. عند ربطه بممثل يتحوّل إلى طقم بتسعيرة ذلك الممثل."
                : "يرث الطلب الجامعة والقسم وتسعيرة الممثل المختار."}
            </p>
          </>
        ) : picked ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-[var(--shop-sink)] px-3.5 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink">{picked.name}</p>
              <p className="mt-0.5 text-xs text-ink-soft">
                {[picked.rep_name ? `ممثل: ${picked.rep_name}` : "تجزئة", picked.university_name]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {!picked.full_set_eligible ? (
                <p className="mt-1 text-xs font-semibold text-orange-ink">
                  طالب تجزئة — يُنشأ له طلب قطعة واحدة بأسعار المفرد، مستقل عن طلباته الحالية.
                </p>
              ) : picked.has_full_set ? (
                <p className="mt-1 text-xs font-semibold text-orange-ink">
                  لديه طقم مسجّل — الحقول معبّأة بطلبه الحالي والحفظ يعدّله.
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setPicked(null);
                setPickedCtx(null);
                setSearchQ("");
                setResults([]);
              }}
              className="min-h-11 rounded-full border border-line bg-beige px-4 text-sm font-semibold text-ink-soft hover:border-orange-ink/40"
            >
              تغيير الطالب
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <Input
              label="ابحث عن الطالب"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="الاسم أو رقم الهاتف (حرفان على الأقل)"
              autoFocus
            />
            {searching && (
              // <div>, not <p> — Spinner renders a <div> and a <div> inside a <p> is
              // invalid HTML, which React reports as a hydration error.
              <div className="flex items-center gap-2 text-xs text-muted">
                <Spinner className="h-4 w-4" /> جارٍ البحث…
              </div>
            )}
            {!searching && searchQ.trim().length >= 2 && !results.length && (
              <p className="text-xs text-muted">لا نتائج مطابقة.</p>
            )}
            {results.length > 0 && (
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-beige">
                {results.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => pickStudent(s)}
                      className="flex min-h-11 w-full items-center justify-between gap-3 px-3.5 py-2.5 text-start hover:bg-[var(--shop-sink)]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink">
                          {s.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-soft">
                          {[
                            s.rep_name ? `ممثل: ${s.rep_name}` : "تجزئة",
                            s.university_name,
                            s.phone || null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      {s.has_full_set && (
                        <span className="shrink-0 rounded-full bg-orange-ink/10 px-2.5 py-1 text-[11px] font-semibold text-orange-ink">
                          لديه طقم
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {mode === "existing" && pickedLoading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-4 text-sm text-ink-soft">
          <Spinner className="h-4 w-4" /> جارٍ تحميل طلب الطالب…
        </div>
      ) : retailPick ? (
        <RetailOrderBuilder
          key={retailPick.id}
          student={{
            id: retailPick.id,
            name: retailPick.name,
            phone: retailPick.phone,
            gender: retailPick.gender,
          }}
          onCreated={onRetailCreated}
        />
      ) : independentNew ? (
        // «طلب مستقل بدون ممثل» — a real retail order (full catalog, catalog option groups,
        // retail prices), NOT the rep طقم form. The student is created by the builder with a
        // phone + gender, which is what keeps the RETAIL edit path owning these orders.
        <RetailOrderBuilder key="independent-new" onCreated={onRetailCreated} />
      ) : (
        <FullSetOrderForm
          key={mode === "existing" ? picked?.id ?? "none" : "new"}
          pricing={pricing}
          initial={existingInitial}
          submitting={submitting}
          submitLabel={mode === "existing" && picked?.has_full_set ? "حفظ الطلب" : "إنشاء الطلب"}
          onUploadImage={onUploadImage}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}
