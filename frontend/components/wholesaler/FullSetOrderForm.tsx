"use client";

import { useState } from "react";
import { toast } from "sonner";
import type {
  CreateFullSetPayload,
  FullSetExistingOrder,
  FullSetPricing,
  PieceType,
} from "@/lib/wholesaler";
import { DEFAULT_FULLSET_ADDONS } from "@/lib/wholesaler";
import { resolveDesignMediaUrl } from "@/lib/designer";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

interface ZoneState {
  text: string;
  imageUrl: string;
  uploading: boolean;
}
type ZoneKey =
  | "sashFront"
  | "sashBack"
  | "capSide"
  | "capTop"
  | "robeSleeveRight"
  | "robeSleeveLeft";

const PRICE_FMT = new Intl.NumberFormat("ar-IQ");

function seedZone(z?: { text?: string; image_url?: string }): ZoneState {
  return { text: z?.text || "", imageUrl: z?.image_url || "", uploading: false };
}

export interface FullSetOrderFormProps {
  /** existing order to pre-fill (edit), or null for a fresh order */
  initial?: FullSetExistingOrder | null;
  /** «التسعيرة»: rep/student base price + add-on surcharges (drives the live total). */
  pricing?: FullSetPricing | null;
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
  initial,
  pricing,
  submitting,
  submitLabel = "حفظ الطلب",
  onUploadImage,
  onSubmit,
}: FullSetOrderFormProps) {
  // Per-field null-safe seed: measurements are all optional, so a missing field stays blank
  // (never renders the literal "null").
  const measSeed = (v: number | null | undefined) => (v == null ? "" : String(v));
  const [robeLen, setRobeLen] = useState(measSeed(initial?.measurements?.robe_length_cm));
  const [sleeveLen, setSleeveLen] = useState(measSeed(initial?.measurements?.sleeve_length_cm));
  const [shoulder, setShoulder] = useState(measSeed(initial?.measurements?.shoulder_cm));
  const [chest, setChest] = useState(measSeed(initial?.measurements?.chest_cm));
  const [tailorNotes, setTailorNotes] = useState(
    initial?.measurements?.tailor_notes || ""
  );
  const [sashType, setSashType] = useState<PieceType | "">(initial?.sash_type || "");
  const [capType, setCapType] = useState<PieceType | "">(initial?.cap_type || "");
  const [zones, setZones] = useState<Record<ZoneKey, ZoneState>>({
    sashFront: seedZone(initial?.embroidery.sash_front),
    sashBack: seedZone(initial?.embroidery.sash_back),
    capSide: seedZone(initial?.embroidery.cap_side),
    capTop: seedZone(initial?.embroidery.cap_top),
    robeSleeveRight: seedZone(initial?.embroidery.robe_sleeve_right),
    robeSleeveLeft: seedZone(initial?.embroidery.robe_sleeve_left),
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
    // Every field is optional — the rep/student can save now and complete later. The only
    // guard left is waiting for an in-flight image upload so it isn't lost on submit.
    if (shawlUploading || Object.values(zones).some((z) => z.uploading))
      return toast.error("يرجى الانتظار حتى انتهاء رفع الصور");

    const zone = (z: ZoneState) => ({
      text: z.text.trim() || undefined,
      image_url: z.imageUrl || undefined,
    });
    onSubmit({
      measurements: {
        robe_length_cm: robeLen,
        sleeve_length_cm: sleeveLen,
        shoulder_cm: shoulder,
        chest_cm: chest,
        tailor_notes: tailorNotes.trim() || undefined,
      },
      sash_type: sashType || undefined,
      cap_type: capType || undefined,
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
        robe_sleeve_right: zone(zones.robeSleeveRight),
        robe_sleeve_left: zone(zones.robeSleeveLeft),
      },
      notes: notes.trim() || undefined,
    });
  }

  // ── «التسعيرة»: live total = base + applicable add-ons (mirrors backend fullSetOrder.js) ──
  const addons = pricing?.addons ?? DEFAULT_FULLSET_ADDONS;
  const basePrice = pricing?.base ?? 0;
  const zoneHasContent = (z: ZoneState) => !!(z.text.trim() || z.imageUrl);
  const capEmbCount =
    (zoneHasContent(zones.capSide) ? 1 : 0) + (zoneHasContent(zones.capTop) ? 1 : 0);
  const robeSleeveCount =
    (zoneHasContent(zones.robeSleeveRight) ? 1 : 0) +
    (zoneHasContent(zones.robeSleeveLeft) ? 1 : 0);
  const addonRows: { label: string; amount: number }[] = [];
  if (sashType === "ملكي" && addons.royal_sash > 0)
    addonRows.push({ label: "وشاح ملكي", amount: addons.royal_sash });
  if (sashType === "عادي" && capType === "ملكي" && addons.royal_cap_when_normal_sash > 0)
    addonRows.push({ label: "قبعة ملكية", amount: addons.royal_cap_when_normal_sash });
  if (capEmbCount >= 2 && addons.extra_cap_embroidery > 0)
    addonRows.push({ label: "تطريز قبعة ثانٍ", amount: addons.extra_cap_embroidery });
  if (robeSleeveCount > 0 && addons.robe_sleeve_each > 0)
    addonRows.push({
      label: `تطريز ردن الروب ×${robeSleeveCount}`,
      amount: addons.robe_sleeve_each * robeSleeveCount,
    });
  if (shawlEnabled && addons.american_shawl > 0)
    addonRows.push({ label: "شال امريكي", amount: addons.american_shawl });
  const addonTotal = addonRows.reduce((s, r) => s + r.amount, 0);
  const totalPrice = basePrice + addonTotal;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* ── قياسات الروب ── */}
      <Section title="قياسات الروب" hint="بالسنتيمتر">
        <div className="grid grid-cols-2 gap-2.5">
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
          <Input
            label="محيط الصدر"
            type="number"
            inputMode="numeric"
            min={60}
            max={180}
            value={chest}
            onChange={(e) => setChest(e.target.value)}
            placeholder="100"
          />
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
        </div>
        <div className="mt-3">
          <YesNoToggle
            label="كسرة الكتف"
            value={shoulderPleat}
            onChange={setShoulderPleat}
          />
        </div>
        <div className="mt-3">
          <label
            htmlFor="fs-tailor-notes"
            className="mb-1.5 block text-sm font-medium text-ink"
          >
            ملاحظات لفصال الروب
            <span className="ms-1 text-xs font-normal text-ink-soft">(اختياري)</span>
          </label>
          <textarea
            id="fs-tailor-notes"
            value={tailorNotes}
            onChange={(e) => setTailorNotes(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="أي تفاصيل إضافية عن الفصال…"
            className="min-h-11 w-full rounded-xl border border-line bg-beige px-3.5 py-2.5 text-ink shadow-[var(--shadow-soft)] outline-none transition-colors duration-200 placeholder:text-ink/55 hover:border-ink/30 focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
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
      <Section title="شال امريكي" hint="صورة اختيارية">
        <div className="space-y-3">
          <YesNoToggle
            label="إضافة شال امريكي"
            value={shawlEnabled}
            onChange={setShawlEnabled}
          />
          {shawlEnabled && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">
                صورة الشال{" "}
                <span className="text-xs font-normal text-ink-soft">(اختياري)</span>
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
          <div className="border-t border-line pt-3.5">
            <p className="mb-2 text-xs text-[var(--shop-muted)]">
              تطريز ردن الروب — الروب له ردنان (الأيمن والأيسر)
            </p>
            <div className="space-y-3.5">
              <EmbroideryField
                label="تطريز ردن الروب الأيمن"
                zone={zones.robeSleeveRight}
                onText={(v) => setZone("robeSleeveRight", { text: v })}
                onFile={(f) => handleUpload("robeSleeveRight", f)}
                onClear={() => setZone("robeSleeveRight", { imageUrl: "" })}
              />
              <EmbroideryField
                label="تطريز ردن الروب الأيسر"
                zone={zones.robeSleeveLeft}
                onText={(v) => setZone("robeSleeveLeft", { text: v })}
                onFile={(f) => handleUpload("robeSleeveLeft", f)}
                onClear={() => setZone("robeSleeveLeft", { imageUrl: "" })}
              />
            </div>
          </div>
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

      {/* ── التسعيرة (الإجمالي المباشر) ── */}
      <Section title="التسعيرة">
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-ink-soft">السعر الأساسي</dt>
            <dd className="tabular-nums text-ink" dir="ltr">
              {basePrice > 0 ? (
                <>{PRICE_FMT.format(basePrice)} د.ع</>
              ) : (
                <span className="text-xs text-[var(--shop-muted)]">
                  لم يُحدَّد سعر لهذا الممثل — راجع الإدارة
                </span>
              )}
            </dd>
          </div>
          {addonRows.map((r) => (
            <div key={r.label} className="flex items-center justify-between">
              <dt className="text-ink-soft">{r.label}</dt>
              <dd className="tabular-nums text-ink" dir="ltr">
                + {PRICE_FMT.format(r.amount)} د.ع
              </dd>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-line pt-2">
            <dt className="font-bold text-ink">الإجمالي</dt>
            <dd className="font-display text-lg font-bold text-orange-ink tabular-nums" dir="ltr">
              {PRICE_FMT.format(totalPrice)} د.ع
            </dd>
          </div>
        </dl>
      </Section>

      <Button
        type="submit"
        fullWidth
        size="lg"
        loading={submitting}
      >
        {totalPrice > 0
          ? `${submitLabel} — ${PRICE_FMT.format(totalPrice)} د.ع`
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
