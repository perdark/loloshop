"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { DesignerStepper } from "@/components/designer/DesignerStepper";
import { ColorPicker } from "@/components/designer/ColorPicker";
import { SashFlat } from "@/components/designer/SashFlat";
import { TextEditor } from "@/components/designer/TextEditor";
import { Uploader } from "@/components/designer/Uploader";
import { DesignPreview } from "@/components/designer/DesignPreview";
import {
  OrientationModal,
  type Orientation,
} from "@/components/designer/OrientationModal";
import {
  completeDesign,
  getMyDesign,
  saveDesign,
  uploadDesignImage,
  uploadLogo,
} from "@/lib/designer";
import type { ProductVariant } from "@/lib/types";
import { getApiErrorMessage } from "@/lib/api";

export default function DesignPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth("retail");

  const [bootLoading, setBootLoading] = useState(true);
  const [studentStatus, setStudentStatus] = useState<string | null>(null);
  const [completedLocked, setCompletedLocked] = useState(false);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [sashColor, setSashColor] = useState<string>("أبيض");
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
  const [leftOrientation, setLeftOrientation] =
    useState<Orientation>("vertical");
  const [rightOrientation, setRightOrientation] =
    useState<Orientation>("vertical");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function getOrientation(side: "left" | "right"): Orientation {
    return side === "left" ? leftOrientation : rightOrientation;
  }

  function readOrientation(json: unknown | null): Orientation {
    if (!json || typeof json !== "object") return "vertical";
    const o = (json as { orientation?: string }).orientation;
    return o === "horizontal" ? "horizontal" : "vertical";
  }

  // load existing draft on mount
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getMyDesign();
        if (cancelled) return;
        setStudentStatus(res.student_status);
        if (res.data) {
          setVariantId(res.data.variant_id);
          setSashColor(res.data.sash_color || "أبيض");
          setLeftJson(res.data.left_canvas);
          setRightJson(res.data.right_canvas);
          setLeftOrientation(readOrientation(res.data.left_canvas));
          setRightOrientation(readOrientation(res.data.right_canvas));
          setLogoUrl(res.data.logo_url);
          setExtraImageUrl(res.data.extra_image_url);
          setNotes(res.data.notes || "");
          (res.data.fonts_used || []).forEach((f) =>
            usedFontsRef.current.add(f)
          );
          if (res.data.completed) {
            setCompletedLocked(true);
          } else if (res.data.variant_id) {
            setStep(2);
          }
        }
      } catch {
        // ignore — empty design
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
      if (completedLocked) return;
      if (!variantId) return; // nothing to save yet
      setSaving(true);
      try {
        await saveDesign({
          variant_id: variantId,
          sash_color: sashColor,
          left_canvas: leftJson,
          right_canvas: rightJson,
          logo_url: logoUrl,
          extra_image_url: extraImageUrl,
          fonts_used: Array.from(usedFontsRef.current),
          notes: notes || null,
        });
        if (!silent) toast.success("تم الحفظ");
      } catch (e) {
        if (!silent) {
          toast.error(getApiErrorMessage(e, "تعذر الحفظ"));
        }
      } finally {
        setSaving(false);
      }
    },
    [
      completedLocked,
      variantId,
      sashColor,
      leftJson,
      rightJson,
      logoUrl,
      extraImageUrl,
      notes,
    ]
  );

  // debounce auto-save when state changes
  useEffect(() => {
    if (bootLoading || step !== 2) return;
    const t = setTimeout(() => {
      persist(true);
    }, 30_000);
    return () => clearTimeout(t);
  }, [bootLoading, step, persist]);

  async function confirmDesign() {
    setConfirming(true);
    try {
      await persist(true);
      await completeDesign();
      toast.success("تم تأكيد تصميمك");
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
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (studentStatus && studentStatus !== "approved") {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="font-display text-2xl text-ink">
          {studentStatus === "rejected"
            ? "تم رفض طلبك"
            : "بانتظار موافقة الممثل"}
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
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="font-display text-2xl text-ink">
          تم تأكيد تصميمك ✓
        </h1>
        <p className="text-ink/70">
          لا يمكنك تعديل التصميم بعد التأكيد. تواصل مع الإدارة عند الحاجة.
        </p>
        <Button variant="primary" onClick={() => router.push("/")}>
          العودة للرئيسية
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-4xl">
      <header className="bg-ink px-4 py-4 text-cream">
        <h1 className="text-center font-display text-2xl">صمّم وشاحك</h1>
      </header>

      <DesignerStepper step={step} />

      <main className="px-4 pb-32 pt-2">
        {step === 1 && (
          <section>
            <ColorPicker
              selectedVariantId={variantId}
              onSelect={(v: ProductVariant) => {
                setVariantId(v.id);
                if (v.color) setSashColor(v.color);
              }}
            />
            <div className="mx-auto max-w-md p-4">
              <Button
                variant="primary"
                fullWidth
                disabled={!variantId}
                onClick={() => setStep(2)}
              >
                التالي →
              </Button>
            </div>
          </section>
        )}

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
                // if no design on this side yet, ask orientation first
                const json = s === "left" ? leftJson : rightJson;
                if (!json) {
                  setOrientPicking(s);
                } else {
                  setEditingSide(s);
                }
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

            <div className="mx-auto flex max-w-md gap-2">
              <Button
                variant="ghost"
                fullWidth
                onClick={() => setStep(1)}
              >
                ← رجوع
              </Button>
              <Button
                variant="secondary"
                onClick={() => persist(false)}
                loading={saving}
              >
                حفظ مسودة
              </Button>
              <Button
                variant="primary"
                fullWidth
                onClick={() => setStep(3)}
                disabled={!leftJson && !rightJson}
              >
                التالي →
              </Button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="space-y-6">
            <DesignPreview
              sashColor={sashColor}
              leftJson={leftJson}
              rightJson={rightJson}
              leftOrientation={leftOrientation}
              rightOrientation={rightOrientation}
            />

            <div className="mx-auto max-w-md space-y-3">
              <label className="block text-sm font-medium text-ink">
                ملاحظات للموظفين (اختياري)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-ink/20 bg-cream p-3 text-sm"
                placeholder="مثال: اللون الذهبي أبرز ما يمكن"
              />
            </div>

            <div className="mx-auto flex max-w-md gap-2">
              <Button
                variant="ghost"
                fullWidth
                onClick={() => setStep(2)}
              >
                ← تعديل
              </Button>
              <Button
                variant="primary"
                fullWidth
                onClick={() => setConfirmOpen(true)}
              >
                تأكيد التصميم
              </Button>
            </div>
          </section>
        )}
      </main>

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
            <h3 className="font-display text-xl text-ink">
              تأكيد التصميم النهائي
            </h3>
            <p className="text-sm text-ink/70">
              لن تتمكن من تعديل التصميم بعد التأكيد. هل أنت متأكد؟
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
              <Button
                variant="primary"
                fullWidth
                onClick={confirmDesign}
                loading={confirming}
              >
                نعم، أكّد
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
