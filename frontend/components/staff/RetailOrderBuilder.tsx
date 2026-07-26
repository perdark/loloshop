"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PriceBreakdown } from "@/components/catalog/PriceBreakdown";
import {
  RetailPieceOptions,
  RobeMeasurementFields,
  emptyRobeMeasurements,
  robeMeasurementsError,
} from "@/components/admin/RetailPieceFields";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { getApiErrorMessage } from "@/lib/api";
import { getProductFull, getShopFeed } from "@/lib/catalog";
import { validateCustomerImages, validateCustomerTexts } from "@/lib/customerImage";
import { formatIQD } from "@/lib/format";
import { buildConfigureSelections } from "@/lib/orders";
import { computePriceBreakdown, type OptionSelection, validateSelection } from "@/lib/pricing";
import {
  createRetailOrders,
  uploadProductionImage,
  type CreatedRetailOrder,
  type NewRetailStudentPayload,
} from "@/lib/staff";
import type {
  CatalogProduct,
  ProductType,
  RobeMeasurements,
  ShopProductCard,
} from "@/lib/types";

const TYPE_LABELS: Record<ProductType, string> = {
  sash: "أوشحة",
  cap: "قبعات",
  robe: "روبات",
  shawl: "شالات",
};
const TYPE_ORDER: ProductType[] = ["sash", "cap", "robe", "shawl"];

interface Piece {
  key: string;
  productId: string;
  product: CatalogProduct | null;
  loading: boolean;
  selection: OptionSelection;
  customerImages: Record<string, string>;
  customerTexts: Record<string, string>;
  measurements: RobeMeasurements;
}

const newPiece = (productId: string): Piece => ({
  key: `${productId}-${Math.random().toString(36).slice(2, 8)}`,
  productId,
  product: null,
  loading: true,
  selection: {},
  customerImages: {},
  customerTexts: {},
  measurements: emptyRobeMeasurements(),
});

/**
 * «طلب مخصص» priced at the retail book — the same catalog, options and prices a student
 * gets on the storefront, driven by staff. One order can hold several pieces; they all
 * land in ONE bundle.
 *
 * Two shapes, one component:
 *  · `student` given   → an existing تجزئة student (the طقم endpoints 403 for them);
 *  · `student` omitted → «طلب مستقل بدون ممثل», where the student is created here. Name,
 *    phone and gender are required — the phone is what makes them a تجزئة student the
 *    RETAIL edit path owns for life (a name-only student would fall back into the طقم
 *    editor, which re-prices rep-style), and gender decides which option groups exist.
 */
export function RetailOrderBuilder({
  student,
  onCreated,
}: {
  student?: { id: string; name: string; phone: string | null; gender: "male" | "female" };
  onCreated: (result: { studentId: string; orders: CreatedRetailOrder[]; total: number }) => void;
}) {
  const creatingStudent = !student;

  const [catalog, setCatalog] = useState<Partial<Record<ProductType, ShopProductCard[]>> | null>(
    null
  );
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // New-student fields (unused when an existing student was picked).
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState<"" | "male" | "female">("");
  const [instagram, setInstagram] = useState("");
  const [university, setUniversity] = useState("");
  const [department, setDepartment] = useState("");
  const [studyType, setStudyType] = useState<"" | "morning" | "evening">("");

  const [pieces, setPieces] = useState<Piece[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [phonePrimary, setPhonePrimary] = useState(student?.phone || "");
  const [phoneSecondary, setPhoneSecondary] = useState("");
  const [governorate, setGovernorate] = useState("");
  const [areaDetails, setAreaDetails] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [notes, setNotes] = useState("");

  // The gender the options are rendered against — the student's, or the one being entered.
  const effectiveGender: "" | "male" | "female" = student ? student.gender : gender;

  useEffect(() => {
    let alive = true;
    getShopFeed()
      .then((feed) => alive && setCatalog(feed.byType))
      .catch(() => alive && setCatalogError("تعذر تحميل قائمة المنتجات."));
    return () => {
      alive = false;
    };
  }, []);

  const patchPiece = useCallback((key: string, patch: Partial<Piece>) => {
    setPieces((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }, []);

  function addPiece(productId: string) {
    const piece = newPiece(productId);
    setPieces((prev) => [...prev, piece]);
    setOpenKey(piece.key);
    setPickerOpen(false);
    setShowErrors(false);

    getProductFull(productId, "retail")
      .then((loaded) => patchPiece(piece.key, { product: loaded, loading: false }))
      .catch(() => {
        toast.error("تعذر تحميل خيارات المنتج");
        setPieces((prev) => prev.filter((p) => p.key !== piece.key));
      });
  }

  function removePiece(key: string) {
    setPieces((prev) => prev.filter((p) => p.key !== key));
    setOpenKey((prev) => (prev === key ? null : prev));
  }

  // Changing a group clears the photo/text captured under the option that is going away.
  function setGroupValue(key: string, groupId: string, value: OptionSelection[string]) {
    setPieces((prev) =>
      prev.map((p) => {
        if (p.key !== key || p.selection[groupId] === value) return p;
        const strip = (map: Record<string, string>) =>
          Object.fromEntries(Object.entries(map).filter(([k]) => !k.startsWith(`${groupId}:`)));
        return {
          ...p,
          selection: { ...p.selection, [groupId]: value },
          customerImages: strip(p.customerImages),
          customerTexts: strip(p.customerTexts),
        };
      })
    );
    setShowErrors(false);
  }

  const priced = useMemo(
    () =>
      pieces.map((p) => ({
        key: p.key,
        name: p.product?.nameAr ?? "…",
        ...(p.product
          ? computePriceBreakdown(p.product, p.selection, "retail")
          : { lines: [], total: 0 }),
      })),
    [pieces]
  );
  const total = priced.reduce((sum, p) => sum + p.total, 0);
  // Products already in this order can't be added twice — the server refuses it, and the
  // (student, product) unique index is why.
  const usedProductIds = new Set(pieces.map((p) => p.productId));

  /** First problem found, or null. Piece errors name the piece so the toast is actionable. */
  function firstError(): string | null {
    if (creatingStudent) {
      if (!name.trim()) return "اسم الطالب مطلوب";
      if (!/^07\d{9}$/.test(phone.replace(/\D/g, ""))) {
        return "رقم الهاتف مطلوب ويجب أن يبدأ بـ 07 ويتكوّن من 11 رقماً";
      }
      if (!gender) return "اختر جنس الطالب — الخيارات المعروضة تعتمد عليه";
    }
    if (!pieces.length) return "أضف قطعة واحدة على الأقل";
    for (const p of pieces) {
      if (!p.product) return "انتظر تحميل خيارات القطعة";
      const label = p.product.nameAr;
      const error =
        validateSelection(p.product, p.selection, effectiveGender || "female") ||
        validateCustomerImages(p.product, p.selection, p.customerImages) ||
        validateCustomerTexts(p.product, p.selection, p.customerTexts) ||
        (p.product.type === "robe" ? robeMeasurementsError(p.measurements) : null);
      if (error) return `${label}: ${error}`;
    }
    return null;
  }

  function review() {
    const error = firstError();
    if (error) {
      setShowErrors(true);
      toast.error(error);
      return;
    }
    setConfirmOpen(true);
  }

  async function submit() {
    setSubmitting(true);
    try {
      const studentPayload: NewRetailStudentPayload | undefined = creatingStudent
        ? {
            name: name.trim(),
            phone: phone.replace(/\D/g, ""),
            gender: gender as "male" | "female",
            ...(instagram.trim() ? { instagram_username: instagram.trim() } : {}),
            ...(university.trim() ? { university_name: university.trim() } : {}),
            ...(department.trim() ? { department: department.trim() } : {}),
            ...(studyType ? { study_type: studyType } : {}),
          }
        : undefined;

      const result = await createRetailOrders({
        ...(student ? { student_id: student.id } : { student: studentPayload }),
        pieces: pieces.map((p) => ({
          product_id: p.productId,
          selections: buildConfigureSelections(
            p.product as CatalogProduct,
            p.selection,
            p.customerImages,
            p.customerTexts
          ),
          ...(p.product?.type === "robe" ? { measurements: p.measurements } : {}),
        })),
        group: {
          customer_name: (student?.name ?? name).trim(),
          phone_primary: phonePrimary.trim(),
          phone_secondary: phoneSecondary.trim(),
          governorate: governorate.trim(),
          area_details: areaDetails.trim(),
          event_date: eventDate,
          notes: notes.trim(),
        },
      });
      setConfirmOpen(false);
      toast.success(
        result.orders.length > 1 ? `تم إنشاء الطلب (${result.orders.length} قطع)` : "تم إنشاء الطلب"
      );
      onCreated(result);
    } catch (error) {
      setConfirmOpen(false);
      toast.error(getApiErrorMessage(error, "تعذر إنشاء الطلب"));
    } finally {
      setSubmitting(false);
    }
  }

  if (catalogError) {
    return (
      <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-danger">
        {catalogError}
      </p>
    );
  }
  if (!catalog) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-4 text-sm text-ink-soft">
        <Spinner className="h-4 w-4" /> جارٍ تحميل المنتجات…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {creatingStudent && (
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)]">
          <h2 className="text-sm font-bold text-ink">معلومات الطالب</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            الاسم والهاتف والجنس مطلوبة. الرقم يفتح للطالب حسابه ويجعل الطلب طلب تجزئة يُعدَّل
            بأسعار المفرد، والجنس يحدّد الخيارات المعروضة لكل قطعة.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Input
              autoComplete="off"
              label="اسم الطالب *"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              error={showErrors && !name.trim() ? "الاسم مطلوب" : undefined}
            />
            <Input
              autoComplete="off"
              label="رقم الهاتف *"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={20}
              dir="ltr"
              placeholder="07XXXXXXXXX"
              error={
                showErrors && !/^07\d{9}$/.test(phone.replace(/\D/g, ""))
                  ? "رقم عراقي صحيح مطلوب"
                  : undefined
              }
            />
            {/* Radios, NOT a <select>: Chrome autofills a gender-shaped select silently, and
                gender decides which option groups are shown AND priced — an unnoticed default
                would quietly build the wrong order. Radios are also one tap on a phone. */}
            <fieldset>
              <legend className="text-sm font-medium text-ink">الجنس *</legend>
              <div className="mt-1.5 flex gap-2">
                {([
                  ["female", "أنثى"],
                  ["male", "ذكر"],
                ] as const).map(([value, label]) => (
                  <label
                    key={value}
                    className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition ${
                      gender === value
                        ? "border-orange-ink bg-orange-ink/5 text-ink"
                        : "border-line bg-beige text-ink-soft hover:border-orange-ink/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name="retail-builder-gender"
                      className="size-4 accent-[var(--color-orange-ink)]"
                      checked={gender === value}
                      onChange={() => setGender(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              {showErrors && !gender && (
                <p className="mt-1 text-xs text-danger">الجنس مطلوب</p>
              )}
            </fieldset>
            <Input
              autoComplete="off"
              label="يوزر الانستا (بدون @)"
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              maxLength={100}
              dir="ltr"
            />
            <Input
              autoComplete="off"
              label="الجامعة"
              value={university}
              onChange={(e) => setUniversity(e.target.value)}
              maxLength={120}
            />
            <Input
              autoComplete="off"
              label="القسم"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              maxLength={120}
            />
            <Select
              autoComplete="off"
              label="نوع الدراسة"
              value={studyType}
              onChange={(e) => setStudyType(e.target.value as "" | "morning" | "evening")}
              options={[
                { value: "", label: "— غير محدد —" },
                { value: "morning", label: "صباحي" },
                { value: "evening", label: "مسائي" },
              ]}
            />
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-ink">القطع المطلوبة</h2>
          {pieces.length > 0 && (
            <span className="text-xs font-semibold text-ink-soft">{pieces.length} قطعة</span>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          كل القطع تُحفظ في طلب واحد بأسعار المفرد — نفس المنتجات والخيارات التي يراها الطالب في
          المتجر.
        </p>

        {!effectiveGender ? (
          <p className="mt-3 rounded-xl bg-orange-ink/5 px-3 py-2.5 text-xs font-semibold text-ink">
            اختر جنس الطالب أولاً — الخيارات المعروضة لكل قطعة تعتمد عليه.
          </p>
        ) : (
          <>
            <div className="mt-3 space-y-3">
              {pieces.map((piece) => {
                const open = openKey === piece.key;
                const line = priced.find((p) => p.key === piece.key);
                return (
                  <div key={piece.key} className="rounded-xl border border-line bg-white">
                    <div className="flex items-center gap-2 p-3">
                      <button
                        type="button"
                        onClick={() => setOpenKey(open ? null : piece.key)}
                        className="flex min-h-11 flex-1 items-center gap-2 text-start"
                        aria-expanded={open}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-ink">
                            {piece.product?.nameAr ?? "جارٍ التحميل…"}
                          </span>
                          <span dir="ltr" className="block text-xs tabular-nums text-ink-soft">
                            {formatIQD(line?.total ?? 0)}
                          </span>
                        </span>
                        <span aria-hidden className="text-ink-soft">
                          {open ? "▲" : "▼"}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removePiece(piece.key)}
                        aria-label={`إزالة ${piece.product?.nameAr ?? "القطعة"}`}
                        className="min-h-11 min-w-11 rounded-lg text-lg text-ink-soft transition hover:bg-danger/10 hover:text-danger"
                      >
                        ✕
                      </button>
                    </div>

                    {open && (
                      <div className="space-y-4 border-t border-line p-3">
                        {piece.loading || !piece.product ? (
                          <div className="flex items-center gap-2 text-sm text-ink-soft">
                            <Spinner className="h-4 w-4" /> جارٍ تحميل الخيارات…
                          </div>
                        ) : (
                          <>
                            <RetailPieceOptions
                              product={piece.product}
                              gender={effectiveGender}
                              selection={piece.selection}
                              onGroupChange={(groupId, value) =>
                                setGroupValue(piece.key, groupId, value)
                              }
                              customerImages={piece.customerImages}
                              customerTexts={piece.customerTexts}
                              setCustomerImages={(update) =>
                                setPieces((prev) =>
                                  prev.map((p) =>
                                    p.key === piece.key
                                      ? {
                                          ...p,
                                          customerImages:
                                            typeof update === "function"
                                              ? update(p.customerImages)
                                              : update,
                                        }
                                      : p
                                  )
                                )
                              }
                              setCustomerTexts={(update) =>
                                setPieces((prev) =>
                                  prev.map((p) =>
                                    p.key === piece.key
                                      ? {
                                          ...p,
                                          customerTexts:
                                            typeof update === "function"
                                              ? update(p.customerTexts)
                                              : update,
                                        }
                                      : p
                                  )
                                )
                              }
                              showErrors={showErrors}
                              uploadImage={uploadProductionImage}
                            />
                            {piece.product.type === "robe" && (
                              <RobeMeasurementFields
                                measurements={piece.measurements}
                                setMeasurements={(update) =>
                                  setPieces((prev) =>
                                    prev.map((p) =>
                                      p.key === piece.key
                                        ? {
                                            ...p,
                                            measurements:
                                              typeof update === "function"
                                                ? update(p.measurements)
                                                : update,
                                          }
                                        : p
                                    )
                                  )
                                }
                                showErrors={showErrors}
                                error={robeMeasurementsError(piece.measurements)}
                                uploadImage={uploadProductionImage}
                              />
                            )}
                            {line && line.lines.length > 0 && (
                              <PriceBreakdown lines={line.lines} total={line.total} compact />
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <Button
              variant="ghost"
              fullWidth
              className="mt-3"
              onClick={() => setPickerOpen(true)}
            >
              + أضف قطعة
            </Button>
          </>
        )}
      </section>

      {pieces.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)]">
          <h2 className="mb-1 text-sm font-bold text-ink">بيانات التسليم</h2>
          <p className="mb-3 text-xs text-ink-soft">للطلب كله — كلها اختيارية.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              label="رقم الهاتف"
              value={phonePrimary}
              onChange={(e) => setPhonePrimary(e.target.value)}
              maxLength={20}
              dir="ltr"
            />
            <Input
              label="رقم إضافي"
              value={phoneSecondary}
              onChange={(e) => setPhoneSecondary(e.target.value)}
              maxLength={20}
              dir="ltr"
            />
            <Input
              label="المحافظة"
              value={governorate}
              onChange={(e) => setGovernorate(e.target.value)}
              maxLength={120}
            />
            <Input
              label="أقرب نقطة دالة"
              value={areaDetails}
              onChange={(e) => setAreaDetails(e.target.value)}
              maxLength={300}
            />
            <Input
              label="تاريخ الحفلة"
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              dir="ltr"
            />
            <Input
              label="ملاحظات"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
            />
          </div>
        </section>
      )}

      {pieces.length > 0 && (
        <>
          <section className="rounded-2xl border border-orange-ink/20 bg-orange-ink/5 p-4">
            <ul className="space-y-1.5">
              {priced.map((p) => (
                <li key={p.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-ink">{p.name}</span>
                  <span dir="ltr" className="shrink-0 tabular-nums text-ink-soft">
                    {formatIQD(p.total)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between border-t border-orange-ink/20 pt-3">
              <span className="text-sm font-bold text-ink">الإجمالي</span>
              <span dir="ltr" className="text-base font-bold tabular-nums text-orange-ink">
                {formatIQD(total)}
              </span>
            </div>
          </section>

          <Button fullWidth onClick={review}>
            مراجعة وإنشاء الطلب
          </Button>
        </>
      )}

      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="اختر القطعة"
      >
        <div className="space-y-4">
          {TYPE_ORDER.filter((type) => (catalog[type] || []).length > 0).map((type) => (
            <div key={type}>
              <p className="mb-2 text-xs font-bold text-ink-soft">{TYPE_LABELS[type]}</p>
              <div className="grid grid-cols-2 gap-2">
                {(catalog[type] || []).map((card) => {
                  const used = usedProductIds.has(card.id);
                  return (
                    <button
                      key={card.id}
                      type="button"
                      disabled={used}
                      onClick={() => addPiece(card.id)}
                      title={used ? "مضافة إلى هذا الطلب" : undefined}
                      className={`flex min-h-11 items-center gap-2.5 rounded-xl border p-2.5 text-start transition ${
                        used
                          ? "cursor-not-allowed border-line bg-beige opacity-50"
                          : "border-line bg-white hover:border-orange-ink/40"
                      }`}
                    >
                      {card.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={card.imageUrl}
                          alt=""
                          className="size-10 shrink-0 rounded-lg object-cover"
                        />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink">
                          {card.nameAr}
                        </span>
                        <span dir="ltr" className="block text-xs tabular-nums text-ink-soft">
                          {used ? "مضافة" : formatIQD(card.basePrice)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        open={confirmOpen}
        onClose={() => !submitting && setConfirmOpen(false)}
        title="تأكيد إنشاء الطلب"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              رجوع
            </Button>
            <Button onClick={submit} loading={submitting}>
              إنشاء الطلب
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-ink-soft">
          <p>
            سيُنشأ طلب باسم{" "}
            <strong className="text-ink">{(student?.name ?? name).trim() || "—"}</strong> يحتوي{" "}
            <strong className="text-ink">{pieces.length}</strong> قطعة بمجموع{" "}
            <strong className="text-orange-ink">{formatIQD(total)}</strong>.
          </p>
          <ul className="space-y-1 ps-4">
            {priced.map((p) => (
              <li key={p.key} className="list-disc text-xs">
                {p.name} — {formatIQD(p.total)}
              </li>
            ))}
          </ul>
          {creatingStudent && (
            <p className="text-xs">
              سيُنشأ حساب تجزئة للطالب برقم <strong dir="ltr" className="text-ink">{phone}</strong>.
              إن كان الرقم مسجّلاً مسبقاً سيُرفض الطلب ويُعرض عليك الطالب الموجود.
            </p>
          )}
          <p className="text-xs">
            الطلب مستقل تمامًا عن أي طلبات سابقة، ولا يدخل في مسار موافقة الممثلين.
          </p>
        </div>
      </Modal>
    </div>
  );
}
