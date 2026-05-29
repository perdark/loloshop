"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { getHeroSlides, getShopFeed } from "@/lib/catalog";
import { SHOP_SECTION_TITLES, SHOP_TYPE_ORDER } from "@/lib/constants";
import type { HeroSlide, ProductType, ShopFeed, ShopProductCard } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { PackageTile, ProductTile } from "@/components/shop/ProductTile";
import { ShopCover } from "@/components/shop/ShopCover";
import { AtelierStory, MilestoneStory, DesignProcess } from "@/components/shop/BrandStory";

type FilterKey = "all" | ProductType;

/** featured pieces float to the front of any list */
function featuredFirst(list: ShopProductCard[]): ShopProductCard[] {
  return [...list].sort((a, b) => Number(b.featured) - Number(a.featured));
}

function ShopSkeleton() {
  return (
    <div className="animate-fade-page-in space-y-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">جارٍ تحميل المتجر…</span>
      <div className="full-bleed -mt-6 skeleton h-[78svh] max-h-[660px] min-h-[440px] !rounded-none" />
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-9 w-20 rounded-pill" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-7">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="space-y-2.5">
            <div className="skeleton aspect-[3/4] w-full rounded-[10px]" />
            <div className="skeleton h-4 w-2/3 rounded-pill" />
            <div className="skeleton h-3 w-1/2 rounded-pill" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StudentHomePage() {
  const [feed, setFeed] = useState<ShopFeed | null>(null);
  const [heroSlide, setHeroSlide] = useState<HeroSlide | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");

  function loadShop() {
    setLoading(true);
    setLoadError(null);
    // Hero is decorative — a failed slider must never block the catalog, so the
    // two requests settle independently.
    Promise.allSettled([getShopFeed(), getHeroSlides()])
      .then(([feedRes, heroRes]) => {
        if (feedRes.status === "fulfilled") {
          setFeed(feedRes.value);
        } else {
          const msg = getApiErrorMessage(
            feedRes.reason,
            "تعذر تحميل المتجر — تحقق من الاتصال بالخادم"
          );
          setLoadError(msg);
          toast.error(msg);
        }
        if (heroRes.status === "fulfilled") {
          const active = heroRes.value
            .filter((s) => s.active !== false)
            .sort((a, b) => a.sort - b.sort);
          setHeroSlide(active[0] ?? null);
        }
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount fetch
    loadShop();
  }, []);

  // Which categories actually have products — only those become chips.
  const availableTypes = useMemo<ProductType[]>(
    () => SHOP_TYPE_ORDER.filter((t) => (feed?.byType[t]?.length ?? 0) > 0),
    [feed]
  );

  // Flat, featured-first product list across every category (the "الكل" view).
  const allProducts = useMemo<ShopProductCard[]>(() => {
    if (!feed) return [];
    return availableTypes.flatMap((t) => featuredFirst(feed.byType[t] ?? []));
  }, [feed, availableTypes]);

  const visibleProducts = useMemo<ShopProductCard[]>(() => {
    if (!feed) return [];
    if (filter === "all") return allProducts;
    return featuredFirst(feed.byType[filter] ?? []);
  }, [feed, filter, allProducts]);

  if (loading) return <ShopSkeleton />;

  // Catalog failed to load — keep the cover and the designer path alive, surface
  // the error and a retry rather than dropping to a blank screen.
  if (!feed) {
    return (
      <div className="space-y-10">
        <ShopCover slide={null} />
        <div className="animate-step-in flex flex-col items-center gap-4 rounded-card border border-dashed border-orange/25 bg-beige/60 px-6 py-14 text-center">
          <span
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-full bg-orange/10 text-orange-ink"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
          </span>
          <p className="max-w-[34ch] text-sm font-medium text-ink-soft">{loadError}</p>
          <Button onClick={loadShop}>إعادة المحاولة</Button>
        </div>
      </div>
    );
  }

  const hasPackages = feed.packages.length > 0;
  const hasAnyProduct = allProducts.length > 0;
  const showPackages = hasPackages && filter === "all";

  return (
    <div className="space-y-12">
      <ShopCover slide={heroSlide} />

      {/* Brand story — feel the house (handmade · milestone · made to order)
          before the catalog. Renders even when the store is empty. */}
      <AtelierStory />
      <MilestoneStory />
      <DesignProcess />

      {/* Whole catalog still empty — the cover and designer carry the page. */}
      {!hasAnyProduct && !hasPackages ? (
        <section className="flex flex-col items-center gap-3 rounded-card border border-dashed border-orange/25 bg-[var(--shop-sink)] px-6 py-14 text-center">
          <p className="font-script text-3xl leading-none text-orange-ink">lolo</p>
          <p className="max-w-[32ch] text-sm font-medium text-ink-soft">
            المتجر يجهّز لموسم التخرّج 🎓 تابعونا على إنستغرام @loloshop96
          </p>
        </section>
      ) : (
        <>
          {/* Packages first — the full graduation look */}
          {showPackages && (
            <section className="space-y-4">
              <SectionHeading
                title="إطلالات كاملة"
                note="الروب والوشاح والقبعة، مجموعة واحدة"
              />
              <div className="grid grid-cols-2 gap-x-4 gap-y-7">
                {feed.packages.map((pkg) => (
                  <PackageTile key={pkg.id} pkg={pkg} />
                ))}
              </div>
            </section>
          )}

          {/* The collection — chips filter, tiles read like catalog pages */}
          <section className="space-y-5">
            <SectionHeading
              title="القطع"
              note={`${allProducts.length} قطعة لموسمك`}
            />

            {/* Category filter chips — only when there's more than one to pick */}
            {availableTypes.length > 1 && (
              <nav
                aria-label="تصفية حسب النوع"
                className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <Chip
                  label="الكل"
                  count={allProducts.length}
                  active={filter === "all"}
                  onClick={() => setFilter("all")}
                />
                {availableTypes.map((t) => (
                  <Chip
                    key={t}
                    label={SHOP_SECTION_TITLES[t]}
                    count={feed.byType[t]?.length ?? 0}
                    active={filter === t}
                    onClick={() => setFilter(t)}
                  />
                ))}
              </nav>
            )}

            {/* The grid — re-keyed on filter for a gentle crossfade between views */}
            {visibleProducts.length > 0 ? (
              <div
                key={filter}
                className="animate-fade-page-in grid grid-cols-2 gap-x-4 gap-y-7"
              >
                {visibleProducts.map((p) => (
                  <ProductTile key={p.id} product={p} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 rounded-card border border-dashed border-ink/15 bg-[var(--shop-sink)] px-6 py-12 text-center">
                <p className="max-w-[30ch] text-sm font-medium text-ink-soft">
                  لا يوجد منتجات في هذا القسم بعد.
                </p>
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className="rounded-pill bg-ink px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-ink-soft"
                >
                  عرض كل المنتجات
                </button>
              </div>
            )}
          </section>
        </>
      )}

      {/* Quiet, human close */}
      <footer className="mt-2 border-t border-ink/10 pt-8">
        <p className="font-script text-2xl leading-none text-orange-ink">لولو شوب</p>
        <p className="mt-3 max-w-[40ch] text-sm leading-relaxed text-ink-soft">
          تدفع نقداً وقت ما يوصلك — مثل ما تعوّدنا. أي سؤال؟ راسلنا على إنستغرام{" "}
          <a
            href="https://instagram.com/loloshop96"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-orange-ink underline underline-offset-2"
          >
            @loloshop96
          </a>
          .
        </p>
      </footer>
    </div>
  );
}

/** Section heading — Amiri title with a quiet supporting note, no eyebrow. */
function SectionHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="font-display text-xl font-bold leading-tight text-ink">{title}</h2>
      {note && (
        <span className="shrink-0 text-xs font-medium text-[var(--shop-muted)]">{note}</span>
      )}
    </div>
  );
}

function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-4 text-sm font-semibold transition-colors ${
        active
          ? "bg-orange-ink text-white"
          : "bg-beige text-ink-soft ring-1 ring-ink/10 hover:bg-[var(--shop-sink)]"
      }`}
    >
      {label}
      <span
        className={`text-[11px] tabular-nums ${active ? "text-white/70" : "text-[var(--shop-muted)]"}`}
      >
        {count}
      </span>
    </button>
  );
}
