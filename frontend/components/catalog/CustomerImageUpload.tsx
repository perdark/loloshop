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
    <div className="mt-3 rounded-lg border-2 border-orange/50 bg-orange/5 p-3">
      <p className="text-sm font-semibold text-ink">
        صورة مطلوبة منك
        <span className="mr-1 text-orange">*</span>
      </p>
      <p className="mt-0.5 text-xs text-ink/55">
        ارفع صورة مرجعية للطباعة — يختلف عن صورة التوضيح من الأدمن أدناه.
      </p>

      {(group.hintAr || hintUrl) && (
        <div className="mt-3 rounded-md border border-ink/10 bg-beige/80 p-2">
          <p className="text-[11px] font-medium text-ink/50">
            صورة توضيحية من الأدمن (للتوجيه فقط)
          </p>
          {group.hintAr && (
            <p className="mt-1 text-xs text-ink/70">{group.hintAr}</p>
          )}
          {hintUrl && (
            <div className="relative mt-2 h-28 w-full overflow-hidden rounded-md bg-peach/30">
              <Image
                src={hintUrl}
                alt=""
                fill
                className="object-contain"
                unoptimized
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
          <div className="relative h-36 w-full overflow-hidden rounded-lg border border-orange/30 bg-white">
            <Image
              src={previewUrl}
              alt="صورتك"
              fill
              className="object-contain"
              unoptimized
            />
          </div>
          <button
            type="button"
            className="mt-2 text-xs text-orange underline"
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
          className="mt-3 flex min-h-12 w-full items-center justify-center rounded-lg border border-dashed border-orange bg-white text-sm font-medium text-orange disabled:opacity-50"
        >
          {uploading ? "جاري الرفع…" : "اختر صورة من جهازك"}
        </button>
      )}
    </div>
  );
}
