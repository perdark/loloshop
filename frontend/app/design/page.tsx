"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useDesignDraft } from "@/hooks/useDesignDraft";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/ui/Modal";
import { DesignerStepper } from "@/components/designer/DesignerStepper";
import { VipTierGate } from "@/components/vip/VipTierGate";
import { SashGownPreview } from "@/components/designer/SashGownPreview";
import { OptionGroupField } from "@/components/catalog/OptionGroupField";
import { CustomerImageUpload } from "@/components/catalog/CustomerImageUpload";
import { PriceBreakdown } from "@/components/catalog/PriceBreakdown";
import { BrandMark } from "@/components/ui/BrandLogo";
import { uploadDesignImage, uploadLogo } from "@/lib/designer";
import {
  customerImageRequired,
  customerTextRequired,
  getSelectedOptionId,
  selectionKey,
} from "@/lib/customerImage";

const TextEditor = dynamic(
  () => import("@/components/designer/TextEditor").then((m) => m.TextEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-cream px-6">
        <Spinner />
        <p className="text-center text-sm text-ink-soft">جارٍ فتح المحرّر…</p>
      </div>
    ),
  }
);

const DesignPreview = dynamic(
  () => import("@/components/designer/DesignPreview").then((m) => m.DesignPreview),
  { ssr: false, loading: () => <Spinner /> }
);

export default function DesignPage() {
  const { user, loading: authLoading } = useRequireAuth("retail");
  const [editingSide, setEditingSide] = useState<"left" | "right" | null>(null);
  const draft = useDesignDraft(!authLoading && !!user, !!editingSide);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Which sash card is currently being loaded from the chooser (shows a spinner).
  const [selectingId, setSelectingId] = useState<string | null>(null);

  const {
    router,
    bootLoading,
    bootError,
    studentStatus,
    completedLocked,
    isRepStudent,
    product,
    sashChoices,
    selectSashProduct,
    selection,
    customerImages,
    setCustomerImages,
    customerTexts,
    setCustomerTexts,
    step,
    setStep,
    leftJson,
    rightJson,
    setLeftJson,
    setRightJson,
    logoUrl,
    extraImageUrl,
    setLogoUrl,
    setExtraImageUrl,
    notes,
    setNotes,
    saving,
    savedAt,
    saveFailed,
    clearSaveFailed,
    confirming,
    singleSideOnly,
    setSingleSideOnly,
    editableSide,
    sashColor,
    role,
    preview,
    sortedGroups,
    previewReady,
    setGroupValue,
    goToCanvas,
    goToPreview,
    confirmDesign,
    persist,
    registerFonts,
    fontsUsed,
    gender,
    pickGender,
  } = draft;

  // VIP tier pre-step (retail only). Navigational: "vip" → /vip showcase; "standard"
  // proceeds with the unchanged design flow. Remembered so it shows once per draft.
  const [tier, setTier] = useState<"standard" | "vip" | null>(null);
  const [tierLoaded, setTierLoaded] = useState(false);
  useEffect(() => {
    try {
      const t = sessionStorage.getItem("loloshop_draft_tier");
      if (t === "standard" || t === "vip") setTier(t);
    } catch {
      /* ignore */
    }
    setTierLoaded(true);
  }, []);
  const resolveTier = useCallback(
    (choice: "standard" | "vip") => {
      try {
        sessionStorage.setItem("loloshop_draft_tier", choice);
      } catch {
        /* ignore */
      }
      setTier(choice);
      if (choice === "vip") router.push("/vip");
    },
    [router]
  );

  if (authLoading || bootLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <Spinner />
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 bg-cream p-6 text-center">
        <p className="text-ink-soft">{bootError}</p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  if (studentStatus && studentStatus !== "approved") {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 bg-cream p-6 text-center">
        <h1 className="font-display-ar text-2xl text-ink">
          {studentStatus === "rejected" ? "تم رفض طلبك" : "بانتظار موافقة الممثل"}
        </h1>
        <p className="text-ink-soft">
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
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-sink text-orange-ink">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m5 13 4 4L19 7" />
          </svg>
        </div>
        <h1 className="font-display-ar text-2xl text-ink">تم تأكيد تصميمك</h1>
        <p className="text-ink-soft">
          لا يمكنك تعديل التصميم بعد التأكيد. تواصل مع الإدارة عند الحاجة.
        </p>
        <Button variant="primary" onClick={() => router.push("/")}>
          العودة للرئيسية
        </Button>
      </div>
    );
  }

  // Choose-a-sash step — no specific sash picked yet. A fresh account must pick a
  // sash (with its colors) here FIRST; we never auto-drop them into the canvas of
  // an arbitrary sash. Arriving from a product page (preset) skips this entirely.
  if (!product) {
    return (
      <div className="mx-auto min-h-screen max-w-4xl bg-cream">
        <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
          <BrandMark size={40} />
          <h1 className="font-display-ar text-xl font-semibold text-ink">صمّم وشاحك</h1>
        </header>
        <main className="px-4 py-8 animate-page-in">
          <Link href="/" className="inline-block text-sm text-orange-ink hover:underline">
            ← المتجر
          </Link>
          {sashChoices.length === 0 ? (
            <p className="p-10 text-center text-ink-soft">لا يوجد وشاح متاح حالياً</p>
          ) : (
            <>
              <div className="mb-5 mt-3 text-center">
                <h2 className="font-display-ar text-2xl font-bold text-ink">
                  اختر الوشاح الذي تريد تصميمه
                </h2>
                <p className="mt-1.5 text-sm text-ink-soft">
                  اختر وشاحاً وحدّد لونه، ثم ابدأ التصميم
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {sashChoices.map((sash) => {
                  const loading = selectingId === sash.id;
                  return (
                    <button
                      key={sash.id}
                      type="button"
                      disabled={!!selectingId}
                      onClick={async () => {
                        setSelectingId(sash.id);
                        try {
                          await selectSashProduct(sash.id);
                        } finally {
                          setSelectingId(null);
                        }
                      }}
                      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface text-start shadow-[var(--shadow-soft)] transition-all hover:border-orange-ink/40 hover:shadow-[var(--shadow-pop)] active:scale-[0.98] disabled:opacity-60"
                    >
                      <div className="relative aspect-[3/4] w-full overflow-hidden bg-surface-sink">
                        {sash.imageUrl ? (
                          <Image
                            src={sash.imageUrl}
                            alt={sash.nameAr}
                            fill
                            unoptimized
                            sizes="(max-width: 640px) 45vw, 240px"
                            className={`${sash.imageFit === "contain" ? "object-contain" : "object-cover"} transition-transform duration-500 group-hover:scale-105`}
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-muted">
                            <BrandMark size={48} />
                          </div>
                        )}
                        {loading && (
                          <div className="absolute inset-0 flex items-center justify-center bg-cream/70">
                            <Spinner />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-1 p-3">
                        <p className="line-clamp-2 text-sm font-semibold text-ink">
                          {sash.nameAr}
                        </p>
                        <p className="mt-auto text-sm font-bold text-orange-ink">
                          {new Intl.NumberFormat("ar-IQ").format(sash.basePrice)} د.ع
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </main>
      </div>
    );
  }

  // VIP tier gate — fresh retail draft only; never interrupts an in-progress design.
  if (
    tierLoaded &&
    tier === null &&
    !isRepStudent &&
    product &&
    step === 1 &&
    !leftJson &&
    !rightJson &&
    !editingSide
  ) {
    return (
      <div className="mx-auto min-h-screen max-w-4xl bg-cream">
        <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
          <BrandMark size={40} />
          <h1 className="font-display-ar text-xl font-semibold text-ink">صمّم وشاحك</h1>
        </header>
        <main className="px-4 py-10 animate-page-in">
          <VipTierGate standardPrice={product.basePrice} onResolved={resolveTier} />
        </main>
      </div>
    );
  }

  const editingJson = editingSide === "left" ? leftJson : rightJson;

  return (
    <div className="mx-auto min-h-screen max-w-4xl bg-cream">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <BrandMark size={40} />
        <h1 className="font-display-ar text-xl font-semibold text-ink">صمّم وشاحك</h1>
      </header>

      <div aria-live="polite" className="sr-only">
        {step === 1 ? "الخطوة الأولى" : step === 2 ? "الخطوة الثانية" : "الخطوة الثالثة"}
      </div>

      {!editingSide && <DesignerStepper step={step} />}

      {saveFailed && !editingSide && (
        <div
          role="alert"
          className="mx-4 mt-2 flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-ink"
        >
          <span>لم يُحفظ — تحقق من الاتصال</span>
          <Button
            variant="primary"
            className="shrink-0 px-4 py-2 text-sm"
            disabled={saving}
            onClick={() => {
              clearSaveFailed();
              persist(false).catch(() => {});
            }}
          >
            إعادة المحاولة
          </Button>
        </div>
      )}

      {step === 2 && !editingSide && (
        <p className="px-4 pb-1 text-center text-sm text-ink-soft">
          اضغط على الوشاح في الصورة لتصميم كل جانب
        </p>
      )}

      <main className="px-4 pb-36 pt-2 animate-page-in">
        {step === 1 && (
          <section key="step-1" className="animate-step-in relative mx-auto max-w-md space-y-5 pb-24">
            <Link href="/" className="inline-block text-sm text-orange-ink hover:underline">
              ← المنتجات
            </Link>
            {!product && (
              <p className="p-6 text-center text-ink-soft">لا يوجد وشاح متاح حالياً</p>
            )}
            {/* Gender selector — shown when gender is unknown.
                Gender gates which option groups are visible and prevents
                a restricted product from silently showing wrong options. */}
            {product && gender === null && (
              <div className="rounded-2xl border border-line bg-surface p-4">
                <p className="mb-3 text-sm font-semibold text-ink">
                  حدّد جنسك لعرض الخيارات المناسبة
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => pickGender("male")}
                    className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-cream px-4 text-sm font-medium text-ink-soft transition-colors hover:border-orange-ink hover:text-orange-ink"
                  >
                    ذكر
                  </button>
                  <button
                    type="button"
                    onClick={() => pickGender("female")}
                    className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-cream px-4 text-sm font-medium text-ink-soft transition-colors hover:border-orange-ink hover:text-orange-ink"
                  >
                    أنثى
                  </button>
                </div>
              </div>
            )}
            {sortedGroups.map((group) => {
              const optionId = getSelectedOptionId(group, selection);
              const needsImage =
                optionId != null && customerImageRequired(group, optionId);
              const needsText =
                optionId != null && customerTextRequired(group, optionId);
              const showUploadBlock = needsImage || needsText;
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
                  {showUploadBlock && key && optionId && (
                    <CustomerImageUpload
                      group={group}
                      optionId={optionId}
                      value={customerImages[key]}
                      onChange={(url) =>
                        setCustomerImages((prev) => ({ ...prev, [key]: url }))
                      }
                      textValue={customerTexts[key]}
                      onTextChange={(text) =>
                        setCustomerTexts((prev) => ({ ...prev, [key]: text }))
                      }
                    />
                  )}
                </div>
              );
            })}
            {product && (
              <div className="fixed bottom-20 left-1/2 z-30 w-full max-w-md -translate-x-1/2 px-4 sm:static sm:translate-x-0 sm:px-0">
                <PriceBreakdown lines={preview.lines} total={preview.total} compact />
              </div>
            )}
          </section>
        )}

        {step === 2 && !editingSide && (
          <section key="step-2" className="animate-step-in space-y-4">
            {editableSide && (
              <p
                className="mx-auto max-w-md rounded-xl border border-line bg-surface px-4 py-2.5 text-center text-sm text-ink-soft"
                role="note"
              >
                {editableSide === "left"
                  ? "يمكنك تصميم جانب الاسم فقط — الجانب الآخر مُعدّ مسبقاً من الممثل"
                  : "يمكنك تصميم جانب الجامعة فقط — الجانب الآخر مُعدّ مسبقاً من الممثل"}
              </p>
            )}
            <SashGownPreview
              sashColor={sashColor}
              leftJson={leftJson}
              rightJson={rightJson}
              fontsUsed={fontsUsed}
              onClickSide={(s) => {
                // Locked: ignore taps on the non-editable side.
                if (editableSide && s !== editableSide) return;
                setEditingSide(s);
              }}
              lockedSide={editableSide ? (editableSide === "left" ? "right" : "left") : null}
            />

            {!editableSide && (
              <label className="mx-auto flex max-w-md items-center gap-2 text-sm text-ink-soft">
                <input
                  type="checkbox"
                  checked={singleSideOnly}
                  onChange={(e) => setSingleSideOnly(e.target.checked)}
                  className="accent-orange-ink"
                />
                تصميم جانب واحد فقط
              </label>
            )}

            <div
              className="mx-auto max-w-md text-center text-xs text-[var(--shop-muted)]"
              aria-live="polite"
            >
              {saving
                ? "جارٍ الحفظ…"
                : savedAt
                ? "تم حفظ المسودة تلقائياً ✓"
                : "يتم الحفظ تلقائياً أثناء التصميم"}
            </div>
          </section>
        )}

        {step === 3 && (
          <section key="step-3" className="animate-step-in space-y-6">
            <DesignPreview
              sashColor={sashColor}
              leftJson={leftJson}
              rightJson={rightJson}
              fontsUsed={fontsUsed}
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
                className="w-full rounded-lg border border-line bg-beige p-3 text-sm text-ink placeholder:text-muted"
                placeholder="مثال: اللون الذهبي أبرز ما يمكن"
              />
            </div>
          </section>
        )}
      </main>

      <div
        className={`fixed bottom-0 left-1/2 z-40 w-full max-w-4xl -translate-x-1/2 border-t border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${editingSide ? "hidden" : ""}`}
      >
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
                disabled={!previewReady || saving}
                onClick={() => goToPreview()}
                aria-disabled={!previewReady}
                title={
                  !previewReady
                    ? singleSideOnly
                      ? "صمّم جانباً واحداً على الأقل"
                      : "صمّم الجانبين قبل المعاينة"
                    : undefined
                }
              >
                معاينة ←
              </Button>
            </>
          )}
          {step === 3 && (
            <>
              <Button variant="ghost" onClick={() => setStep(2)} disabled={confirming}>
                → تعديل
              </Button>
              <Button
                variant="primary"
                fullWidth
                disabled={saving || confirming}
                onClick={() => setConfirmOpen(true)}
              >
                تأكيد ({new Intl.NumberFormat("ar-IQ").format(preview.total)} د.ع)
              </Button>
            </>
          )}
        </div>
      </div>

      {editingSide && !(editableSide && editingSide !== editableSide) && (
        <div className="fixed inset-0 z-[200] flex min-h-0 flex-col bg-cream">
          <TextEditor
            open
            side={editingSide}
            initialJson={editingJson}
            sashColor={sashColor}
            autoOpenText={!editingJson}
            logoUrl={logoUrl}
            extraImageUrl={extraImageUrl}
            uploadLogo={uploadLogo}
            uploadImage={uploadDesignImage}
            onLogoChange={setLogoUrl}
            onImageChange={setExtraImageUrl}
            onSave={(json, fonts) => {
              registerFonts(fonts);
              const isLeft = editingSide === "left";
              if (isLeft) setLeftJson(json);
              else setRightJson(json);
              setEditingSide(null);
              void persist(true, isLeft ? { left: json } : { right: json });
            }}
            onClose={() => setEditingSide(null)}
          />
        </div>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => !confirming && setConfirmOpen(false)}
        title="تأكيد التصميم النهائي"
        descriptionId="confirm-design-desc"
        footer={
          <>
            <Button
              variant="ghost"
              fullWidth
              onClick={() => setConfirmOpen(false)}
              disabled={confirming}
            >
              إلغاء
            </Button>
            <Button
              variant="primary"
              fullWidth
              loading={confirming}
              disabled={saving}
              onClick={async () => {
                const ok = await confirmDesign();
                if (ok) setConfirmOpen(false);
              }}
            >
              نعم، أكّد
            </Button>
          </>
        }
      >
        <div id="confirm-design-desc" className="space-y-4">
          <p className="text-sm text-ink-soft">
            السعر الإجمالي{" "}
            <span className="font-semibold text-orange-ink">
              {new Intl.NumberFormat("ar-IQ").format(preview.total)} د.ع
            </span>
            . لن تتمكن من تعديل التصميم بعد التأكيد.
          </p>
          <div className="pointer-events-none">
            <SashGownPreview
              sashColor={sashColor}
              leftJson={leftJson}
              rightJson={rightJson}
              fontsUsed={fontsUsed}
              readOnly
            />
          </div>
          {product && preview.lines.length > 0 && (
            <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-ink-soft">
              {preview.lines.map((line) => (
                <li key={line.label} className="flex justify-between gap-2">
                  <span>{line.label}</span>
                  <span dir="ltr">{line.amount.toLocaleString("ar-IQ")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  );
}
