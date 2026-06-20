"use client";

import { useEffect, useRef, useState } from "react";
import { formatIQD } from "@/lib/format";
import type { PackageTier } from "@/lib/types";
import { VipHero } from "./VipHero";
import { VipPerks } from "./VipPerks";
import { VipPackageDetail } from "./VipPackageDetail";
import { VipCompare } from "./VipCompare";
import { VipStoryStrip } from "./VipStoryStrip";
import { VipStickyCta } from "./VipStickyCta";

/**
 * Presentational VIP showcase — pure props, no data fetching (the container owns
 * that). Light "Stitch" editorial flow on warm paper: cinematic photo hero →
 * perks strip (overlapping the hero) → gold-bordered package card → Standard-vs-
 * VIP anchor → cinematic story → sticky CTA. Props are unchanged so the backend-
 * free mock (vip/preview) still renders it.
 */
export function VipShowcaseView({
  packages,
  standardPrice,
  onPick,
  onStandard,
  onUpgrade,
  upgradeable = false,
  busyId,
  upgrading = false,
}: {
  packages: PackageTier[];
  standardPrice?: number;
  onPick: (pkg: PackageTier) => void;
  onStandard: () => void;
  onUpgrade?: () => void;
  upgradeable?: boolean;
  busyId?: string | null;
  upgrading?: boolean;
}) {
  const hero = packages[0];

  // Sticky CTA reveals once the hero has scrolled past the top of the viewport.
  // A 0-height sentinel after the hero + boundingClientRect.top avoids the
  // below-the-fold ambiguity of a bare isIntersecting check (and needs no
  // per-frame scroll handler).
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [showSticky, setShowSticky] = useState(false);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setShowSticky(entry.boundingClientRect.top < 0),
      { threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!hero) return null;

  const items = hero.includedItems?.length ? hero.includedItems : hero.features ?? [];
  const perks = (hero.features ?? []).slice(0, 4);
  const delta =
    standardPrice != null && hero.price > standardPrice ? hero.price - standardPrice : null;
  const busy = busyId === hero.id;

  return (
    <div className="-mt-6 pb-40">
      <VipHero
        kicker={`إصدار محدود · ${hero.badgeLabel || "باقة VIP"}`}
        headline={hero.nameAr || "باقة VIP الفاخرة"}
        sub={hero.description}
        badgeLabel={hero.badgeLabel}
        imageUrl={hero.imageUrl}
        images={[...new Set([hero.imageUrl, ...(hero.gallery ?? [])].filter((u): u is string => !!u))]}
      />

      <div ref={sentinelRef} aria-hidden className="h-0" />

      {perks.length > 0 && (
        <div className="relative z-20 -mt-10 sm:-mt-16">
          <VipPerks features={perks} accent={hero.accent} />
        </div>
      )}

      <div className="mt-14 sm:mt-20">
        <VipPackageDetail
          nameAr={hero.nameAr}
          price={hero.price}
          items={items}
          badgeLabel={hero.badgeLabel}
          accent={hero.accent}
          ctaLabel="اعتمد الباقة"
          onPick={() => onPick(hero)}
          busy={busy}
        />
      </div>

      <section className="mt-16 space-y-5 sm:mt-24">
        <div className="text-center">
          <h2 className="font-display-ar text-2xl font-bold text-ink sm:text-3xl">
            ما الذي تضيفه VIP؟
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">
            ابدأ تصميمك مباشرةً بالسعر الأساسي، أو ارتقِ إلى الإطلالة الكاملة.
          </p>
        </div>
        <VipCompare
          vip={hero}
          standardPrice={standardPrice}
          busy={busy || upgrading}
          onChoose={(choice) => (choice === "vip" ? onPick(hero) : onStandard())}
        />
        {delta && (
          <p className="text-center text-sm font-semibold text-orange-ink">
            كل هذا الترف مقابل <span dir="ltr">{formatIQD(delta)}</span> فقط.
          </p>
        )}
      </section>

      <div className="mt-16 sm:mt-24">
        <VipStoryStrip imageUrl={hero.storyImageUrl} />
      </div>

      <VipStickyCta
        visible={showSticky}
        priceLabel={`${formatIQD(hero.price)} — الدفع نقداً عند الاستلام`}
        primaryLabel="اعتمد باقة VIP وابدأ التصميم"
        onPrimary={() => onPick(hero)}
        busy={busy}
        secondaryLabel={upgradeable ? "ترقية طلبي الحالي إلى VIP" : undefined}
        onSecondary={upgradeable ? onUpgrade : undefined}
        disabled={upgrading}
      />
    </div>
  );
}
