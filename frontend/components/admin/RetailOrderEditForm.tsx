"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PriceBreakdown } from "@/components/catalog/PriceBreakdown";
import {
  RetailPieceOptions,
  RobeMeasurementFields,
  robeMeasurementsError,
} from "@/components/admin/RetailPieceFields";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { getApiErrorMessage } from "@/lib/api";
import { getProductFull } from "@/lib/catalog";
import {
  selectionKey,
  validateCustomerImages,
  validateCustomerTexts,
} from "@/lib/customerImage";
import { ORDER_STATUS_LABELS } from "@/lib/constants";
import { formatIQD } from "@/lib/format";
import { buildConfigureSelections } from "@/lib/orders";
import {
  computePriceBreakdown,
  type OptionSelection,
  validateSelection,
} from "@/lib/pricing";
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
  // The product the piece will BECOME. Only same-family siblings are offered, and the server
  // re-validates the id, so this is a convenience — never the authority.
  const [targetProductId, setTargetProductId] = useState(snapshot?.product_id ?? "");
  const [swapping, setSwapping] = useState(false);
  const [keepPrice, setKeepPrice] = useState(false);
  const [forceRework, setForceRework] = useState(false);
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
  const initialised = useRef(false);

  useEffect(() => {
    if (!snapshot || !targetProductId) return;
    let alive = true;
    // First load fills the form from the saved order. A later run is a product SWAP: the
    // admin's in-progress edits must survive it, so only the priced product is replaced.
    const first = !initialised.current;
    if (first) setLoading(true);
    else setSwapping(true);
    setLoadError(null);
    getProductFull(targetProductId, "retail")
      .then((loaded) => {
        if (!alive) return;
        setProduct(loaded);
        if (!first) {
          // Same-family siblings share their option groups (groups live on the parent), so
          // nothing should drop — prune anyway so a stale group can never reach the server.
          const live = new Set(loaded.optionGroups.map((g) => g.id));
          setSelection((prev) =>
            Object.fromEntries(Object.entries(prev).filter(([groupId]) => live.has(groupId)))
          );
          return;
        }
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
        setSelection(nextSelection);
        setCustomerImages(nextImages);
        setCustomerTexts(nextTexts);
        initialised.current = true;
      })
      .catch(() => {
        if (!alive) return;
        if (first) setLoadError("تعذر تحميل خيارات المنتج الحالية.");
        else {
          toast.error("تعذر تحميل المنتج المطلوب — بقي المنتج السابق.");
          setTargetProductId(snapshot.product_id);
        }
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
        setSwapping(false);
      });
    return () => {
      alive = false;
    };
  }, [snapshot, targetProductId]);

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
  const oldPrice = snapshot?.price ?? 0;
  const productChanged = !!snapshot && targetProductId !== snapshot.product_id;
  // What will actually be written. «تثبيت السعر» keeps the agreed price even though the
  // recomputed one is still shown, so the admin always sees both numbers.
  const appliedTotal = keepPrice ? oldPrice : preview.total;
  const priceDifference = preview.total - oldPrice;

  const measurementsError = useMemo(
    () => (product?.type === "robe" ? robeMeasurementsError(measurements) : null),
    [measurements, product?.type]
  );

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
        ...(productChanged ? { product_id: targetProductId } : {}),
        ...(keepPrice ? { keep_price: true } : {}),
        ...(forceRework ? { force_design_rework: true } : {}),
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

  return (
    <div className="space-y-5">
      {snapshot.swap_candidates.length > 0 && (
        <section id="product" className="scroll-mt-24 rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-base font-bold text-ink">نوع القطعة</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            يمكن تبديل القطعة إلى نوع آخر من نفس العائلة. كل ما هو محفوظ — الألوان، نصوص
            التطريز، الصور — ينتقل كما هو، ويتغيّر السعر الأساسي فقط.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {[
              {
                id: snapshot.product_id,
                name_ar: snapshot.product_name,
                image_url: null,
                retail_price: null as number | null,
              },
              ...snapshot.swap_candidates,
            ].map((option) => {
              const active = option.id === targetProductId;
              const isCurrent = option.id === snapshot.product_id;
              return (
                <label
                  key={option.id}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${
                    active
                      ? "border-orange-ink bg-orange-ink/5"
                      : "border-line bg-white hover:border-orange-ink/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="retail-edit-product"
                    className="size-4 accent-[var(--color-orange-ink)]"
                    checked={active}
                    disabled={swapping}
                    onChange={() => {
                      if (option.id === targetProductId) return;
                      setTargetProductId(option.id);
                      setShowErrors(false);
                    }}
                  />
                  {option.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={option.image_url}
                      alt=""
                      className="size-11 shrink-0 rounded-lg object-cover"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {option.name_ar}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-soft">
                      {isCurrent ? (
                        "النوع الحالي"
                      ) : (
                        <span dir="ltr" className="tabular-nums">
                          {formatIQD(option.retail_price ?? 0)}
                        </span>
                      )}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {swapping && (
            <p className="mt-3 text-xs font-semibold text-ink-soft" role="status">
              جارٍ تحديث الخيارات والسعر…
            </p>
          )}
          {productChanged && !swapping && (
            <p className="mt-3 rounded-xl bg-orange-ink/5 px-3 py-2 text-xs leading-relaxed text-ink">
              سيتحوّل الطلب إلى <strong>{product.nameAr}</strong>. راجع السعر في الأسفل قبل
              الحفظ — يمكنك تثبيت السعر الحالي إذا كان متّفقًا عليه مع الطالب.
            </p>
          )}
        </section>
      )}

      <section id="options" className="space-y-4 scroll-mt-24">
        <div>
          <h2 className="text-base font-bold text-ink">خيارات {product.nameAr}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            غيّر الشكل أو النوع أو الإضافات؛ السعر أدناه يتحدث مباشرة.
          </p>
        </div>

        <RetailPieceOptions
          product={product}
          gender={context.student.gender}
          selection={selection}
          onGroupChange={setGroupValue}
          customerImages={customerImages}
          customerTexts={customerTexts}
          setCustomerImages={setCustomerImages}
          setCustomerTexts={setCustomerTexts}
          showErrors={showErrors}
          uploadImage={uploadProductionImage}
        />
      </section>

      {product.type === "robe" && (
        <RobeMeasurementFields
          measurements={measurements}
          setMeasurements={setMeasurements}
          showErrors={showErrors}
          error={measurementsError}
          uploadImage={uploadProductionImage}
        />
      )}

      <PriceBreakdown lines={preview.lines} total={preview.total} compact />

      <section className="rounded-2xl border border-orange-ink/20 bg-orange-ink/5 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <PriceMetric label="السعر الحالي" value={snapshot.price} />
          <PriceMetric
            label={keepPrice ? "السعر المحسوب (لن يُطبَّق)" : "السعر بعد التعديل"}
            value={preview.total}
            accent={!keepPrice}
            muted={keepPrice}
          />
          <PriceMetric
            label={keepPrice ? "السعر الذي سيُحفظ" : "الفرق"}
            value={keepPrice ? appliedTotal : priceDifference}
            signed={!keepPrice}
            accent={keepPrice}
          />
        </div>

        {priceDifference !== 0 && (
          <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-2.5 rounded-xl bg-white/70 p-3">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--color-orange-ink)]"
              checked={keepPrice}
              onChange={(event) => setKeepPrice(event.target.checked)}
            />
            <span className="text-xs leading-relaxed text-ink">
              <strong className="block text-sm">تثبيت السعر الحالي</strong>
              احفظ التعديل دون تغيير السعر — للحالات التي اتُّفق فيها على السعر مع الطالب
              مسبقًا. الكلفة المسجّلة لا تتغيّر في الحالتين.
            </span>
          </label>
        )}

        {/* Only for a piece that HAS design work. A plain piece pushed to «بانتظار التصميم»
            is invisible to the designer queues (they filter on has_embroidery) — it would
            just fall out of the pipeline. Adding embroidery in this same edit is covered by
            the automatic rework rule instead. */}
        {snapshot.can_force_rework && snapshot.has_embroidery && (
          <label className="mt-2 flex min-h-11 cursor-pointer items-start gap-2.5 rounded-xl bg-white/70 p-3">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--color-orange-ink)]"
              checked={forceRework}
              onChange={(event) => setForceRework(event.target.checked)}
            />
            <span className="text-xs leading-relaxed text-ink">
              <strong className="block text-sm">أرجع الطلب إلى «بانتظار التصميم»</strong>
              يمسح مناطق التطريز المنجزة وملف التصميم النهائي ويُفرغ خانة الرف، ليعاد العمل
              من البداية. اتركه فارغًا إذا كان التعديل لا يستدعي إعادة تصميم.
            </span>
          </label>
        )}

        <p className="mt-3 text-xs leading-relaxed text-ink-soft">
          حالة الإنتاج الحالية:{" "}
          <strong className="text-ink">{ORDER_STATUS_LABELS[snapshot.status]}</strong>.
          الحفظ متاح في هذه المرحلة، وسيُسجّل التعديل باسم المستخدم.
        </p>
      </section>

      <Button
        fullWidth
        disabled={swapping}
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
          {productChanged && (
            <p>
              سيتحوّل نوع القطعة من{" "}
              <strong className="text-ink">{snapshot.product_name}</strong> إلى{" "}
              <strong className="text-orange-ink">{product.nameAr}</strong> مع نقل كل
              الخيارات المحفوظة كما هي.
            </p>
          )}
          {keepPrice ? (
            <p>
              سيبقى السعر <strong className="text-ink">{formatIQD(snapshot.price)}</strong> كما
              هو (السعر المحسوب {formatIQD(preview.total)} لن يُطبَّق).
            </p>
          ) : (
            <p>
              سيتغير السعر من <strong className="text-ink">{formatIQD(snapshot.price)}</strong>{" "}
              إلى <strong className="text-orange-ink">{formatIQD(preview.total)}</strong>.
            </p>
          )}
          <p>
            الطلب في مرحلة <strong className="text-ink">{ORDER_STATUS_LABELS[snapshot.status]}</strong>.
            {forceRework
              ? " سيعود إلى «بانتظار التصميم» وتُمسح مناطق التطريز المنجزة."
              : " إذا أضاف التعديل عمل تصميم/تطريز جديدًا، سيعود الطلب تلقائيًا إلى بانتظار التصميم."}
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
  muted = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
  signed?: boolean;
  /** The number is still true, but it is not what will be saved — say so visually. */
  muted?: boolean;
}) {
  const tone = muted ? "text-ink-soft line-through" : accent ? "text-orange-ink" : "text-ink";
  return (
    <div>
      <p className="text-xs text-ink-soft">{label}</p>
      <p dir="ltr" className={`mt-1 text-base font-bold tabular-nums ${tone}`}>
        {signed && value > 0 ? "+" : ""}
        {formatIQD(value)}
      </p>
    </div>
  );
}
