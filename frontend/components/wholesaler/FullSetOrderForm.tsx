"use client";

import { useState } from "react";
import { toast } from "sonner";
import type {
  CreateFullSetPayload,
  FullSetExistingOrder,
  FullSetPricing,
  PieceType,
  ProductPiece,
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
const DEFAULT_PACKAGE_PRICE = 50000;

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
  const [selectedPieces, setSelectedPieces] = useState<ProductPiece[]>(
    initial?.selected_pieces?.length ? initial.selected_pieces : []
  );
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
  const [shawlNote, setShawlNote] = useState(initial?.american_shawl?.notes || "");
  const [shawlUploading, setShawlUploading] = useState(false);
  const hasPiece = (piece: ProductPiece) => selectedPieces.includes(piece);
  const hasAnyPiece = selectedPieces.length > 0;
  const selectedSash = hasPiece("sash");
  const selectedCap = hasPiece("cap");
  const selectedRobe = hasPiece("robe");
  const isFullPackage = selectedSash && selectedCap && selectedRobe;

  function togglePiece(piece: ProductPiece) {
    if (!selectedPieces.includes(piece)) {
      if (piece === "sash" && !sashType) setSashType("عادي");
      if (piece === "cap" && !capType) setCapType("عادي");
    }
    setSelectedPieces((prev) => {
      if (prev.includes(piece)) return prev.filter((p) => p !== piece);
      return [...prev, piece];
    });
  }

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
    if (!hasAnyPiece) return;
    // Every field is optional — the rep/student can save now and complete later. The only
    // guard left is waiting for an in-flight image upload so it isn't lost on submit.
    if (shawlUploading || Object.values(zones).some((z) => z.uploading))
      return toast.error("يرجى الانتظار حتى انتهاء رفع الصور");

    const zone = (z: ZoneState) => ({
      text: z.text.trim() || undefined,
      image_url: z.imageUrl || undefined,
    });
    onSubmit({
      selected_pieces: selectedPieces,
      measurements: {
        robe_length_cm: selectedRobe ? robeLen : "",
        sleeve_length_cm: selectedRobe ? sleeveLen : "",
        shoulder_cm: selectedRobe ? shoulder : "",
        chest_cm: selectedRobe ? chest : "",
        tailor_notes: selectedRobe ? tailorNotes.trim() || undefined : undefined,
      },
      sash_type: selectedSash ? sashType || "عادي" : undefined,
      cap_type: selectedCap ? capType || "عادي" : undefined,
      shoulder_pleat: selectedRobe ? shoulderPleat : false,
      american_shawl: {
        enabled: selectedSash && shawlEnabled,
        image_url: selectedSash && shawlEnabled ? shawlImage : undefined,
        notes: selectedSash && shawlEnabled ? shawlNote.trim() || undefined : undefined,
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
  const zoneHasContent = (z: ZoneState) => !!(z.text.trim() || z.imageUrl);
  const capEmbCount = selectedCap
    ? (zoneHasContent(zones.capSide) ? 1 : 0) + (zoneHasContent(zones.capTop) ? 1 : 0)
    : 0;
  const robeSleeveCount = selectedRobe
    ?
    (zoneHasContent(zones.robeSleeveRight) ? 1 : 0) +
      (zoneHasContent(zones.robeSleeveLeft) ? 1 : 0)
    : 0;
  const baseRows: { label: string; amount: number }[] = [];
  if (isFullPackage) {
    baseRows.push({
      label: "الطقم الكامل",
      amount: pricing?.base && pricing.base > 0 ? pricing.base : DEFAULT_PACKAGE_PRICE,
    });
  } else {
  if (selectedSash)
    baseRows.push({
      label: `وشاح ${sashType || "عادي"}`,
      amount:
        (sashType || "عادي") === "ملكي"
          ? addons.piece_sash_royal
          : addons.piece_sash_normal,
    });
  if (selectedCap)
    baseRows.push({
      label: `قبعة ${capType || "عادي"}`,
      amount:
        (capType || "عادي") === "ملكي"
          ? addons.piece_cap_royal
          : addons.piece_cap_normal,
    });
  if (selectedRobe)
    baseRows.push({
      label: "روب",
      amount:
        sashType === "ملكي" || capType === "ملكي"
          ? addons.piece_robe_royal
          : addons.piece_robe_normal,
    });
  }
  const basePrice = baseRows.reduce((s, r) => s + r.amount, 0);
  const addonRows: { label: string; amount: number }[] = [];
  if (isFullPackage && sashType === "ملكي" && addons.royal_sash > 0)
    addonRows.push({ label: "وشاح ملكي", amount: addons.royal_sash });
  if (
    isFullPackage &&
    sashType === "عادي" &&
    capType === "ملكي" &&
    addons.royal_cap_when_normal_sash > 0
  )
    addonRows.push({ label: "قبعة ملكية", amount: addons.royal_cap_when_normal_sash });
  if (capEmbCount >= 2 && addons.extra_cap_embroidery > 0)
    addonRows.push({ label: "تطريز قبعة ثانٍ", amount: addons.extra_cap_embroidery });
  if (robeSleeveCount > 0 && addons.robe_sleeve_each > 0)
    addonRows.push({
      label: `تطريز ردن الروب ×${robeSleeveCount}`,
      amount: addons.robe_sleeve_each * robeSleeveCount,
    });
  if (selectedSash && shawlEnabled && addons.american_shawl > 0)
    addonRows.push({ label: "شال امريكي", amount: addons.american_shawl });
  const addonTotal = addonRows.reduce((s, r) => s + r.amount, 0);
  const totalPrice = basePrice + addonTotal;

  return (
    <form onSubmit={handleSubmit} className="space-y-5 pb-28">
      <Section title="القطع المطلوبة">
        <div className="grid grid-cols-3 gap-2">
          <PieceToggle label="وشاح" selected={selectedSash} onClick={() => togglePiece("sash")} />
          <PieceToggle label="قبعة" selected={selectedCap} onClick={() => togglePiece("cap")} />
          <PieceToggle label="روب" selected={selectedRobe} onClick={() => togglePiece("robe")} />
        </div>
        {!hasAnyPiece && (
          <p id="piece-picker-hint" className="text-xs font-medium text-ink-soft">
            اختر قطعة واحدة على الأقل لتظهر تفاصيلها وسعرها.
          </p>
        )}
      </Section>

      {/* ── قياسات الروب ── */}
      {selectedRobe && (
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
      )}

      {/* ── النوع ── */}
      {(selectedSash || selectedCap) && (
      <Section title="النوع">
        <div className="space-y-3">
          {selectedSash && <TypeToggle label="نوع الوشاح" value={sashType || "عادي"} onChange={setSashType} />}
          {selectedCap && <TypeToggle label="نوع القبعة" value={capType || "عادي"} onChange={setCapType} />}
        </div>
      </Section>
      )}

      {/* ── شال امريكي ── */}
      {selectedSash && (
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
          {shawlEnabled && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-ink">
                ملاحظات{" "}
                <span className="text-xs font-normal text-ink-soft">(اختياري)</span>
              </p>
              <textarea
                value={shawlNote}
                onChange={(e) => setShawlNote(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="أي تفاصيل عن الشال الأمريكي…"
                className="min-h-11 w-full rounded-xl border border-line bg-beige px-3.5 py-2.5 text-ink shadow-[var(--shadow-soft)] outline-none transition-colors duration-200 placeholder:text-ink/55 hover:border-ink/30 focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
              />
            </div>
          )}
        </div>
      </Section>
      )}

      {/* ── التطريز ── */}
      {hasAnyPiece && (
      <Section title="التطريز" hint="اكتب الاسم المراد تطريزه — صورة اختيارية">
        <div className="space-y-3.5">
          {selectedSash && (
            <>
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
            </>
          )}
          {selectedCap && (
            <>
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
            </>
          )}
          {selectedRobe && (
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
          )}
        </div>
      </Section>
      )}

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
        {hasAnyPiece ? (
          <div className="space-y-3">
            <dl className="space-y-2 text-sm">
              {baseRows.map((r) => (
                <div key={r.label} className="flex items-center justify-between">
                  <dt className="text-ink-soft">{r.label}</dt>
                  <dd className="tabular-nums text-ink" dir="ltr">
                    {PRICE_FMT.format(r.amount)} د.ع
                  </dd>
                </div>
              ))}
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
            <Button type="submit" fullWidth size="lg" loading={submitting}>
              {`${submitLabel} — ${PRICE_FMT.format(totalPrice)} د.ع`}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium text-ink-soft">
              اختر قطعة من الأعلى حتى تظهر التسعيرة هنا.
            </p>
            <Button
              type="submit"
              fullWidth
              size="lg"
              loading={submitting}
              disabled
              aria-describedby="piece-picker-hint"
            >
              اختر قطعة لتأكيد الطلب
            </Button>
          </div>
        )}
      </Section>
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

function PieceToggle({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={selected ? "primary" : "ghost"}
      aria-pressed={selected}
      onClick={onClick}
    >
      {label}
    </Button>
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
