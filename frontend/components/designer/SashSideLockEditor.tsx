"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { SashGownPreview } from "@/components/designer/SashGownPreview";

// The /designs/uploads/* endpoints are retail-only. Admin/wholesaler draw the
// locked side with text/decoration; image upload is not supported here.
async function uploadNotSupported(): Promise<string> {
  toast.error("رفع الصور غير متاح هنا — استخدم النص والزخرفة");
  throw new Error("upload not supported in lock editor");
}

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

export type EditableSide = "left" | "right" | null;

interface Props {
  /** Which side the STUDENT may edit (null = no lock, both editable). */
  editableSide: EditableSide;
  /** Saved Fabric JSON for the locked side. */
  lockedSideDesign: unknown | null;
  saving?: boolean;
  /** Persist the chosen side + locked-side JSON. */
  onSave: (config: {
    editable_sash_side: EditableSide;
    locked_side_design: unknown | null;
  }) => Promise<void> | void;
  sashColor?: string;
}

const SIDE_LABEL: Record<"left" | "right", string> = {
  left: "جانب الاسم (اليسار)",
  right: "جانب الجامعة (اليمين)",
};

/**
 * Admin/wholesaler control: pick which sash side students edit, and draw the
 * default design for the OTHER (locked) side via the existing Fabric editor.
 */
export function SashSideLockEditor({
  editableSide,
  lockedSideDesign,
  saving = false,
  onSave,
  sashColor = "أبيض",
}: Props) {
  const [side, setSide] = useState<EditableSide>(editableSide);
  const [lockedJson, setLockedJson] = useState<unknown | null>(lockedSideDesign);
  const [editing, setEditing] = useState(false);

  // The locked side = opposite of the editable side.
  const lockedSide: "left" | "right" | null =
    side === "left" ? "right" : side === "right" ? "left" : null;

  async function handleSave() {
    if (side && !lockedJson) {
      toast.error("ارسم تصميم الجانب المُقفل أولاً");
      return;
    }
    await onSave({
      editable_sash_side: side,
      locked_side_design: side ? lockedJson : null,
    });
  }

  return (
    <div dir="rtl" lang="ar" className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-semibold text-ink">
          أي جانب يصمّمه الطالب؟
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { v: null as EditableSide, label: "الجانبان (بدون قفل)" },
              { v: "left" as EditableSide, label: "جانب الاسم فقط" },
              { v: "right" as EditableSide, label: "جانب الجامعة فقط" },
            ]
          ).map((opt) => (
            <button
              key={String(opt.v)}
              type="button"
              onClick={() => setSide(opt.v)}
              className={`min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors ${
                side === opt.v
                  ? "border-orange bg-orange/15 text-orange-ink"
                  : "border-ink/15 bg-white/60 text-ink hover:border-orange/40"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {lockedSide && (
        <div className="space-y-3">
          <p className="text-sm text-ink/70">
            ارسم التصميم الافتراضي للجانب المُقفل ({SIDE_LABEL[lockedSide]}). هذا
            ما سيراه الطلاب بدون تعديل.
          </p>
          <div className="pointer-events-none mx-auto max-w-xs">
            <SashGownPreview
              sashColor={sashColor}
              leftJson={lockedSide === "left" ? lockedJson : null}
              rightJson={lockedSide === "right" ? lockedJson : null}
              readOnly
            />
          </div>
          <Button variant="ghost" fullWidth onClick={() => setEditing(true)}>
            {lockedJson ? "تعديل تصميم الجانب المُقفل" : "ارسم الجانب المُقفل"}
          </Button>
        </div>
      )}

      <Button variant="primary" fullWidth loading={saving} onClick={handleSave}>
        حفظ الإعدادات
      </Button>

      {editing && lockedSide && (
        <div className="fixed inset-0 z-[200] flex min-h-0 flex-col bg-cream">
          <TextEditor
            open
            side={lockedSide}
            initialJson={lockedJson}
            sashColor={sashColor}
            autoOpenText={!lockedJson}
            uploadLogo={uploadNotSupported}
            uploadImage={uploadNotSupported}
            onLogoChange={() => {}}
            onImageChange={() => {}}
            onSave={(json) => {
              setLockedJson(json);
              setEditing(false);
            }}
            onClose={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  );
}
