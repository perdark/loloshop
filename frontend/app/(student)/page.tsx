"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, Suspense } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import {
  clearSkipDashboardRedirect,
  dashboardPathFor,
  getUser,
  shouldSkipDashboardRedirect,
} from "@/lib/auth";
import { getShopFeed } from "@/lib/catalog";
import { SHOP_SECTION_TITLES, SHOP_TYPE_ORDER } from "@/lib/constants";
import type { ProductType, ShopFeed, ShopProductCard } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { ProductTile } from "@/components/shop/ProductTile";
import { ShopCover } from "@/components/shop/ShopCover";
import { AtelierStory, MilestoneStory, DesignProcess } from "@/components/shop/BrandStory";
import { VipHomeBand } from "@/components/vip/VipHomeBand";
import { FullSetBand } from "@/components/shop/FullSetBand";

type FilterKey = "all" | ProductType;

/** featured pieces float to the front of any list */
function featuredFirst(list: ShopProductCard[]): ShopProductCard[] {
  return [...list].sort((a, b) => Number(b.featured) - Number(a.featured));
}

/**
 * Round-robin interleave across type buckets: bucket0[0], bucket1[0], …,
 * bucket0[1], bucket1[1], … so the "all" grid alternates categories
 * (sash, cap, robe, sash, …) instead of showing each type in a block.
 * Deterministic — guarantees a mixed look with no clumping (which a random
 * shuffle can't promise) and no hydration mismatch.
 */
function interleaveByType(buckets: ShopProductCard[][]): ShopProductCard[] {
  const out: ShopProductCard[] = [];
  const max = buckets.reduce((m, b) => Math.max(m, b.length), 0);
  for (let i = 0; i < max; i++) {
    for (const b of buckets) {
      if (i < b.length) out.push(b[i]);
    }
  }
  return out;
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

/**
 * Reads the `?need=` search param and calls back into the parent page.
 * Must live inside a <Suspense> boundary (Next 16 requirement for useSearchParams).
 */
function NeedParamReader({
  onNeed,
}: {
  onNeed: (types: ProductType[]) => void;
}) {
  const searchParams = useSearchParams();
  const onNeedRef = useRef(onNeed);

  useLayoutEffect(() => {
    onNeedRef.current = onNeed;
  });

  useEffect(() => {
    const raw = searchParams.get("need");
    if (!raw) return;
    const types = raw
      .split(",")
      .filter((t): t is ProductType =>
        (["sash", "robe", "cap", "shawl"] as string[]).includes(t)
      );
    if (types.length > 0) onNeedRef.current(types);
  }, [searchParams]);

  return null;
}

export default function StudentHomePage() {
  const router = useRouter();
  const [feed, setFeed] = useState<ShopFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  // Admin/staff on "/": redirect to their panel, unless they explicitly
  // chose "زيارة الموقع الرئيسي" — then show a return pill instead.
  const [redirecting, setRedirecting] = useState(false);
  const [panelHref, setPanelHref] = useState<string | null>(null);
  const catalogSectionRef = useRef<HTMLElement | null>(null);

  /**
   * Called by NeedParamReader when ?need= is present.
   * Pre-filters the grid to the first requested type and smooth-scrolls
   * to the catalog section. Respects prefers-reduced-motion.
   */
  const handleNeed = useCallback((types: ProductType[]) => {
    if (types.length > 0) setFilter(types[0]);
    const el = catalogSectionRef.current;
    if (!el) return;
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    el.scrollIntoView({
      behavior: prefersReduced ? "auto" : "smooth",
      block: "start",
    });
  }, []);

  const loadShop = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    getShopFeed()
      .then((feedData) => {
        // Wholesaler-students have no product grid — send them straight to the
        // طقم order form (the WhatsApp intake form), not the shop/package picker.
        if (feedData.audience === "wholesaler_student") {
          router.replace("/my-order");
          return;
        }
        setFeed(feedData);
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
    const href = dashboardPathFor(getUser()?.role);
    if (href) {
      if (!shouldSkipDashboardRedirect()) {
        setRedirecting(true);
        router.replace(href);
        return;
      }
      setPanelHref(href);
    }
    loadShop();
  }, [loadShop, router]);

  // A detail-page back button lands here as «/#catalog», but the grid only renders
  // AFTER the async feed loads — so the browser's native hash-scroll finds no target
  // at navigation time and stays at the top. Once the feed (and the section) exist,
  // honour the hash ourselves. Respects prefers-reduced-motion.
  useEffect(() => {
    if (!feed || typeof window === "undefined") return;
    if (window.location.hash !== "#catalog") return;
    const el = catalogSectionRef.current;
    if (!el) return;
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    requestAnimationFrame(() => {
      el.scrollIntoView({
        behavior: prefersReduced ? "auto" : "smooth",
        block: "start",
      });
    });
  }, [feed]);

  // Which categories actually have products — only those become chips.
  const availableTypes = useMemo<ProductType[]>(
    () => SHOP_TYPE_ORDER.filter((t) => (feed?.byType[t]?.length ?? 0) > 0),
    [feed]
  );

  // Interleaved product list across every category (the "الكل" view) — mixes
  // types so it never reads as "4 sashes, then 2 caps, then 5 robes".
  const allProducts = useMemo<ShopProductCard[]>(() => {
    if (!feed) return [];
    return interleaveByType(availableTypes.map((t) => featuredFirst(feed.byType[t] ?? [])));
  }, [feed, availableTypes]);

  const visibleProducts = useMemo<ShopProductCard[]>(() => {
    if (!feed) return [];
    if (filter === "all") return allProducts;
    return featuredFirst(feed.byType[filter] ?? []);
  }, [feed, filter, allProducts]);

  if (loading || redirecting) return <ShopSkeleton />;

  // Admin/staff browsing the shop on purpose — floating pill back to their
  // panel; clicking it re-arms the auto-redirect on "/".
  // Portaled to <body>: <main> is transformed (animate-page-in), which would
  // otherwise hijack position:fixed and pin the pill to the page bottom.
  const returnPill = panelHref ? createPortal(
    <button
      type="button"
      onClick={() => {
        clearSkipDashboardRedirect();
        router.push(panelHref);
      }}
      className="fixed bottom-5 left-1/2 z-50 flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-pill bg-brand-gradient px-5 py-2.5 text-sm font-bold text-white shadow-[var(--shadow-float)] transition-transform hover:scale-[1.03]"
    >
      <span aria-hidden>→</span>
      {panelHref === "/admin" ? "العودة للوحة التحكم" : "العودة لصفحة الموظف"}
    </button>,
    document.body
  ) : null;

  // Catalog failed to load — keep the cover and the designer path alive, surface
  // the error and a retry rather than dropping to a blank screen.
  if (!feed) {
    return (
      <div className="space-y-10">
        {returnPill}
        <ShopCover />
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

  const hasAnyProduct = allProducts.length > 0;
  // Packages are NOT shown on the home feed for retail — they surface only
  // inside the cart as a single "complete your package" suggestion card.

  return (
    <div className="animate-fade-page-in space-y-0">
      {returnPill}
      {/* NeedParamReader must be inside Suspense — Next 16 requires it for useSearchParams */}
      <Suspense fallback={null}>
        <NeedParamReader onNeed={handleNeed} />
      </Suspense>

      <ShopCover />

      {/* ── Brand story band 1: The atelier — full paper, generous padding ── */}
      <section className="py-14 sm:py-20">
        <div className="scroll-reveal">
          <AtelierStory />
        </div>
      </section>

      {/* ── VIP highlight — one editorial band → the VIP showcase (renders nothing if no VIP) ── */}
      <VipHomeBand />

      {/* ── Brand story band 2: Milestone gallery — same cream canvas (one flat bg) ── */}
      <section className="py-14 sm:py-20">
        <div className="mx-auto max-w-2xl px-4 sm:px-6 scroll-reveal-soft">
          <MilestoneStory />
        </div>
      </section>

      {/* ── Brand story band 3: Design process — back on paper ── */}
      <section className="py-14 sm:py-20">
        <div className="scroll-reveal">
          <DesignProcess />
        </div>
      </section>

      {/* ── Full graduation set band ── */}
      <FullSetBand />

      {/* ── Catalog separator ── */}
      <div className="full-bleed h-px bg-line" aria-hidden />

      {/* ── Catalog area — padded section so it breathes like a page turn ── */}
      <section id="catalog" ref={catalogSectionRef} className="space-y-12 py-12 sm:py-16">

      {/* Whole catalog still empty — the cover and designer carry the page. */}
      {!hasAnyProduct ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-orange/25 px-6 py-14 text-center">
          <p className="font-script text-3xl leading-none text-orange-ink">lolo</p>
          <p className="max-w-[32ch] text-sm font-medium text-ink-soft">
            المتجر يجهّز لموسم التخرّج، تابعونا على إنستغرام @loloshop96
          </p>
        </div>
      ) : (
        <>
          {/* The collection — chips filter, tiles read like catalog pages */}
          <div className="scroll-reveal space-y-5">
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
                className="animate-fade-page-in grid grid-cols-2 gap-x-4 gap-y-7 md:grid-cols-3 md:gap-x-6 md:gap-y-10 lg:grid-cols-4"
              >
                {visibleProducts.map((p) => (
                  <ProductTile key={p.id} product={p} from="catalog" />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 rounded-card border border-dashed border-ink/15 px-6 py-12 text-center">
                <p className="max-w-[30ch] text-sm font-medium text-ink-soft">
                  لا يوجد منتجات في هذا القسم بعد.
                </p>
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className="inline-flex min-h-11 items-center rounded-pill bg-ink px-5 py-2 text-sm font-semibold text-cream transition-colors hover:bg-ink/80"
                >
                  عرض كل المنتجات
                </button>
              </div>
            )}
          </div>
        </>
      )}

      </section>

      {/* Quiet, human close — same cream canvas, a hairline rule sets it apart */}
      <footer className="full-bleed mt-0 border-t border-line px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-script text-3xl leading-none text-orange-ink">lolo shop</p>
          <p className="mt-4 max-w-[40ch] text-sm leading-relaxed text-ink-soft mx-auto">
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
          <p className="mt-4 text-xs text-[var(--shop-muted)]">الدفع نقداً عند الاستلام</p>
        </div>
      </footer>
    </div>
  );
}

/**
 * Choreographed heading — enters with a mask-reveal (translateY + opacity)
 * via IntersectionObserver + the .reveal / .reveal-in CSS pair from globals.css.
 * Content is visible by default (no hidden initial state unless JS + IO fires).
 * prefers-reduced-motion: the transition is 0ms so it snaps rather than animates.
 */
function RevealHeading({
  children,
  as: Tag = "h2",
  className = "",
}: {
  children: React.ReactNode;
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.add("reveal");
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("reveal-in");
          io.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as React.RefObject<HTMLHeadingElement>}
      className={className}
    >
      {children}
    </Tag>
  );
}

/** Section heading — confident Amiri display title with a quiet supporting note,
 *  no eyebrow. Scale matches the brand-story headlines so the page reads as one
 *  couture system rather than dropping to a small UI label at the catalog. */
function SectionHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <RevealHeading
        as="h2"
        className="text-balance font-display-ar text-[clamp(1.6rem,4.5vw,2.4rem)] font-bold leading-tight text-ink"
      >
        {title}
      </RevealHeading>
      {note && (
        <span className="shrink-0 text-sm font-medium text-[var(--shop-muted)]">{note}</span>
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
