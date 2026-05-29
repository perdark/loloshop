"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { resolveCatalogMediaUrl } from "@/lib/catalog";
import { uploadDesignImage } from "@/lib/designer";
import type { CatalogOptionGroup } from "@/lib/types";

interface CustomerImageUploadProps {
  group: CatalogOptionGroup;
  optionId: string;
  value: string | undefined;
  onChange: (url: string) => void;
}

export function CustomerImageUpload({
  group,
  optionId,
  value,
  onChange,
}: CustomerImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const opt = group.options.find((o) => o.id === optionId);
  const hintUrl = group.imageUrl || opt?.imageUrl || null;
  const previewUrl = value ? resolveCatalogMediaUrl(value) : null;

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
        صورة مطلوبة منك
        <span className="text-orange-ink">*</span>
      </p>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
        ارفع صورة مرجعية للطباعة — يختلف عن صورة التوضيح من الأدمن أدناه.
      </p>

      {(group.hintAr || hintUrl) && (
        <div className="mt-3 rounded-xl border border-ink/10 bg-beige/80 p-2.5">
          <p className="text-[11px] font-medium text-[var(--shop-muted)]">
            صورة توضيحية من الأدمن (للتوجيه فقط)
          </p>
          {group.hintAr && (
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

      {previewUrl ? (
        <div className="mt-3">
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
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-orange/60 bg-white text-sm font-semibold text-orange-ink transition-colors hover:border-orange hover:bg-orange/5 disabled:opacity-50"
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
      )}
    </div>
  );
}
