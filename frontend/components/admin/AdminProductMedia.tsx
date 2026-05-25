"use client";

import Image from "next/image";
import { useState } from "react";
import { toast } from "sonner";
import {
  addProductImage,
  deleteProductImage,
  resolveCatalogMediaUrl,
  setProductMainImage,
  updateCatalogProduct,
  uploadCatalogImage,
} from "@/lib/catalog";
import { getApiErrorMessage } from "@/lib/api";
import type { CatalogProduct, CatalogProductSummary } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

interface AdminProductMediaProps {
  summary: CatalogProductSummary | undefined;
  product: CatalogProduct | null;
  onUpdated: () => void;
}

export function AdminProductMedia({
  summary,
  product,
  onUpdated,
}: AdminProductMediaProps) {
  const [uploading, setUploading] = useState(false);

  if (!summary || !product) return null;

  async function handleMainUpload(file: File) {
    setUploading(true);
    try {
      const url = await uploadCatalogImage(file);
      await setProductMainImage(product!.id, url);
      toast.success("تم تعيين الصورة الرئيسية");
      onUpdated();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر رفع الصورة"));
    } finally {
      setUploading(false);
    }
  }

  async function handleGalleryUpload(file: File) {
    setUploading(true);
    try {
      const url = await uploadCatalogImage(file);
      await addProductImage(product!.id, url, product!.images.length);
      toast.success("أُضيفت للمعرض");
      onUpdated();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر الإضافة"));
    } finally {
      setUploading(false);
    }
  }

  async function toggleFeatured(checked: boolean) {
    try {
      await updateCatalogProduct(product!.id, { featured: checked });
      onUpdated();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر التحديث"));
    }
  }

  async function saveSort(sort: number) {
    try {
      await updateCatalogProduct(product!.id, { sort });
      onUpdated();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر التحديث"));
    }
  }

  const mainSrc = resolveCatalogMediaUrl(product.imageUrl);

  return (
    <section className="mb-6 rounded-xl border border-orange/20 bg-peach/20 p-4">
      <h3 className="mb-3 font-display text-base font-bold text-ink">
        الصور والعرض
      </h3>

      <div className="flex flex-wrap gap-4">
        <div className="relative h-28 w-28 overflow-hidden rounded-lg bg-beige ring-1 ring-ink/10">
          {mainSrc ? (
            <Image src={mainSrc} alt="" fill className="object-cover" unoptimized />
          ) : (
            <span className="flex h-full items-center justify-center text-xs text-ink/40">
              لا صورة
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <label className="cursor-pointer text-orange underline">
            رفع صورة رئيسية
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleMainUpload(f);
                e.target.value = "";
              }}
            />
          </label>
          <label className="cursor-pointer text-orange underline">
            إضافة للمعرض
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleGalleryUpload(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={product.featured ?? false}
            onChange={(e) => toggleFeatured(e.target.checked)}
            className="accent-orange"
          />
          منتج مميز
        </label>
        <label className="flex items-center gap-2 text-sm">
          ترتيب
          <Input
            type="number"
            className="w-20"
            defaultValue={product.sort ?? 0}
            onBlur={(e) => saveSort(Number(e.target.value) || 0)}
          />
        </label>
        <span className="text-xs text-ink/50">
          {summary.imageCount} صورة في المعرض
        </span>
      </div>

      {product.images.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {product.images.map((img) => (
            <li key={img.id} className="relative">
              <div className="relative h-16 w-16 overflow-hidden rounded-lg ring-1 ring-ink/10">
                <Image
                  src={resolveCatalogMediaUrl(img.url) || img.url}
                  alt=""
                  fill
                  className="object-cover"
                  unoptimized
                />
              </div>
              <Button
                variant="ghost"
                className="!mt-1 !min-h-7 !px-1 !text-xs text-red-700"
                onClick={async () => {
                  try {
                    await deleteProductImage(img.id);
                    onUpdated();
                  } catch (e) {
                    toast.error(getApiErrorMessage(e, "تعذر الحذف"));
                  }
                }}
              >
                حذف
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
