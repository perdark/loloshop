"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { resolveCatalogMediaUrl } from "@/lib/catalog";
import { uploadDesignImage } from "@/lib/designer";

interface ReceiptUploadProps {
  /** The uploaded receipt image URL ("" / undefined when none). */
  value: string | undefined;
  onChange: (url: string) => void;
  /** Privileged editors can supply their own authenticated upload endpoint. */
  uploadImage?: (file: File) => Promise<string>;
}

/**
 * «صورة الوصل» — optional receipt/bill photo for retail robe orders. Some
 * students have a وصل and some don't, so this is never required. Reuses the
 * retail design-image upload endpoint; the URL rides the robe order's
 * measurements JSON (receipt_image_url).
 */
export function ReceiptUpload({
  value,
  onChange,
  uploadImage = uploadDesignImage,
}: ReceiptUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const previewUrl = value ? resolveCatalogMediaUrl(value) : null;

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const url = await uploadImage(file);
      onChange(url);
      toast.success("تم رفع صورة الوصل");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر رفع الصورة"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-line bg-beige/50 p-4">
      <p className="block text-sm font-semibold text-ink">
        صورة الوصل
        <span className="ms-1 text-xs font-normal text-ink-soft">(اختياري)</span>
      </p>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
        إن كان لديك وصل، أرفق صورته هنا.
      </p>

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
          <div className="relative h-36 w-full overflow-hidden rounded-xl border border-line bg-white shadow-[var(--shadow-soft)]">
            <Image
              src={previewUrl}
              alt="صورة الوصل"
              fill
              sizes="(max-width: 768px) calc(100vw - 4rem), 480px"
              className="object-contain"
            />
          </div>
          <div className="mt-2 flex items-center gap-4">
            <button
              type="button"
              className="min-h-11 text-xs font-semibold text-orange-ink underline underline-offset-2"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              تغيير الصورة
            </button>
            <button
              type="button"
              className="min-h-11 text-xs font-semibold text-ink-soft underline underline-offset-2 hover:text-danger"
              disabled={uploading}
              onClick={() => onChange("")}
            >
              إزالة
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-white text-sm font-semibold text-ink-soft transition-colors hover:border-orange/50 hover:text-orange-ink disabled:opacity-50"
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
