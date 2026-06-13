"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { resolveCatalogMediaUrl } from "@/lib/catalog";
import { uploadDesignImage } from "@/lib/designer";
import { customerTextRequired } from "@/lib/customerImage";
import type { CatalogOptionGroup } from "@/lib/types";

interface CustomerImageUploadProps {
  group: CatalogOptionGroup;
  optionId: string;
  /** The uploaded image URL (undefined if not yet uploaded). */
  value: string | undefined;
  onChange: (url: string) => void;
  /** Current embroidery text for this selection (only used when requiresCustomerText). */
  textValue?: string;
  onTextChange?: (text: string) => void;
  /** Show inline error state (called by parent after failed submit attempt). */
  showErrors?: boolean;
}

export function CustomerImageUpload({
  group,
  optionId,
  value,
  onChange,
  textValue,
  onTextChange,
  showErrors = false,
}: CustomerImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const opt = group.options.find((o) => o.id === optionId);
  const hintUrl = (group.hasImage ? group.imageUrl : null) || opt?.imageUrl || null;
  const previewUrl = value ? resolveCatalogMediaUrl(value) : null;
  const needsText = customerTextRequired(group, optionId);
  const needsImage = group.requiresCustomerImage || Boolean(opt?.requiresCustomerImage);
  // Derive the admin-set text prompt + placeholder: option-level overrides group-level.
  const textPrompt =
    opt?.customerTextPromptAr ?? group.customerTextPromptAr ?? null;
  const textPlaceholder =
    opt?.customerTextPlaceholderAr ?? group.customerTextPlaceholderAr ?? null;

  const textMissing = needsText && !textValue?.trim();
  const imageMissing = needsImage && !value;

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const url = await uploadDesignImage(file);
      onChange(url);
      toast.success("تم رفع الصورة");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر رفع الصورة"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mt-3 rounded-2xl border border-orange/40 bg-orange/5 p-4 ring-1 ring-orange/10">
      <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
        <span aria-hidden className="h-2 w-2 rounded-full bg-brand-gradient" />
        {needsText ? (textPrompt ? textPrompt : "كتابة مطلوبة منك") : "صورة مطلوبة منك"}
        <span className="text-orange-ink">*</span>
      </p>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
        {needsText
          ? needsImage
            ? "اكتب التفاصيل المطلوبة وارفع صورة مرجعية — كلاهما مطلوب."
            : "اكتب التفاصيل المطلوبة."
          : "ارفع صورة مرجعية للطباعة — يختلف عن صورة التوضيح من الأدمن أدناه."}
      </p>

      {((group.hasImage && group.hintAr) || hintUrl) && (
        <div className="mt-3 rounded-xl border border-ink/10 bg-beige/80 p-2.5">
          <p className="text-[11px] font-medium text-[var(--shop-muted)]">
            صورة توضيحية
          </p>
          {group.hasImage && group.hintAr && (
            <p className="mt-1 text-xs text-ink-soft">{group.hintAr}</p>
          )}
          {hintUrl && (
            <div className="relative mt-2 h-28 w-full overflow-hidden rounded-lg bg-peach/30">
              <Image
                src={hintUrl}
                alt=""
                fill
                sizes="(max-width: 768px) calc(100vw - 4rem), 480px"
                className="object-contain"
              />
            </div>
          )}
        </div>
      )}

      {/* Embroidery text input — only shown when the option requires customer text */}
      {needsText && (
        <div className="mt-3">
          <label className="block text-xs font-semibold text-ink" htmlFor={`cust-text-${group.id}`}>
            {textPrompt ? textPrompt : "اكتب التفاصيل المطلوبة"}
            <span className="text-orange-ink"> *</span>
          </label>
          <textarea
            id={`cust-text-${group.id}`}
            dir="rtl"
            rows={3}
            placeholder={textPlaceholder || "اكتب هنا التفاصيل المطلوبة…"}
            value={textValue ?? ""}
            onChange={(e) => onTextChange?.(e.target.value)}
            className={`mt-1.5 w-full resize-none rounded-xl border px-3.5 py-3 text-sm leading-relaxed text-ink placeholder:text-ink/35 outline-none transition-colors focus:ring-2 focus:ring-orange/30 ${
              showErrors && textMissing
                ? "border-red-400 bg-red-50 focus:border-red-400"
                : "border-orange/40 bg-white focus:border-orange"
            }`}
          />
          {showErrors && textMissing && (
            <p role="alert" className="mt-1 text-xs font-medium text-red-500">
              يرجى كتابة التفاصيل المطلوبة
            </p>
          )}
        </div>
      )}

      {/* Image upload */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />

      {/* Image upload section — mandatory when needsImage, optional when only text is required */}
      <p className={`mt-3 text-xs font-semibold text-ink ${needsText ? "" : "sr-only"}`}>
        {needsText
          ? needsImage
            ? <>صورة مرجعية<span className="text-orange-ink"> *</span></>
            : "صورة مرجعية (اختياري)"
          : ""}
      </p>

      {previewUrl ? (
        <div className={needsText ? "mt-1.5" : "mt-3"}>
          <div className="relative h-36 w-full overflow-hidden rounded-xl border border-orange/30 bg-white shadow-[var(--shadow-soft)]">
            <Image
              src={previewUrl}
              alt="صورتك"
              fill
              sizes="(max-width: 768px) calc(100vw - 4rem), 480px"
              className="object-contain"
            />
          </div>
          <button
            type="button"
            className="mt-2 min-h-11 text-xs font-semibold text-orange-ink underline underline-offset-2"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            تغيير الصورة
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className={`mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-white text-sm font-semibold transition-colors disabled:opacity-50 ${
              showErrors && imageMissing
                ? "border-red-400 text-red-500 hover:border-red-500 hover:bg-red-50"
                : "border-orange/60 text-orange-ink hover:border-orange hover:bg-orange/5"
            }`}
          >
            {uploading ? (
              "جاري الرفع…"
            ) : (
              <>
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 16V4m0 0L8 8m4-4l4 4" />
                  <path d="M20 16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2" />
                </svg>
                اختر صورة من جهازك
              </>
            )}
          </button>
          {showErrors && imageMissing && (
            <p role="alert" className="mt-1 text-xs font-medium text-red-500">
              يرجى رفع صورة مرجعية
            </p>
          )}
        </>
      )}
    </div>
  );
}
