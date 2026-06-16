"use client";

import { useState } from "react";
import { toast } from "sonner";
import type {
  CreateFullSetPayload,
  FullSetExistingOrder,
  FullSetPackage,
  PieceType,
} from "@/lib/wholesaler";
import { resolveDesignMediaUrl } from "@/lib/designer";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

interface ZoneState {
  text: string;
  imageUrl: string;
  uploading: boolean;
}
type ZoneKey = "sashFront" | "sashBack" | "capSide" | "capTop";

const PRICE_FMT = new Intl.NumberFormat("ar-IQ");

function seedZone(z?: { text?: string; image_url?: string }): ZoneState {
  return { text: z?.text || "", imageUrl: z?.image_url || "", uploading: false };
}

export interface FullSetOrderFormProps {
  packages: FullSetPackage[];
  /** existing order to pre-fill (edit), or null for a fresh order */
  initial?: FullSetExistingOrder | null;
  submitting: boolean;
  submitLabel?: string;
  /** uploads a photo and resolves to its URL (endpoint differs per role) */
  onUploadImage: (file: File) => Promise<string>;
  onSubmit: (payload: CreateFullSetPayload) => void;
}

/**
 * The WhatsApp intake form, digitized. Shared by the rep ("fill on behalf") and the
 * student ("fill my own") so both see an identical form. Presentational: the parent
 * supplies packages, any existing order, and the submit/upload handlers.
 */
export function FullSetOrderForm({
  packages,
  initial,
  submitting,
  submitLabel = "حفظ الطلب",
  onUploadImage,
  onSubmit,
}: FullSetOrderFormProps) {
  const [packageId, setPackageId] = useState(
    initial?.package_id || (packages.length === 1 ? packages[0].id : "")
  );
  const [robeLen, setRobeLen] = useState(
    initial?.measurements ? String(initial.measurements.robe_length_cm) : ""
  );
  const [sleeveLen, setSleeveLen] = useState(
    initial?.measurements ? String(initial.measurements.sleeve_length_cm) : ""
  );
  const [shoulder, setShoulder] = useState(
    initial?.measurements ? String(initial.measurements.shoulder_cm) : ""
  );
  const [sashType, setSashType] = useState<PieceType | "">(initial?.sash_type || "");
  const [capType, setCapType] = useState<PieceType | "">(initial?.cap_type || "");
  const [zones, setZones] = useState<Record<ZoneKey, ZoneState>>({
    sashFront: seedZone(initial?.embroidery.sash_front),
    sashBack: seedZone(initial?.embroidery.sash_back),
    capSide: seedZone(initial?.embroidery.cap_side),
    capTop: seedZone(initial?.embroidery.cap_top),
  });
  const [notes, setNotes] = useState(initial?.notes || "");
  const [shoulderPleat, setShoulderPleat] = useState(initial?.shoulder_pleat ?? false);
  const [shawlEnabled, setShawlEnabled] = useState(
    initial?.american_shawl?.enabled ?? false
  );
  const [shawlImage, setShawlImage] = useState(initial?.american_shawl?.image_url || "");
  const [shawlUploading, setShawlUploading] = useState(false);

  function setZone(key: ZoneKey, patch: Partial<ZoneState>) {
    setZones((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function handleUpload(key: ZoneKey, file: File) {
    setZone(key, { uploading: true });
    try {
      const url = await onUploadImage(file);
      setZone(key, { imageUrl: url, uploading: false });
    } catch {
      setZone(key, { uploading: false });
      toast.error("تعذر رفع الصورة");
    }
  }

  async function handleShawlUpload(file: File) {
    setShawlUploading(true);
    try {
      const url = await onUploadImage(file);
      setShawlImage(url);
    } catch {
      toast.error("تعذر رفع الصورة");
    } finally {
      setShawlUploading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!packageId) return toast.error("يرجى اختيار الطقم");
    if (!robeLen || !sleeveLen || !shoulder)
      return toast.error("يرجى إدخال قياسات الروب كاملة");
    if (!sashType) return toast.error("يرجى اختيار نوع الوشاح");
    if (!capType) return toast.error("يرجى اختيار نوع القبعة");
    if (shawlUploading || Object.values(zones).some((z) => z.uploading))
      return toast.error("يرجى الانتظار حتى انتهاء رفع الصور");
    if (shawlEnabled && !shawlImage)
      return toast.error("صورة الشال الأمريكي مطلوبة");

    const zone = (z: ZoneState) => ({
      text: z.text.trim() || undefined,
      image_url: z.imageUrl || undefined,
    });
    onSubmit({
      package_id: packageId,
      measurements: {
        robe_length_cm: robeLen,
        sleeve_length_cm: sleeveLen,
        shoulder_cm: shoulder,
      },
      sash_type: sashType,
      cap_type: capType,
      shoulder_pleat: shoulderPleat,
      american_shawl: {
        enabled: shawlEnabled,
        image_url: shawlEnabled ? shawlImage : undefined,
      },
      embroidery: {
        sash_front: zone(zones.sashFront),
        sash_back: zone(zones.sashBack),
        cap_side: zone(zones.capSide),
        cap_top: zone(zones.capTop),
      },
      notes: notes.trim() || undefined,
    });
  }

  const selectedPkg = packages.find((p) => p.id === packageId);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* ── الطقم ── */}
      <Section title="الطقم">
        {packages.length === 0 ? (
          <p className="text-sm text-danger">
            لا يوجد طقم كامل مُفعّل حالياً.
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
        <div className="mt-3">
          <YesNoToggle
            label="كسرة الكتف"
            value={shoulderPleat}
            onChange={setShoulderPleat}
          />
        </div>
      </Section>

      {/* ── النوع ── */}
      <Section title="النوع">
        <div className="space-y-3">
          <TypeToggle label="نوع الوشاح" value={sashType} onChange={setSashType} />
          <TypeToggle label="نوع القبعة" value={capType} onChange={setCapType} />
        </div>
      </Section>

      {/* ── شال امريكي ── */}
      <Section title="شال امريكي" hint="صورة الشال إجبارية عند الاختيار">
        <div className="space-y-3">
          <YesNoToggle
            label="إضافة شال امريكي"
            value={shawlEnabled}
            onChange={setShawlEnabled}
          />
          {shawlEnabled && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">
                صورة الشال <span className="text-danger">*</span>
              </p>
              <div className="flex items-center gap-2.5">
                {shawlImage ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={resolveDesignMediaUrl(shawlImage)}
                      alt="صورة الشال الأمريكي"
                      className="h-16 w-16 rounded-lg border border-line object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setShawlImage("")}
                      className="min-h-11 text-sm font-medium text-danger hover:underline"
                    >
                      إزالة الصورة
                    </button>
                  </>
                ) : (
                  <label className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-line bg-beige px-3.5 text-sm font-medium text-ink-soft transition-colors hover:border-orange/40 hover:text-orange-ink">
                    {shawlUploading ? "جارٍ الرفع…" : "إرفاق صورة الشال"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      disabled={shawlUploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleShawlUpload(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
          )}
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
          placeholder="أي تفاصيل إضافية…"
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
          ? `${submitLabel} — ${PRICE_FMT.format(selectedPkg.price)} د.ع`
          : submitLabel}
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

function YesNoToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={value ? "primary" : "ghost"}
          onClick={() => onChange(true)}
        >
          نعم
        </Button>
        <Button
          type="button"
          variant={!value ? "primary" : "ghost"}
          onClick={() => onChange(false)}
        >
          لا
        </Button>
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
