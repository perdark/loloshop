"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getShopFeed } from "@/lib/catalog";
import { SHOP_SECTION_TITLES, SHOP_TYPE_ORDER } from "@/lib/constants";
import type { GenderRestriction, ProductType, ShopFeed } from "@/lib/types";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShowMoreGrid } from "@/components/shop/ShowMoreGrid";
import { ShopProductCardLink } from "@/components/shop/ShopProductCard";
import { ShopPackageCardView } from "@/components/shop/ShopPackageCard";

const GENDER_KEY = "loloshop_student_gender";
const INITIAL_PACKAGES = 3;
const INITIAL_PER_TYPE = 4;

function filterByGender<T extends { genderRestriction: GenderRestriction }>(
  items: T[],
  gender: "male" | "female" | ""
): T[] {
  return items.filter((p) => {
    if (!p.genderRestriction) return true;
    if (!gender) return true;
    return p.genderRestriction === gender;
  });
}

export default function ShopHomePage() {
  const [feed, setFeed] = useState<ShopFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [gender, setGender] = useState<"male" | "female" | "">("");

  useEffect(() => {
    const saved = localStorage.getItem(GENDER_KEY) as "male" | "female" | "";
    if (saved === "male" || saved === "female") setGender(saved);
  }, []);

  useEffect(() => {
    getShopFeed()
      .then(setFeed)
      .catch(() => toast.error("تعذر تحميل المتجر"))
      .finally(() => setLoading(false));
  }, []);

  const sashProduct = useMemo(() => {
    const list = feed?.byType?.sash ?? [];
    return list.find((p) => p.customizable) ?? list[0];
  }, [feed]);

  const hasAnyProducts = useMemo(() => {
    if (!feed) return false;
    return SHOP_TYPE_ORDER.some((t) => (feed.byType[t]?.length ?? 0) > 0);
  }, [feed]);

  if (loading || !feed) return <PageLoader />;

  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-brand-gradient p-6 text-center text-white">
        <p className="font-display text-xl font-bold">تخرّجك يستاهل الفخامة</p>
        <p className="mt-2 text-sm opacity-90">الهوية البصرية — أناقة ودفء</p>
        {sashProduct && (
          <Link
            href={`/product/${sashProduct.id}`}
            className="mt-4 inline-flex min-h-12 items-center justify-center rounded-lg bg-white px-6 font-semibold text-orange shadow-sm"
          >
            صمّم وشاحك
          </Link>
        )}
      </section>

      <div className="rounded-xl border border-ink/10 bg-beige p-4">
        <p className="mb-2 text-sm font-medium text-ink">الجنس (للمنتجات المخصصة)</p>
        <div className="flex gap-2">
          {(["male", "female"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => {
                setGender(g);
                localStorage.setItem(GENDER_KEY, g);
              }}
              className={`min-h-11 flex-1 rounded-lg border text-sm font-semibold ${
                gender === g
                  ? "border-orange bg-orange/10 text-orange"
                  : "border-neutral bg-cream"
              }`}
            >
              {g === "male" ? "ذكر" : "أنثى"}
            </button>
          ))}
        </div>
      </div>

      {feed.packages.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-lg font-bold text-ink">الباكجات</h2>
          <ShowMoreGrid
            items={feed.packages}
            initialCount={INITIAL_PACKAGES}
            getKey={(p) => p.id}
            renderItem={(pkg) => <ShopPackageCardView pkg={pkg} />}
          />
        </section>
      )}

      {SHOP_TYPE_ORDER.map((type) => {
        const raw = feed.byType[type] ?? [];
        const products = filterByGender(raw, gender);
        if (products.length === 0) return null;

        const featured = products.filter((p) => p.featured);
        const rest = products.filter((p) => !p.featured);
        const ordered = [...featured, ...rest];

        return (
          <section key={type}>
            <h2 className="mb-3 font-display text-lg font-bold text-ink">
              {SHOP_SECTION_TITLES[type as ProductType]}
            </h2>
            <ShowMoreGrid
              items={ordered}
              initialCount={INITIAL_PER_TYPE}
              getKey={(p) => p.id}
              renderItem={(p) => <ShopProductCardLink product={p} />}
            />
          </section>
        );
      })}

      {!hasAnyProducts && (
        <EmptyState message="لا منتجات متاحة حالياً" />
      )}

      <p className="text-center text-xs text-ink/50">
        الدفع نقداً عند الاستلام — لا دفع إلكتروني
      </p>
    </div>
  );
}
