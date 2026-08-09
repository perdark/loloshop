"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { getUser } from "@/lib/auth";
import { getShopFeed } from "@/lib/catalog";
import { SHOP_SECTION_TITLES, SHOP_TYPE_ORDER } from "@/lib/constants";
import { featuredFirst, interleaveByType } from "@/lib/shop-sort";
import { modelsCount } from "@/lib/copy-ar";
import type { ProductType, ShopFeed, ShopProductCard } from "@/lib/types";
import { ProductTile } from "@/components/shop/ProductTile";
import { Button } from "@/components/ui/Button";

type FilterKey = "all" | ProductType;

/**
 * The full catalog: type chips + search + grid. This is the body of «القطع».
 *
 * It reads `?type=` (so «كل الأوشحة» on the home sliders lands pre-filtered) and
 * `?focus=search` (so the top bar's search button lands with the field focused —
 * the bar is a button, not an input, so that there is exactly one search
 * implementation in the app rather than one per screen).
 */
interface CatalogBrowserProps {
  /**
   * Feed fetched by the parent Server Component. `null` only when the API was
   * unreachable at render time, in which case this falls back to fetching in an
   * effect exactly as it used to.
   *
   * Why it is passed in: the first grid tiles were the LCP element and lazy-loaded,
   * because nothing could request them until the client had hydrated and fetched.
   * Handing the data down means the tiles are in the server HTML.
   */
  initialFeed?: ShopFeed | null;
}

export function CatalogBrowser({ initialFeed = null }: CatalogBrowserProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [feed, setFeed] = useState<ShopFeed | null>(initialFeed);
  const [loading, setLoading] = useState(initialFeed === null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    getShopFeed()
      .then((data) => {
        // Wholesaler-students have no product grid — they order through the طقم form.
        if (data.audience === "wholesaler_student") {
          router.replace("/my-order");
          return;
        }
        setFeed(data);
      })
      .catch((reason) => {
        const msg = getApiErrorMessage(
          reason,
          "تعذر تحميل المتجر — تحقق من الاتصال بالخادم"
        );
        setLoadError(msg);
        toast.error(msg);
      })
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!feed) {
      // Server fetch failed — fall back to the old client path.
      load();
      return;
    }
    // ⚠️ Same rep-linked-student hazard as the home page: the server fetches
    // anonymously, so `initialFeed.audience` is always "guest". Identical output
    // for guests and ordinary retail students, but a rep-linked student belongs on
    // /my-order and nothing would otherwise re-check. Only runs when signed in;
    // does not gate the render, and the backend answer is memo-cached for 120 s.
    if (!getUser()) return;
    let cancelled = false;
    getShopFeed()
      .then((fresh) => {
        if (cancelled) return;
        if (fresh.audience === "wholesaler_student") {
          router.replace("/my-order");
          return;
        }
        setFeed(fresh);
      })
      .catch(() => {
        // Keep the server-rendered feed — a failed background check must never
        // blank a grid that is already on screen.
      });
    return () => {
      cancelled = true;
    };
    // Runs once on mount: re-running whenever `feed` changes would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, router]);

  // Honour ?type= and ?focus=search once, on arrival.
  useEffect(() => {
    const type = searchParams.get("type");
    if (type && (SHOP_TYPE_ORDER as string[]).includes(type)) {
      setFilter(type as ProductType);
    }
    if (searchParams.get("focus") === "search") {
      // The field only exists once the feed has rendered the toolbar, so defer.
      const t = window.setTimeout(() => searchRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
  }, [searchParams]);

  const availableTypes = useMemo<ProductType[]>(
    () => SHOP_TYPE_ORDER.filter((t) => (feed?.byType[t]?.length ?? 0) > 0),
    [feed]
  );

  const allProducts = useMemo<ShopProductCard[]>(() => {
    if (!feed) return [];
    return interleaveByType(availableTypes.map((t) => featuredFirst(feed.byType[t] ?? [])));
  }, [feed, availableTypes]);

  const visibleProducts = useMemo<ShopProductCard[]>(() => {
    if (!feed) return [];
    const base =
      filter === "all" ? allProducts : featuredFirst(feed.byType[filter] ?? []);
    const needle = q.trim();
    if (!needle) return base;
    return base.filter((p) => p.nameAr.includes(needle));
  }, [feed, filter, allProducts, q]);

  if (loading) {
    return (
      <div className="animate-fade-page-in space-y-6 py-4" aria-busy="true" aria-live="polite">
        <span className="sr-only">جارٍ تحميل القطع…</span>
        <div className="skeleton h-8 w-32 rounded-pill" />
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-9 w-20 rounded-pill" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-7 md:grid-cols-3 lg:grid-cols-4">
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

  if (!feed) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-card border border-dashed border-orange/25 bg-beige/60 px-6 py-14 text-center">
        <p className="max-w-[34ch] text-sm font-medium text-ink-soft">{loadError}</p>
        <Button onClick={load}>إعادة المحاولة</Button>
      </div>
    );
  }

  return (
    <div className="animate-fade-page-in space-y-5 py-2">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="font-display-ar text-[clamp(1.6rem,4.5vw,2.4rem)] font-bold leading-tight text-ink">
          القطع
        </h1>
        <span className="shrink-0 text-sm font-medium text-[var(--shop-muted)]">
          {modelsCount(allProducts.length)}
        </span>
      </div>

      <label className="sr-only" htmlFor="shop-search">
        ابحث عن قطعة
      </label>
      <div className="relative">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="pointer-events-none absolute inset-y-0 start-3.5 my-auto h-4 w-4 text-[var(--shop-muted)]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          id="shop-search"
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          type="search"
          placeholder="دوّر على وشاح، روب، قبعة…"
          /* 16px base — a smaller font makes iOS Safari zoom on focus. */
          className="min-h-11 w-full rounded-pill border border-line bg-beige ps-10 pe-4 text-base font-semibold text-ink placeholder:text-[13.5px] placeholder:font-medium placeholder:text-[var(--shop-muted)] focus-visible:border-orange-ink focus-visible:outline-none"
        />
      </div>

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

      {visibleProducts.length > 0 ? (
        <div
          key={`${filter}-${q}`}
          className="animate-fade-page-in grid grid-cols-2 gap-x-4 gap-y-7 md:grid-cols-3 md:gap-x-6 md:gap-y-10 lg:grid-cols-4"
        >
          {visibleProducts.map((p) => (
            <ProductTile key={p.id} product={p} from="shop" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-card border border-dashed border-ink/15 px-6 py-12 text-center">
          <p className="max-w-[30ch] text-sm font-medium text-ink-soft">
            {q.trim()
              ? `ما لگينا قطعة باسم «${q.trim()}».`
              : "لا يوجد منتجات في هذا القسم بعد."}
          </p>
          <button
            type="button"
            onClick={() => {
              setFilter("all");
              setQ("");
            }}
            className="inline-flex min-h-11 items-center rounded-pill bg-ink px-5 py-2 text-sm font-semibold text-cream transition-colors hover:bg-ink/80"
          >
            عرض كل القطع
          </button>
        </div>
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
