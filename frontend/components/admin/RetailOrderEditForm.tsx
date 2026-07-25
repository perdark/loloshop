"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CustomerImageUpload } from "@/components/catalog/CustomerImageUpload";
import { OptionGroupField } from "@/components/catalog/OptionGroupField";
import { PriceBreakdown } from "@/components/catalog/PriceBreakdown";
import { ReceiptUpload } from "@/components/catalog/ReceiptUpload";
import { RobeSleeveSection } from "@/components/catalog/RobeSleeveSection";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { getApiErrorMessage } from "@/lib/api";
import { getProductFull } from "@/lib/catalog";
import {
  customerImageRequired,
  customerTextRequired,
  getSelectedOptionId,
  selectionKey,
  validateCustomerImages,
  validateCustomerTexts,
} from "@/lib/customerImage";
import { ORDER_STATUS_LABELS } from "@/lib/constants";
import { formatIQD } from "@/lib/format";
import { buildConfigureSelections } from "@/lib/orders";
import {
  computePriceBreakdown,
  groupVisibleForGender,
  type OptionSelection,
  validateSelection,
} from "@/lib/pricing";
import { partitionRobeSleeveGroups } from "@/lib/robeSleeve";
import {
  saveRetailOrderConfiguration,
  uploadProductionImage,
  type OrderEditContext,
  type SaveRetailOrderResult,
} from "@/lib/staff";
import type { CatalogProduct, RobeMeasurements, StudyType } from "@/lib/types";

interface StudentDraft {
  name: string;
  instagram: string;
  phonePrimary: string;
  phoneSecondary: string;
  universityName: string;
  department: string;
  studyType: StudyType | "";
}

export function RetailOrderEditForm({
  orderId,
  context,
  student,
  onSaved,
}: {
  orderId: string;
  context: OrderEditContext;
  student: StudentDraft;
  onSaved: (result: SaveRetailOrderResult) => void;
}) {
  const snapshot = context.retail_order;
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<OptionSelection>({});
  const [customerImages, setCustomerImages] = useState<Record<string, string>>({});
  const [customerTexts, setCustomerTexts] = useState<Record<string, string>>({});
  const [measurements, setMeasurements] = useState<RobeMeasurements>({
    shoulder_cm: snapshot?.measurements?.shoulder_cm ?? 0,
    chest_cm: snapshot?.measurements?.chest_cm ?? 0,
    robe_length_cm: snapshot?.measurements?.robe_length_cm ?? 0,
    sleeve_length_cm: snapshot?.measurements?.sleeve_length_cm ?? 0,
    tailor_notes: snapshot?.measurements?.tailor_notes ?? "",
    receipt_image_url: snapshot?.measurements?.receipt_image_url ?? "",
  });
  const [showErrors, setShowErrors] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!snapshot) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    getProductFull(snapshot.product_id, "retail")
      .then((loaded) => {
        if (!alive) return;
        const nextSelection: OptionSelection = {};
        const nextImages: Record<string, string> = {};
        const nextTexts: Record<string, string> = {};
        for (const saved of snapshot.selections) {
          const group = loaded.optionGroups.find((g) => g.id === saved.group_id);
          if (!group) continue;
          if (group.inputType === "single_select") {
            nextSelection[group.id] = saved.option_id;
          } else if (group.inputType === "toggle") {
            nextSelection[group.id] = true;
          } else if (group.inputType === "counter") {
            nextSelection[group.id] = Math.max(
              1,
              Math.round(saved.qty / Math.max(1, snapshot.quantity))
            );
          }
          const key = selectionKey(saved.group_id, saved.option_id);
          if (saved.customer_image_url) nextImages[key] = saved.customer_image_url;
          if (saved.customer_text) nextTexts[key] = saved.customer_text;
        }
        setProduct(loaded);
        setSelection(nextSelection);
        setCustomerImages(nextImages);
        setCustomerTexts(nextTexts);
      })
      .catch(() => {
        if (alive) setLoadError("تعذر تحميل خيارات المنتج الحالية.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [snapshot]);

  function setGroupValue(groupId: string, value: OptionSelection[string]) {
    if (selection[groupId] === value) return;
    setSelection((prev) => ({ ...prev, [groupId]: value }));
    setCustomerImages((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith(`${groupId}:`)))
    );
    setCustomerTexts((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith(`${groupId}:`)))
    );
    setShowErrors(false);
  }

  const unitPreview = useMemo(
    () => (product ? computePriceBreakdown(product, selection, "retail") : { lines: [], total: 0 }),
    [product, selection]
  );
  const quantity = Math.max(1, snapshot?.quantity ?? 1);
  const preview = useMemo(
    () => ({
      lines: unitPreview.lines.map((line) => ({
        ...line,
        label: quantity > 1 ? `${line.label} ×${quantity}` : line.label,
        amount: line.amount * quantity,
      })),
      total: unitPreview.total * quantity,
    }),
    [unitPreview, quantity]
  );
  const priceDifference = preview.total - (snapshot?.price ?? 0);

  const measurementsError = useMemo(() => {
    if (product?.type !== "robe") return null;
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
  }, [measurements, product?.type]);

  function validate(): boolean {
    if (!product) return false;
    const selectionError = validateSelection(product, selection, context.student.gender);
    const imageError = validateCustomerImages(product, selection, customerImages);
    const textError = validateCustomerTexts(product, selection, customerTexts);
    const error = selectionError || imageError || textError || measurementsError;
    if (error) {
      setShowErrors(true);
      toast.error(error);
      return false;
    }
    return true;
  }

  async function save() {
    if (!product || !snapshot || !validate()) return;
    setSubmitting(true);
    try {
      const result = await saveRetailOrderConfiguration(orderId, {
        selections: buildConfigureSelections(product, selection, customerImages, customerTexts),
        ...(product.type === "robe" ? { measurements } : {}),
        student: {
          name: student.name.trim(),
          instagram_username: student.instagram.trim(),
          university_name: student.universityName.trim(),
          department: student.department.trim(),
          study_type: student.studyType,
        },
        group: {
          phone_primary: student.phonePrimary.trim(),
          phone_secondary: student.phoneSecondary.trim(),
        },
      });
      setConfirmOpen(false);
      toast.success("تم حفظ تعديلات الطلب");
      onSaved(result);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "تعذر حفظ تعديلات الطلب"));
    } finally {
      setSubmitting(false);
    }
  }

  if (!snapshot) {
    return <EmptyState title="لا يمكن تعديل القطعة" message="بيانات طلب التجزئة غير متاحة." />;
  }
  if (loading) {
    return (
      <div className="space-y-3" aria-label="جارٍ تحميل خيارات الطلب">
        <div className="skeleton h-28 rounded-2xl" />
        <div className="skeleton h-40 rounded-2xl" />
        <div className="skeleton h-24 rounded-2xl" />
      </div>
    );
  }
  if (loadError || !product) {
    return <EmptyState title="تعذر تحميل الخيارات" message={loadError ?? "حاول مرة أخرى."} />;
  }

  const groups = product.optionGroups
    .filter((group) => groupVisibleForGender(group, context.student.gender))
    .sort((a, b) => a.sort - b.sort);
  const { sleeveGroups, otherGroups } =
    product.type === "robe"
      ? partitionRobeSleeveGroups(groups)
      : { sleeveGroups: [], otherGroups: groups };

  return (
    <div className="space-y-5">
      <section id="options" className="space-y-4 scroll-mt-24">
        <div>
          <h2 className="text-base font-bold text-ink">خيارات {snapshot.product_name}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            غيّر الشكل أو النوع أو الإضافات؛ السعر أدناه يتحدث مباشرة.
          </p>
        </div>

        {otherGroups.map((group) => {
          const optionId = getSelectedOptionId(group, selection);
          const needsImage = customerImageRequired(group, optionId);
          const needsText = customerTextRequired(group, optionId);
          const isSashEmbroidery =
            product.type === "sash" && group.nameAr.startsWith("تطريز");
          const isSashThread =
            product.type === "sash" && group.nameAr === "لون التطريز";
          const isCapEmbroidery =
            product.type === "cap" &&
            (group.nameAr === "القبعة من الجانب" || group.nameAr === "القبعة من الأعلى");
          const isShawl = product.type === "shawl" && group.nameAr === "صورة الشال";
          const showDetails =
            !!optionId &&
            (needsImage || needsText || isSashEmbroidery || isSashThread || isCapEmbroidery || isShawl);
          const key = optionId ? selectionKey(group.id, optionId) : null;
          return (
            <div key={group.id}>
              <OptionGroupField
                group={group}
                selection={selection}
                role="retail"
                lockedOptionId={group.lockedOptionId}
                onChange={setGroupValue}
              />
              {showDetails && optionId && key && (
                <CustomerImageUpload
                  group={group}
                  optionId={optionId}
                  value={customerImages[key]}
                  onChange={(url) => setCustomerImages((prev) => ({ ...prev, [key]: url }))}
                  textValue={customerTexts[key]}
                  onTextChange={(text) => setCustomerTexts((prev) => ({ ...prev, [key]: text }))}
                  allowOptionalText={isShawl || ((isSashEmbroidery || isSashThread) && !needsText)}
                  allowOptionalImage={isShawl || isSashEmbroidery || isCapEmbroidery}
                  showErrors={showErrors}
                  uploadImage={uploadProductionImage}
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
            onToggle={(groupId, checked) => setGroupValue(groupId, checked)}
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
            uploadImage={uploadProductionImage}
          />
        )}
      </section>

      {product.type === "robe" && (
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
          {showErrors && measurementsError && (
            <p role="alert" className="mt-2 text-xs font-semibold text-danger">
              {measurementsError}
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
            onChange={(url) =>
              setMeasurements((prev) => ({ ...prev, receipt_image_url: url }))
            }
            uploadImage={uploadProductionImage}
          />
        </fieldset>
      )}

      <PriceBreakdown lines={preview.lines} total={preview.total} compact />

      <section className="rounded-2xl border border-orange-ink/20 bg-orange-ink/5 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <PriceMetric label="السعر الحالي" value={snapshot.price} />
          <PriceMetric label="السعر بعد التعديل" value={preview.total} accent />
          <PriceMetric
            label="الفرق"
            value={priceDifference}
            signed
          />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-soft">
          حالة الإنتاج الحالية:{" "}
          <strong className="text-ink">{ORDER_STATUS_LABELS[snapshot.status]}</strong>.
          الحفظ متاح في هذه المرحلة، وسيُسجّل التعديل باسم المستخدم.
        </p>
      </section>

      <Button
        fullWidth
        onClick={() => {
          if (validate()) setConfirmOpen(true);
        }}
      >
        مراجعة وحفظ التعديلات
      </Button>

      <Modal
        open={confirmOpen}
        onClose={() => !submitting && setConfirmOpen(false)}
        title="تأكيد تعديل الطلب"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              رجوع
            </Button>
            <Button onClick={save} loading={submitting}>
              حفظ التعديلات
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-ink-soft">
          <p>
            سيتغير السعر من <strong className="text-ink">{formatIQD(snapshot.price)}</strong>{" "}
            إلى <strong className="text-orange-ink">{formatIQD(preview.total)}</strong>.
          </p>
          <p>
            الطلب في مرحلة <strong className="text-ink">{ORDER_STATUS_LABELS[snapshot.status]}</strong>.
            إذا أضاف التعديل عمل تصميم/تطريز جديدًا، سيعود الطلب تلقائيًا إلى بانتظار التصميم.
          </p>
          {product.type === "robe" && snapshot.tailor_status === "done" && (
            <p>إذا تغيرت القياسات، سيُعاد فتح مهمة الفصال حتى لا تُنفذ المقاسات القديمة.</p>
          )}
        </div>
      </Modal>
    </div>
  );
}

function PriceMetric({
  label,
  value,
  accent = false,
  signed = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
  signed?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-ink-soft">{label}</p>
      <p
        dir="ltr"
        className={`mt-1 text-base font-bold tabular-nums ${accent ? "text-orange-ink" : "text-ink"}`}
      >
        {signed && value > 0 ? "+" : ""}
        {formatIQD(value)}
      </p>
    </div>
  );
}
