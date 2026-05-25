"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { DesignerStepper } from "@/components/designer/DesignerStepper";
import { SashFlat } from "@/components/designer/SashFlat";
import { TextEditor } from "@/components/designer/TextEditor";
import { Uploader } from "@/components/designer/Uploader";
import { DesignPreview } from "@/components/designer/DesignPreview";
import {
  OrientationModal,
  type Orientation,
} from "@/components/designer/OrientationModal";
import { OptionGroupField } from "@/components/catalog/OptionGroupField";
import { CustomerImageUpload } from "@/components/catalog/CustomerImageUpload";
import { PriceBreakdown } from "@/components/catalog/PriceBreakdown";
import {
  completeDesign,
  getMyDesign,
  saveDesign,
  uploadDesignImage,
  uploadLogo,
} from "@/lib/designer";
import { getProductFull, getShopFeed } from "@/lib/catalog";
import { buildConfigureSelections, configureOrder } from "@/lib/orders";
import {
  computePriceBreakdown,
  groupVisibleForGender,
  validateSelection,
  type OptionSelection,
} from "@/lib/pricing";
import {
  customerImageRequired,
  getSelectedOptionId,
  selectionKey,
  validateCustomerImages,
} from "@/lib/customerImage";
import type { CatalogProduct } from "@/lib/types";
import { getApiErrorMessage } from "@/lib/api";

const GENDER_KEY = "loloshop_student_gender";

function readOrientation(json: unknown | null): Orientation {
  if (!json || typeof json !== "object") return "vertical";
  const o = (json as { orientation?: string }).orientation;
  return o === "horizontal" ? "horizontal" : "vertical";
}

export default function DesignPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth("retail");

  const [bootLoading, setBootLoading] = useState(true);
  const [studentStatus, setStudentStatus] = useState<string | null>(null);
  const [completedLocked, setCompletedLocked] = useState(false);
  const [gender, setGender] = useState<"male" | "female" | null>(null);

  // v2 sash product + option selection
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [selection, setSelection] = useState<OptionSelection>({});
  const [customerImages, setCustomerImages] = useState<Record<string, string>>(
    {}
  );

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [leftJson, setLeftJson] = useState<unknown | null>(null);
  const [rightJson, setRightJson] = useState<unknown | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [extraImageUrl, setExtraImageUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState<string>("");
  const usedFontsRef = useRef<Set<string>>(new Set());

  const [editingSide, setEditingSide] = useState<"left" | "right" | null>(null);
  const [orientPicking, setOrientPicking] = useState<"left" | "right" | null>(
    null
  );
  const [leftOrientation, setLeftOrientation] = useState<Orientation>("vertical");
  const [rightOrientation, setRightOrientation] =
    useState<Orientation>("vertical");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // color option group drives the canvas background
  const colorGroup = useMemo(
    () => product?.optionGroups.find((g) => g.nameAr.includes("لون")) ?? null,
    [product]
  );
  const sashColor = useMemo(() => {
    if (!colorGroup) return "أبيض";
    const id = selection[colorGroup.id];
    const opt = colorGroup.options.find((o) => o.id === id);
    return opt?.labelAr ?? "أبيض";
  }, [colorGroup, selection]);

  const role = product?.priceRole ?? "retail";
  const preview = useMemo(() => {
    if (!product) return { lines: [], total: 0 };
    return computePriceBreakdown(product, selection, role);
  }, [product, selection, role]);

  function getOrientation(side: "left" | "right"): Orientation {
    return side === "left" ? leftOrientation : rightOrientation;
  }

  function setGroupValue(groupId: string, value: OptionSelection[string]) {
    setSelection((prev) => ({ ...prev, [groupId]: value }));
    setCustomerImages((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (k.startsWith(`${groupId}:`)) delete next[k];
      }
      return next;
    });
  }

  // boot: load gender, sash product config, and any existing draft
  useEffect(() => {
    if (authLoading || !user) return;
    const saved = localStorage.getItem(GENDER_KEY);
    if (saved === "male" || saved === "female") setGender(saved);

    let cancelled = false;
    (async () => {
      try {
        const [feed, my] = await Promise.all([getShopFeed(), getMyDesign()]);
        if (cancelled) return;

        const sashCard = (feed.byType.sash ?? [])[0];
        if (sashCard) {
          const full = await getProductFull(sashCard.id);
          if (cancelled) return;
          setProduct(full);

          // restore draft
          setStudentStatus(my.student_status);
          if (my.data) {
            setLeftJson(my.data.left_canvas);
            setRightJson(my.data.right_canvas);
            setLeftOrientation(readOrientation(my.data.left_canvas));
            setRightOrientation(readOrientation(my.data.right_canvas));
            setLogoUrl(my.data.logo_url);
            setExtraImageUrl(my.data.extra_image_url);
            setNotes(my.data.notes || "");
            (my.data.fonts_used || []).forEach((f) =>
              usedFontsRef.current.add(f)
            );
            // pre-select the saved colour if it matches a v2 option
            const cg = full.optionGroups.find((g) => g.nameAr.includes("لون"));
            const match = cg?.options.find(
              (o) => o.labelAr === my.data?.sash_color
            );
            if (cg && match) {
              setSelection((prev) => ({ ...prev, [cg.id]: match.id }));
            }
            if (my.data.completed) setCompletedLocked(true);
          }
        } else {
          setStudentStatus(my.student_status);
        }
      } catch {
        // empty / first-time design
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  const persist = useCallback(
    async (silent = false) => {
      if (completedLocked || !product) return;
      setSaving(true);
      try {
        await saveDesign({
          sash_color: sashColor,
          left_canvas: leftJson,
          right_canvas: rightJson,
          logo_url: logoUrl,
          extra_image_url: extraImageUrl,
          fonts_used: Array.from(usedFontsRef.current),
          notes: notes || null,
        });
        setSavedAt(Date.now());
        if (!silent) toast.success("تم الحفظ");
      } catch (e) {
        if (!silent) toast.error(getApiErrorMessage(e, "تعذر الحفظ"));
      } finally {
        setSaving(false);
      }
    },
    [completedLocked, product, sashColor, leftJson, rightJson, logoUrl, extraImageUrl, notes]
  );

  // debounced auto-save while editing the canvas
  useEffect(() => {
    if (bootLoading || step !== 2) return;
    const t = setTimeout(() => persist(true), 15_000);
    return () => clearTimeout(t);
  }, [bootLoading, step, persist]);

  function goToCanvas() {
    if (!product) return;
    const err = validateSelection(product, selection, gender);
    if (err) return toast.error(err);
    const imgErr = validateCustomerImages(product, selection, customerImages);
    if (imgErr) return toast.error(imgErr);
    setStep(2);
  }

  async function confirmDesign() {
    if (!product) return;
    const err = validateSelection(product, selection, gender);
    if (err) {
      setConfirmOpen(false);
      return toast.error(err);
    }
    setConfirming(true);
    try {
      const { id: designId } = await saveDesign({
        sash_color: sashColor,
        left_canvas: leftJson,
        right_canvas: rightJson,
        logo_url: logoUrl,
        extra_image_url: extraImageUrl,
        fonts_used: Array.from(usedFontsRef.current),
        notes: notes || null,
      });
      // price the order from options + write order_items (reconciles the design's order)
      await configureOrder({
        productId: product.id,
        designId,
        selections: buildConfigureSelections(product, selection, customerImages),
      });
      // lock the design
      await completeDesign();
      toast.success("تم تأكيد تصميمك وطلبك");
      router.replace("/");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر التأكيد"));
    } finally {
      setConfirming(false);
      setConfirmOpen(false);
    }
  }

  if (authLoading || bootLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <Spinner />
      </div>
    );
  }

  if (studentStatus && studentStatus !== "approved") {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 bg-cream p-6 text-center">
        <h1 className="font-display text-2xl text-ink">
          {studentStatus === "rejected" ? "تم رفض طلبك" : "بانتظار موافقة الممثل"}
        </h1>
        <p className="text-ink/70">
          {studentStatus === "rejected"
            ? "تواصل مع الممثل لمعرفة السبب"
            : "سيتمكن الممثل من الموافقة على حسابك قريباً. سيتم إعلامك."}
        </p>
        <Button variant="ghost" onClick={() => router.push("/")}>
          العودة للرئيسية
        </Button>
      </div>
    );
  }

  if (completedLocked) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 bg-cream p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange/15 text-3xl text-orange">
          ✓
        </div>
        <h1 className="font-display text-2xl text-ink">تم تأكيد تصميمك</h1>
        <p className="text-ink/70">
          لا يمكنك تعديل التصميم بعد التأكيد. تواصل مع الإدارة عند الحاجة.
        </p>
        <Button variant="primary" onClick={() => router.push("/")}>
          العودة للرئيسية
        </Button>
      </div>
    );
  }

  const groups = (product?.optionGroups ?? [])
    .filter((g) => groupVisibleForGender(g, gender))
    .sort((a, b) => a.sort - b.sort);

  return (
    <div className="mx-auto min-h-screen max-w-4xl bg-cream">
      <header className="bg-ink px-4 py-5 text-center text-cream">
        <p className="font-script text-3xl leading-none text-orange">lolo shop</p>
        <h1 className="mt-1 font-display text-xl">صمّم وشاحك</h1>
      </header>

      <DesignerStepper step={step} />

      <main className="px-4 pb-36 pt-2">
        {/* STEP 1 — options */}
        {step === 1 && (
          <section className="mx-auto max-w-md space-y-5">
            <Link href="/shop" className="inline-block text-sm text-orange hover:underline">
              ← المنتجات
            </Link>
            {!product && (
              <p className="p-6 text-center text-ink/60">لا يوجد وشاح متاح حالياً</p>
            )}
            {groups.map((group) => {
              const optionId = getSelectedOptionId(group, selection);
              const needsImage =
                optionId != null && customerImageRequired(group, optionId);
              const key =
                optionId != null ? selectionKey(group.id, optionId) : null;
              return (
                <div key={group.id} className="rounded-2xl bg-beige/60 p-4">
                  <OptionGroupField
                    group={group}
                    selection={selection}
                    role={role}
                    onChange={setGroupValue}
                  />
                  {needsImage && key && optionId && (
                    <CustomerImageUpload
                      group={group}
                      optionId={optionId}
                      value={customerImages[key]}
                      onChange={(url) =>
                        setCustomerImages((prev) => ({ ...prev, [key]: url }))
                      }
                    />
                  )}
                </div>
              );
            })}

            {product && (
              <PriceBreakdown lines={preview.lines} total={preview.total} compact />
            )}
          </section>
        )}

        {/* STEP 2 — canvas */}
        {step === 2 && (
          <section className="space-y-6">
            <p className="text-center text-sm text-ink/70">
              اضغط على أحد الجانبين لبدء التصميم
            </p>
            <SashFlat
              sashColor={sashColor}
              leftJson={leftJson}
              rightJson={rightJson}
              leftOrientation={leftOrientation}
              rightOrientation={rightOrientation}
              onClickSide={(s) => {
                const json = s === "left" ? leftJson : rightJson;
                if (!json) setOrientPicking(s);
                else setEditingSide(s);
              }}
            />

            <div className="mx-auto grid max-w-md grid-cols-1 gap-3 sm:grid-cols-2">
              <Uploader
                label="شعار الجامعة"
                value={logoUrl}
                onChange={setLogoUrl}
                upload={uploadLogo}
                maxMB={5}
              />
              <Uploader
                label="صورة إضافية"
                value={extraImageUrl}
                onChange={setExtraImageUrl}
                upload={uploadDesignImage}
                maxMB={10}
              />
            </div>

            <div className="mx-auto max-w-md text-center text-xs text-ink/50">
              {saving
                ? "جارٍ الحفظ…"
                : savedAt
                ? "تم حفظ المسودة تلقائياً ✓"
                : "يتم الحفظ تلقائياً أثناء التصميم"}
            </div>
          </section>
        )}

        {/* STEP 3 — preview + confirm */}
        {step === 3 && (
          <section className="space-y-6">
            <DesignPreview
              sashColor={sashColor}
              leftJson={leftJson}
              rightJson={rightJson}
              leftOrientation={leftOrientation}
              rightOrientation={rightOrientation}
            />

            {product && (
              <div className="mx-auto max-w-md">
                <PriceBreakdown lines={preview.lines} total={preview.total} />
              </div>
            )}

            <div className="mx-auto max-w-md space-y-2">
              <label className="block text-sm font-medium text-ink">
                ملاحظات للموظفين (اختياري)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-ink/20 bg-beige p-3 text-sm"
                placeholder="مثال: اللون الذهبي أبرز ما يمكن"
              />
            </div>
          </section>
        )}
      </main>

      {/* sticky action bar */}
      <div className="fixed bottom-0 left-1/2 z-40 w-full max-w-4xl -translate-x-1/2 border-t border-neutral bg-beige px-4 py-3">
        <div className="mx-auto flex max-w-md gap-2">
          {step === 1 && (
            <Button variant="primary" fullWidth disabled={!product} onClick={goToCanvas}>
              التالي ←
            </Button>
          )}
          {step === 2 && (
            <>
              <Button variant="ghost" onClick={() => setStep(1)}>
                → الخيارات
              </Button>
              <Button
                variant="primary"
                fullWidth
                disabled={!leftJson && !rightJson}
                onClick={() => {
                  persist(true);
                  setStep(3);
                }}
              >
                معاينة ←
              </Button>
            </>
          )}
          {step === 3 && (
            <>
              <Button variant="ghost" onClick={() => setStep(2)}>
                → تعديل
              </Button>
              <Button variant="primary" fullWidth onClick={() => setConfirmOpen(true)}>
                تأكيد ({new Intl.NumberFormat("ar-IQ").format(preview.total)} د.ع)
              </Button>
            </>
          )}
        </div>
      </div>

      {editingSide && (
        <TextEditor
          open={true}
          side={editingSide}
          orientation={getOrientation(editingSide)}
          initialJson={editingSide === "left" ? leftJson : rightJson}
          initialImageUrl={logoUrl}
          sashColor={sashColor}
          onSave={(json, fonts) => {
            fonts.forEach((f) => usedFontsRef.current.add(f));
            if (editingSide === "left") setLeftJson(json);
            else setRightJson(json);
            setEditingSide(null);
            setTimeout(() => persist(true), 100);
          }}
          onClose={() => setEditingSide(null)}
        />
      )}

      <OrientationModal
        open={!!orientPicking}
        side={orientPicking || "right"}
        current={
          orientPicking
            ? orientPicking === "left"
              ? leftOrientation
              : rightOrientation
            : "vertical"
        }
        onSelect={(o) => {
          if (!orientPicking) return;
          if (orientPicking === "left") setLeftOrientation(o);
          else setRightOrientation(o);
          const side = orientPicking;
          setOrientPicking(null);
          setEditingSide(side);
        }}
        onClose={() => setOrientPicking(null)}
      />

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 p-4 sm:items-center"
          onClick={() => !confirming && setConfirmOpen(false)}
        >
          <div
            className="w-full max-w-md space-y-4 rounded-2xl bg-cream p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-xl text-ink">تأكيد التصميم النهائي</h3>
            <p className="text-sm text-ink/70">
              السعر الإجمالي{" "}
              <span className="font-semibold text-orange">
                {new Intl.NumberFormat("ar-IQ").format(preview.total)} د.ع
              </span>
              . لن تتمكن من تعديل التصميم بعد التأكيد. هل أنت متأكد؟
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                fullWidth
                onClick={() => setConfirmOpen(false)}
                disabled={confirming}
              >
                إلغاء
              </Button>
              <Button variant="primary" fullWidth onClick={confirmDesign} loading={confirming}>
                نعم، أكّد
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
