"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProductTile } from "@/components/shop/ProductTile";
import { modelsCount } from "@/lib/copy-ar";
import { formatIQD } from "@/lib/format";
import type { ProductType, ShopProductCard } from "@/lib/types";

/**
 * One horizontal rail per product family (أوشحة · روبات · قبعات · شالات).
 *
 * The storefront-D thesis is speed: goods above the fold, and the story told in
 * the gaps BETWEEN the rails rather than in a hero that pushes product down.
 *
 * Cards are 60% wide so the next one always peeks — that peek is the only
 * affordance that says "this scrolls" on a touch screen with no scrollbar.
 */
export function FamilySlider({
  type,
  title,
  products,
  seeAllLabel,
}: {
  type: ProductType;
  title: string;
  products: ShopProductCard[];
  seeAllLabel: string;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const sync = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const max = rail.scrollWidth - rail.clientWidth;
    // RTL: Chrome reports scrollLeft as 0 → -max, so compare on the magnitude.
    const pos = Math.abs(rail.scrollLeft);
    setAtStart(pos <= 2);
    setAtEnd(pos >= max - 2);
  }, []);

  useEffect(() => {
    sync();
  }, [sync, products.length]);

  function scrollByCard(dir: "prev" | "next") {
    const rail = railRef.current;
    if (!rail) return;
    const card = rail.querySelector<HTMLElement>("[data-card]");
    const gap = parseFloat(getComputedStyle(rail).columnGap || "12") || 12;
    const step = card ? card.getBoundingClientRect().width + gap : 200;
    // "next" is visually leftward in RTL, which is a NEGATIVE scroll delta.
    rail.scrollBy({ left: (dir === "next" ? -1 : 1) * step, behavior: "smooth" });
  }

  if (products.length === 0) return null;

  const lowest = products.reduce(
    (min, p) => Math.min(min, p.basePrice),
    Number.POSITIVE_INFINITY
  );

  return (
    <section aria-labelledby={`fam-${type}`} className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3 px-0">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2
            id={`fam-${type}`}
            className="font-display-ar text-2xl font-bold leading-[1.45] text-ink"
          >
            {title}
          </h2>
          <span className="whitespace-nowrap text-[11.5px] font-bold text-[var(--shop-muted)]">
            {modelsCount(products.length)} · من {formatIQD(lowest)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* Arrows are a desktop/tablet affordance; touch users just swipe. */}
          <Arrow dir="prev" disabled={atStart} onClick={() => scrollByCard("prev")} />
          <Arrow dir="next" disabled={atEnd} onClick={() => scrollByCard("next")} />
          <Link
            href={`/shop?type=${type}`}
            className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap px-2 text-[12.5px] font-extrabold text-orange-ink"
          >
            {seeAllLabel}
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
        </div>
      </div>

      {/* scroll-padding-inline restores the gutter: with `mandatory` snapping the
          snapport starts at the container edge, so the first card would snap
          flush to the screen edge, out of line with the heading above it. */}
      <div
        ref={railRef}
        onScroll={sync}
        className="-mx-4 flex snap-x snap-mandatory items-start gap-3 overflow-x-auto px-4 pb-2 pt-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [scroll-padding-inline:1rem] [&::-webkit-scrollbar]:hidden"
      >
        {products.map((p) => (
          <div
            key={p.id}
            data-card
            className="w-[60%] shrink-0 snap-start sm:w-[38%] lg:w-[23%]"
          >
            <ProductTile product={p} from="home" />
          </div>
        ))}
      </div>
    </section>
  );
}

function Arrow({
  dir,
  disabled,
  onClick,
}: {
  dir: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "السابق" : "التالي"}
      className="hidden h-[34px] w-[34px] place-items-center rounded-pill border border-line bg-beige text-ink-soft transition-colors hover:border-orange-ink hover:bg-orange-ink hover:text-white disabled:pointer-events-none disabled:opacity-30 sm:grid"
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="h-[15px] w-[15px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={dir === "prev" ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} />
      </svg>
    </button>
  );
}
