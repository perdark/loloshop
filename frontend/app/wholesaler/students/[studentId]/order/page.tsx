"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import {
  getWholesalerStudent,
  getFullSetPackages,
  createWholesalerFullSetOrder,
  uploadWholesalerImage,
  type WholesalerStudentDetail,
  type FullSetPackage,
  type PieceType,
} from "@/lib/wholesaler";
import { resolveDesignMediaUrl } from "@/lib/designer";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/** One embroidery zone: the name to embroider + an optional reference photo. */
interface ZoneState {
  text: string;
  imageUrl: string;
  uploading: boolean;
}
const emptyZone = (): ZoneState => ({ text: "", imageUrl: "", uploading: false });

type ZoneKey = "sashFront" | "sashBack" | "capSide" | "capTop";

const PRICE_FMT = new Intl.NumberFormat("ar-IQ");

export default function WholesalerStudentOrderPage() {
  const params = useParams<{ studentId: string }>();
  const studentId = params.studentId;
  const router = useRouter();

  const [student, setStudent] = useState<WholesalerStudentDetail | null>(null);
  const [packages, setPackages] = useState<FullSetPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // form state
  const [packageId, setPackageId] = useState("");
  const [robeLen, setRobeLen] = useState("");
  const [sleeveLen, setSleeveLen] = useState("");
  const [shoulder, setShoulder] = useState("");
  const [sashType, setSashType] = useState<PieceType | "">("");
  const [capType, setCapType] = useState<PieceType | "">("");
  const [zones, setZones] = useState<Record<ZoneKey, ZoneState>>({
    sashFront: emptyZone(),
    sashBack: emptyZone(),
    capSide: emptyZone(),
    capTop: emptyZone(),
  });
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(false);
    Promise.all([getWholesalerStudent(studentId), getFullSetPackages()])
      .then(([s, pkgs]) => {
        if (!alive) return;
        setStudent(s);
        setPackages(pkgs);
        if (pkgs.length === 1) setPackageId(pkgs[0].id);
      })
      .catch((err) => {
        if (!alive) return;
        setLoadError(true);
        toast.error(getApiErrorMessage(err, "تعذر تحميل بيانات الطالب"));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [studentId]);

  function setZone(key: ZoneKey, patch: Partial<ZoneState>) {
    setZones((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function handleUpload(key: ZoneKey, file: File) {
    setZone(key, { uploading: true });
    try {
      const url = await uploadWholesalerImage(file);
      setZone(key, { imageUrl: url, uploading: false });
    } catch (err) {
      setZone(key, { uploading: false });
      toast.error(getApiErrorMessage(err, "تعذر رفع الصورة"));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!packageId) return toast.error("يرجى اختيار الطقم");
    if (!robeLen || !sleeveLen || !shoulder)
      return toast.error("يرجى إدخال قياسات الروب كاملة");
    if (!sashType) return toast.error("يرجى اختيار نوع الوشاح");
    if (!capType) return toast.error("يرجى اختيار نوع القبعة");
    if (Object.values(zones).some((z) => z.uploading))
      return toast.error("يرجى الانتظار حتى انتهاء رفع الصور");

    setSubmitting(true);
    try {
      const zone = (z: ZoneState) => ({
        text: z.text.trim() || undefined,
        image_url: z.imageUrl || undefined,
      });
      const res = await createWholesalerFullSetOrder(studentId, {
        package_id: packageId,
        measurements: {
          robe_length_cm: robeLen,
          sleeve_length_cm: sleeveLen,
          shoulder_cm: shoulder,
        },
        sash_type: sashType,
        cap_type: capType,
        embroidery: {
          sash_front: zone(zones.sashFront),
          sash_back: zone(zones.sashBack),
          cap_side: zone(zones.capSide),
          cap_top: zone(zones.capTop),
        },
        notes: notes.trim() || undefined,
      });
      toast.success(`تم حفظ طلب ${res.packageName}`);
      router.push("/wholesaler/students");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر حفظ الطلب"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PageLoader />;

  if (loadError || !student) {
    return (
      <div className="space-y-4">
        <BackLink />
        <EmptyState
          title="تعذر تحميل الطالب"
          message="تحقق من الاتصال ثم حاول مجدداً."
        />
      </div>
    );
  }

  if (student.status !== "approved") {
    return (
      <div className="space-y-4">
        <BackLink />
        <EmptyState
          title="الطالب غير موافق عليه"
          message="يجب الموافقة على الطالب أولاً قبل إدخال الطلب."
        />
      </div>
    );
  }

  const selectedPkg = packages.find((p) => p.id === packageId);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="section-heading font-display-ar text-xl font-bold text-ink">
            طلب جديد
          </h1>
          <p className="mt-0.5 truncate text-sm text-ink-soft">
            {student.name}
            {student.universityName ? ` — ${student.universityName}` : ""}
          </p>
        </div>
        <BackLink />
      </div>

      {student.hasOrder && (
        <p className="rounded-xl border border-line bg-[var(--shop-sink)] px-3.5 py-2.5 text-xs text-ink-soft">
          هذا الطالب لديه طلب مسجّل — الحفظ سيُحدّث الطلب الحالي.
        </p>
      )}

      {/* ── الطقم ── */}
      <Section title="الطقم">
        {packages.length === 0 ? (
          <p className="text-sm text-danger">
            لا يوجد طقم كامل مُفعّل. أضِف باقة «طقم كامل» من لوحة المدير أولاً.
          </p>
        ) : (
          <div className="grid gap-2">
            {packages.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPackageId(p.id)}
                aria-pressed={packageId === p.id}
                className={`flex items-center justify-between rounded-xl border px-3.5 py-3 text-start transition-colors ${
                  packageId === p.id
                    ? "border-orange-ink bg-orange-ink/10"
                    : "border-line bg-beige hover:border-orange/40"
                }`}
              >
                <span className="font-semibold text-ink">{p.name_ar}</span>
                <span className="text-sm tabular-nums text-ink-soft">
                  {PRICE_FMT.format(p.price)} د.ع
                </span>
              </button>
            ))}
          </div>
        )}
      </Section>

      {/* ── فصال الروب ── */}
      <Section title="فصال الروب" hint="بالسنتيمتر">
        <div className="grid grid-cols-3 gap-2.5">
          <Input
            label="طول الروب"
            type="number"
            inputMode="numeric"
            min={70}
            max={190}
            value={robeLen}
            onChange={(e) => setRobeLen(e.target.value)}
            placeholder="113"
          />
          <Input
            label="طول الردن"
            type="number"
            inputMode="numeric"
            min={30}
            max={100}
            value={sleeveLen}
            onChange={(e) => setSleeveLen(e.target.value)}
            placeholder="65"
          />
          <Input
            label="عرض الكتف"
            type="number"
            inputMode="numeric"
            min={25}
            max={80}
            value={shoulder}
            onChange={(e) => setShoulder(e.target.value)}
            placeholder="49"
          />
        </div>
      </Section>

      {/* ── النوع ── */}
      <Section title="النوع">
        <div className="space-y-3">
          <TypeToggle
            label="نوع الوشاح"
            value={sashType}
            onChange={setSashType}
          />
          <TypeToggle label="نوع القبعة" value={capType} onChange={setCapType} />
        </div>
      </Section>

      {/* ── التطريز ── */}
      <Section title="التطريز" hint="اكتب الاسم المراد تطريزه — صورة اختيارية">
        <div className="space-y-3.5">
          <EmbroideryField
            label="تطريز الوشاح من الأمام"
            zone={zones.sashFront}
            onText={(v) => setZone("sashFront", { text: v })}
            onFile={(f) => handleUpload("sashFront", f)}
            onClear={() => setZone("sashFront", { imageUrl: "" })}
          />
          <EmbroideryField
            label="تطريز الوشاح من الخلف"
            zone={zones.sashBack}
            onText={(v) => setZone("sashBack", { text: v })}
            onFile={(f) => handleUpload("sashBack", f)}
            onClear={() => setZone("sashBack", { imageUrl: "" })}
          />
          <EmbroideryField
            label="تطريز القبعة من الجانب"
            zone={zones.capSide}
            onText={(v) => setZone("capSide", { text: v })}
            onFile={(f) => handleUpload("capSide", f)}
            onClear={() => setZone("capSide", { imageUrl: "" })}
          />
          <EmbroideryField
            label="تطريز القبعة من الأعلى"
            zone={zones.capTop}
            onText={(v) => setZone("capTop", { text: v })}
            onFile={(f) => handleUpload("capTop", f)}
            onClear={() => setZone("capTop", { imageUrl: "" })}
          />
        </div>
      </Section>

      {/* ── ملاحظة ── */}
      <Section title="ملاحظة">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="أي تفاصيل إضافية للطالب…"
          className="min-h-11 w-full rounded-xl border border-line bg-beige px-3.5 py-2.5 text-ink shadow-[var(--shadow-soft)] outline-none transition-colors duration-200 placeholder:text-ink/55 hover:border-ink/30 focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
        />
      </Section>

      <Button
        type="submit"
        fullWidth
        size="lg"
        loading={submitting}
        disabled={packages.length === 0}
      >
        {selectedPkg
          ? `حفظ الطلب — ${PRICE_FMT.format(selectedPkg.price)} د.ع`
          : "حفظ الطلب"}
      </Button>
    </form>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="surface-card space-y-3 rounded-2xl p-3.5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display-ar font-bold text-ink">{title}</h2>
        {hint && <span className="text-xs text-[var(--shop-muted)]">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function TypeToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: PieceType | "";
  onChange: (v: PieceType) => void;
}) {
  const opts: PieceType[] = ["عادي", "ملكي"];
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        {opts.map((o) => (
          <Button
            key={o}
            type="button"
            variant={value === o ? "primary" : "ghost"}
            onClick={() => onChange(o)}
          >
            {o}
          </Button>
        ))}
      </div>
    </div>
  );
}

function EmbroideryField({
  label,
  zone,
  onText,
  onFile,
  onClear,
}: {
  label: string;
  zone: ZoneState;
  onText: (v: string) => void;
  onFile: (f: File) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-2">
      <Input
        label={label}
        value={zone.text}
        onChange={(e) => onText(e.target.value)}
        placeholder="الاسم المراد تطريزه (اختياري)"
        maxLength={200}
      />
      <div className="flex items-center gap-2.5">
        {zone.imageUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={resolveDesignMediaUrl(zone.imageUrl)}
              alt={`صورة ${label}`}
              className="h-12 w-12 rounded-lg border border-line object-cover"
            />
            <button
              type="button"
              onClick={onClear}
              className="min-h-11 text-sm font-medium text-danger hover:underline"
            >
              إزالة الصورة
            </button>
          </>
        ) : (
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-line bg-beige px-3.5 text-sm font-medium text-ink-soft transition-colors hover:border-orange/40 hover:text-orange-ink">
            {zone.uploading ? "جارٍ الرفع…" : "إرفاق صورة"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={zone.uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/wholesaler/students"
      className="inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-orange-ink hover:underline"
    >
      ← رجوع
    </Link>
  );
}
