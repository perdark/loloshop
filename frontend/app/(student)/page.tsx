"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { getShopFeed } from "@/lib/catalog";
import { SHOP_SECTION_TITLES, SHOP_TYPE_ORDER } from "@/lib/constants";
import type { GenderRestriction, ProductType, ShopFeed } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShowMoreGrid } from "@/components/shop/ShowMoreGrid";
import { ShopProductCardLink } from "@/components/shop/ShopProductCard";
import { ShopPackageCardView } from "@/components/shop/ShopPackageCard";

const GENDER_KEY = "loloshop_student_gender";
const LEGACY_GENDER_KEY = "gender";
const INITIAL_PACKAGES = 3;
const INITIAL_PER_TYPE = 6;

function readStoredGender(): "male" | "female" | "" {
  if (typeof window === "undefined") return "";
  for (const key of [GENDER_KEY, LEGACY_GENDER_KEY]) {
    const saved = localStorage.getItem(key);
    if (saved === "male" || saved === "female") return saved;
  }
  return "";
}

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

export default function StudentHomePage() {
  const [feed, setFeed] = useState<ShopFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gender, setGender] = useState<"male" | "female" | "">(readStoredGender);
  const [loggedIn] = useState(
    () => typeof window !== "undefined" && !!localStorage.getItem("token")
  );

  function loadShop() {
    setLoading(true);
    setLoadError(null);
    getShopFeed()
      .then(setFeed)
      .catch((e) => {
        const msg = getApiErrorMessage(
          e,
          "تعذر تحميل المتجر — تحقق من الاتصال بالخادم"
        );
        setLoadError(msg);
        toast.error(msg);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount fetch
    loadShop();
  }, []);

  const hasSash = useMemo(
    () => (feed?.byType?.sash?.length ?? 0) > 0,
    [feed]
  );

  const hasAnyProducts = useMemo(() => {
    if (!feed) return false;
    return SHOP_TYPE_ORDER.some((t) => (feed.byType[t]?.length ?? 0) > 0);
  }, [feed]);

  if (loading) return <PageLoader />;

  if (!feed) {
    return (
      <div className="space-y-4 px-2 py-8 text-center">
        <p className="text-sm text-ink/70">{loadError}</p>
        <Button onClick={loadShop}>إعادة المحاولة</Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-brand-gradient p-6 text-center text-white">
        <p className="font-display text-xl font-bold">تخرّجك يستاهل الفخامة</p>
        <p className="mt-2 text-sm opacity-90">أوشحة وروبات تخرج — صمّم وشاحك بأسلوبك</p>
        {hasSash && (
          <>
            <Link
              href="/design"
              className="mt-4 inline-flex min-h-12 items-center justify-center rounded-lg bg-white px-6 font-semibold text-orange-ink shadow-sm"
            >
              صمّم وشاحك
            </Link>
            <p className="mx-auto mt-3 max-w-sm text-xs leading-relaxed opacity-90">
              يتطلب تسجيل الدخول كطالب، وإن كنت مرتبطاً بممثل جامعة فبانتظار
              موافقته قبل فتح المصمّم.
              {!loggedIn && (
                <>
                  {" "}
                  <Link href="/login" className="font-semibold underline">
                    تسجيل الدخول
                  </Link>
                </>
              )}
            </p>
          </>
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
                localStorage.setItem(LEGACY_GENDER_KEY, g);
              }}
              className={`min-h-11 flex-1 rounded-lg border text-sm font-semibold ${
                gender === g
                  ? "border-orange bg-orange/10 text-orange-ink"
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

      {!hasAnyProducts && feed.packages.length === 0 && (
        <EmptyState message="لا منتجات متاحة حالياً" />
      )}

      <div className="text-center">
        <Link href="/sizes" className="text-sm text-orange-ink hover:underline">
          جدول المقاسات (روب + قبعة)
        </Link>
      </div>

      <p className="text-center text-xs text-ink/50">
        الدفع نقداً عند الاستلام — لا دفع إلكتروني
      </p>
    </div>
  );
}
