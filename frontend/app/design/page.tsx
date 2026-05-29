"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useDesignDraft } from "@/hooks/useDesignDraft";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/ui/Modal";
import { DesignerStepper } from "@/components/designer/DesignerStepper";
import { SashGownPreview } from "@/components/designer/SashGownPreview";
import { OptionGroupField } from "@/components/catalog/OptionGroupField";
import { CustomerImageUpload } from "@/components/catalog/CustomerImageUpload";
import { PriceBreakdown } from "@/components/catalog/PriceBreakdown";
import { BrandMark } from "@/components/ui/BrandLogo";
import { uploadDesignImage, uploadLogo } from "@/lib/designer";
import {
  customerImageRequired,
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
        <p className="text-center text-sm text-ink/60">جارٍ فتح المحرّر…</p>
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

  const {
    router,
    bootLoading,
    bootError,
    studentStatus,
    completedLocked,
    product,
    selection,
    customerImages,
    setCustomerImages,
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
  } = draft;

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
        <p className="text-ink/80">{bootError}</p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          إعادة المحاولة
        </Button>
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
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange/15 text-orange-ink">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m5 13 4 4L19 7" />
          </svg>
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

  const editingJson = editingSide === "left" ? leftJson : rightJson;

  return (
    <div className="mx-auto min-h-screen max-w-4xl bg-cream">
      <header className="relative overflow-hidden bg-brand-gradient px-4 py-5 text-center text-cream">
        <div className="sash-shimmer-strip" aria-hidden />
        <BrandMark size={64} className="mb-2" />
        <h1 className="mt-1 font-display text-xl">صمّم وشاحك</h1>
      </header>

      <div aria-live="polite" className="sr-only">
        {step === 1 ? "الخطوة الأولى" : step === 2 ? "الخطوة الثانية" : "الخطوة الثالثة"}
      </div>

      {!editingSide && <DesignerStepper step={step} />}

      {saveFailed && !editingSide && (
        <div
          role="alert"
          className="mx-4 mt-2 flex items-center justify-between gap-3 rounded-xl border border-orange/40 bg-orange/10 px-4 py-3 text-sm text-ink"
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
        <p className="px-4 pb-1 text-center text-sm text-ink/60">
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
              <p className="p-6 text-center text-ink/60">لا يوجد وشاح متاح حالياً</p>
            )}
            {sortedGroups.map((group) => {
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
                className="mx-auto max-w-md rounded-xl border border-orange/30 bg-orange/10 px-4 py-2.5 text-center text-sm text-ink/80"
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
              <label className="mx-auto flex max-w-md items-center gap-2 text-sm text-ink/70">
                <input
                  type="checkbox"
                  checked={singleSideOnly}
                  onChange={(e) => setSingleSideOnly(e.target.checked)}
                  className="accent-orange"
                />
                تصميم جانب واحد فقط
              </label>
            )}

            <div
              className="mx-auto max-w-md text-center text-xs text-ink/50"
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
                className="w-full rounded-lg border border-ink/20 bg-beige p-3 text-sm"
                placeholder="مثال: اللون الذهبي أبرز ما يمكن"
              />
            </div>
          </section>
        )}
      </main>

      <div
        className={`fixed bottom-0 left-1/2 z-40 w-full max-w-4xl -translate-x-1/2 border-t border-neutral bg-beige px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${editingSide ? "hidden" : ""}`}
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
          <p className="text-sm text-ink/70">
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
            <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-ink/70">
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
