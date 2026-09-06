"use client";

import type { Dispatch, SetStateAction } from "react";
import { CustomerImageUpload } from "@/components/catalog/CustomerImageUpload";
import { OptionGroupField } from "@/components/catalog/OptionGroupField";
import { ReceiptUpload } from "@/components/catalog/ReceiptUpload";
import { RobeSleeveSection } from "@/components/catalog/RobeSleeveSection";
import {
  customerImageRequired,
  customerTextRequired,
  getSelectedOptionId,
  selectionKey,
} from "@/lib/customerImage";
import { groupVisibleForGender, type OptionSelection } from "@/lib/pricing";
import { partitionRobeSleeveGroups } from "@/lib/robeSleeve";
import type { CatalogProduct, RobeMeasurements } from "@/lib/types";

// The option/measurement fields for ONE retail piece, shared by the two staff surfaces that
// configure one: editing an existing piece (RetailOrderEditForm) and creating a «طلب مخصص»
// for a تجزئة student (RetailSingleOrderForm). Both post to endpoints that price with the
// same server-side `priceSelections(role:'retail')`, so the two forms must offer exactly the
// same fields — keeping one copy is what guarantees that.

export function robeMeasurementsError(measurements: RobeMeasurements): string | null {
  if (
    measurements.shoulder_cm <= 0 ||
    measurements.robe_length_cm <= 0 ||
    measurements.sleeve_length_cm <= 0
  ) {
    return "يرجى إدخال مقاسات الروب المطلوبة";
  }
  const chest = measurements.chest_cm ?? 0;
  return chest > 0 && (chest < 60 || chest > 180)
    ? "محيط الصدر يجب أن يكون بين ٦٠ و١٨٠ سم"
    : null;
}

export const emptyRobeMeasurements = (): RobeMeasurements => ({
  shoulder_cm: 0,
  chest_cm: 0,
  robe_length_cm: 0,
  sleeve_length_cm: 0,
  tailor_notes: "",
  receipt_image_url: "",
});

export function RetailPieceOptions({
  product,
  gender,
  selection,
  onGroupChange,
  customerImages,
  customerTexts,
  setCustomerImages,
  setCustomerTexts,
  showErrors,
  uploadImage,
}: {
  product: CatalogProduct;
  gender: "male" | "female";
  selection: OptionSelection;
  onGroupChange: (groupId: string, value: OptionSelection[string]) => void;
  customerImages: Record<string, string>;
  customerTexts: Record<string, string>;
  setCustomerImages: Dispatch<SetStateAction<Record<string, string>>>;
  setCustomerTexts: Dispatch<SetStateAction<Record<string, string>>>;
  showErrors: boolean;
  uploadImage: (file: File) => Promise<string>;
}) {
  const groups = product.optionGroups
    .filter((group) => groupVisibleForGender(group, gender))
    .sort((a, b) => a.sort - b.sort);
  const { sleeveGroups, otherGroups } =
    product.type === "robe"
      ? partitionRobeSleeveGroups(groups)
      : { sleeveGroups: [], otherGroups: groups };

  return (
    <>
      {otherGroups.map((group) => {
        const optionId = getSelectedOptionId(group, selection);
        const needsImage = customerImageRequired(group, optionId);
        const needsText = customerTextRequired(group, optionId);
        const isSashEmbroidery = product.type === "sash" && group.nameAr.startsWith("تطريز");
        const isSashThread = product.type === "sash" && group.nameAr === "لون التطريز";
        const isCapEmbroidery =
          product.type === "cap" &&
          (group.nameAr === "القبعة من الجانب" || group.nameAr === "القبعة من الأعلى");
        const isShawl = product.type === "shawl" && group.nameAr === "صورة الشال";
        // «ملاحظة» (103) — optional free text on قبعة/وشاح. Migration 107 made the text itself
        // optional (`requires_customer_text = FALSE`), so `needsText` no longer renders it and
        // this flag has to. The student's configurator does the same; a privileged editor that
        // could not see the note would silently drop it on every save.
        const isNote =
          (product.type === "cap" || product.type === "sash") && group.nameAr === "ملاحظة";
        const showDetails =
          !!optionId &&
          (needsImage || needsText || isSashEmbroidery || isSashThread || isCapEmbroidery ||
            isShawl || isNote);
        const key = optionId ? selectionKey(group.id, optionId) : null;
        return (
          <div key={group.id}>
            <OptionGroupField
              group={group}
              selection={selection}
              role="retail"
              lockedOptionId={group.lockedOptionId}
              onChange={onGroupChange}
            />
            {showDetails && optionId && key && (
              <CustomerImageUpload
                group={group}
                optionId={optionId}
                value={customerImages[key]}
                onChange={(url) => setCustomerImages((prev) => ({ ...prev, [key]: url }))}
                textValue={customerTexts[key]}
                onTextChange={(text) => setCustomerTexts((prev) => ({ ...prev, [key]: text }))}
                allowOptionalText={isShawl || isNote || ((isSashEmbroidery || isSashThread) && !needsText)}
                allowOptionalImage={isShawl || isSashEmbroidery || isCapEmbroidery}
                showErrors={showErrors}
                uploadImage={uploadImage}
              />
            )}
          </div>
        );
      })}

      {sleeveGroups.length > 0 && (
        <RobeSleeveSection
          groups={sleeveGroups}
          role="retail"
          selection={selection}
          customerTexts={customerTexts}
          customerImages={customerImages}
          onToggle={(groupId, checked) => onGroupChange(groupId, checked)}
          onTextChange={(groupId, optionId, text) => {
            const key = selectionKey(groupId, optionId);
            setCustomerTexts((prev) => ({ ...prev, [key]: text }));
          }}
          onImageChange={(groupId, optionId, url) => {
            const key = selectionKey(groupId, optionId);
            setCustomerImages((prev) => ({ ...prev, [key]: url }));
          }}
          fieldKey={selectionKey}
          showErrors={showErrors}
          uploadImage={uploadImage}
        />
      )}
    </>
  );
}

export function RobeMeasurementFields({
  measurements,
  setMeasurements,
  showErrors,
  error,
  uploadImage,
}: {
  measurements: RobeMeasurements;
  setMeasurements: Dispatch<SetStateAction<RobeMeasurements>>;
  showErrors: boolean;
  error: string | null;
  uploadImage: (file: File) => Promise<string>;
}) {
  return (
    <fieldset
      id="measurements"
      className="scroll-mt-24 rounded-2xl border border-line bg-surface p-4"
    >
      <legend className="px-1 text-sm font-bold text-ink">
        قياسات الروب <span className="text-orange-ink">*</span>
      </legend>
      <p className="mt-1 text-xs text-ink-soft">كل القياسات بالسنتيمتر.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {([
          ["shoulder_cm", "عرض الكتف", false],
          ["chest_cm", "محيط الصدر", true],
          ["robe_length_cm", "طول الروب", false],
          ["sleeve_length_cm", "طول الردن", false],
        ] as const).map(([key, label, optional]) => (
          <label key={key} className="text-sm font-semibold text-ink">
            {label}
            {optional && <span className="ms-1 text-xs font-normal text-ink-soft">(اختياري)</span>}
            <span className="relative mt-1.5 block">
              <input
                type="number"
                inputMode="decimal"
                min={1}
                max={300}
                value={measurements[key] || ""}
                onChange={(event) =>
                  setMeasurements((prev) => ({
                    ...prev,
                    [key]: Number(event.target.value) || 0,
                  }))
                }
                className="min-h-11 w-full rounded-xl border border-line bg-white px-3 py-2 pe-12 text-sm text-ink outline-none focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
              />
              <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-ink-soft">
                سم
              </span>
            </span>
          </label>
        ))}
      </div>
      {showErrors && error && (
        <p role="alert" className="mt-2 text-xs font-semibold text-danger">
          {error}
        </p>
      )}
      <label className="mt-4 block text-sm font-semibold text-ink">
        ملاحظات الفصال <span className="text-xs font-normal text-ink-soft">(اختياري)</span>
        <textarea
          rows={3}
          maxLength={500}
          value={measurements.tailor_notes ?? ""}
          onChange={(event) =>
            setMeasurements((prev) => ({ ...prev, tailor_notes: event.target.value }))
          }
          className="mt-1.5 w-full resize-none rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
        />
      </label>
      <ReceiptUpload
        value={measurements.receipt_image_url}
        onChange={(url) => setMeasurements((prev) => ({ ...prev, receipt_image_url: url }))}
        uploadImage={uploadImage}
      />
    </fieldset>
  );
}
