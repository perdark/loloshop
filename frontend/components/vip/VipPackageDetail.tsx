"use client";

import type { CSSProperties } from "react";
import { Reveal } from "@/components/Reveal";
import { VipBadge } from "./VipBadge";
import { vipAccent } from "./vipAccent";
import { formatIQD } from "@/lib/format";
import { IconList, IconCheck, IconArrow } from "./VipIcons";

export function VipPackageDetail({
  nameAr,
  price,
  items,
  badgeLabel,
  accent,
  ctaLabel,
  onPick,
  busy,
}: {
  nameAr: string;
  price: number;
  items: string[];
  badgeLabel?: string | null;
  accent?: string | null;
  ctaLabel: string;
  onPick: () => void;
  busy?: boolean;
}) {
  const a = vipAccent(accent);

  return (
    <Reveal>
      <div className="relative mx-auto max-w-2xl">
        {/* Breathing gold halo behind the card — gives the premium tier depth on
            the warm-paper page without a dark stage. Sits behind the surface. */}
        <span
          aria-hidden
          className="vip-halo pointer-events-none absolute -inset-4 -z-10 rounded-[calc(var(--radius-card)+1rem)] blur-2xl"
          style={{ background: `radial-gradient(58% 60% at 50% 28%, ${a}38, transparent 72%)` }}
        />

        {/* Card with gold border ring via .vip-border — no plain border added */}
        <div
          className="relative overflow-hidden rounded-[var(--radius-card)] bg-surface p-6 shadow-[var(--shadow-card)] vip-border sm:p-9"
          style={{ "--vip-accent": a } as CSSProperties}
        >
          {/* Decorative blurred gold blob — top-end corner */}
          <span
            aria-hidden
            className="pointer-events-none absolute -top-16 end-[-3rem] h-48 w-48 rounded-full blur-3xl"
            style={{ background: `${a}22` }}
          />

          {/* Content */}
          <div className="relative z-10 flex flex-col items-center text-center">
            {/* Badge */}
            <VipBadge label={badgeLabel} accent={a} sheen />

            {/* Package name */}
            <h2 className="mt-3 font-display-ar text-2xl font-bold text-ink sm:text-3xl">
              {nameAr}
            </h2>

            {/* Price */}
            <p
              className="mt-2 font-display text-4xl font-bold text-orange-ink sm:text-5xl"
              dir="ltr"
            >
              {formatIQD(price)}
            </p>

            {/* Gold hairline — a small couture flourish under the price */}
            <span
              aria-hidden
              className="mt-3 h-px w-20 rounded-full"
              style={{ background: `linear-gradient(to left, transparent, ${a}, transparent)` }}
            />

            <span className="mt-2 text-xs text-[var(--shop-muted)]">
              الدفع نقداً عند الاستلام
            </span>

            {/* Items sub-card */}
            {items.length > 0 && (
              <div className="mt-7 w-full rounded-2xl border border-line bg-cream/70 p-5 text-start">
                {/* Header */}
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-full"
                    style={{ background: `${a}1f`, color: a } as CSSProperties}
                  >
                    <IconList className="h-5 w-5" />
                  </span>
                  <span className="font-semibold text-ink">قائمة المحتويات</span>
                </div>

                {/* Item list — gold check chips */}
                <ul className="mt-4 space-y-3">
                  {items.map((item, i) => (
                    <Reveal key={i} delay={i * 60}>
                      <li className="flex items-center gap-3 border-b border-line/60 pb-3 last:border-0 last:pb-0">
                        <span
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                          style={{ background: `${a}1f`, color: a } as CSSProperties}
                        >
                          <IconCheck className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-sm text-ink-soft">{item}</span>
                      </li>
                    </Reveal>
                  ))}
                </ul>
              </div>
            )}

            {/* Primary CTA */}
            <button
              type="button"
              onClick={onPick}
              disabled={busy}
              className="btn-shine cta-pulse group mt-8 inline-flex min-h-[3.25rem] w-full items-center justify-center gap-2 rounded-pill bg-brand-gradient px-8 text-sm font-bold text-white shadow-[var(--shadow-card)] transition-transform active:scale-[0.98] disabled:opacity-60 sm:w-auto"
            >
              {busy ? (
                "جارٍ…"
              ) : (
                <>
                  {ctaLabel}
                  <IconArrow className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </Reveal>
  );
}
