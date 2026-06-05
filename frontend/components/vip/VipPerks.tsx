"use client";

import type { CSSProperties } from "react";
import { Reveal } from "@/components/Reveal";
import { PERK_ICONS } from "./VipIcons";
import { vipAccent } from "./vipAccent";

/**
 * Perks strip — 4-up card row. Parent overlaps it up into the hero section
 * with a negative margin (e.g. -mt-10). Self-contained bg + shadow.
 */
export function VipPerks({
  features,
  accent,
  title,
}: {
  features: string[];
  accent?: string | null;
  title?: string;
}) {
  if (!features.length) return null;
  const a = vipAccent(accent);

  return (
    <section className="w-full" dir="rtl">
      {/* Optional heading — only rendered when caller provides title */}
      {title && (
        <Reveal>
          <h2 className="mb-5 text-center font-display-ar text-xl font-bold text-ink">
            {title}
          </h2>
        </Reveal>
      )}

      {/* 2-col on mobile → 4-col on md */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        {features.slice(0, 4).map((feature, i) => {
          const Icon = PERK_ICONS[i % PERK_ICONS.length];
          return (
            <Reveal key={`${feature}-${i}`} delay={i * 70}>
              <div
                className="card-lift flex flex-col items-center rounded-2xl border border-line bg-surface p-5 text-center shadow-[var(--shadow-soft)] transition-colors"
              >
                {/* Gold icon chip */}
                <div
                  className="mb-3 flex h-12 w-12 items-center justify-center rounded-full"
                  style={
                    {
                      background: `${a}1a`,
                      color: a,
                    } as CSSProperties
                  }
                >
                  {/* vip-float + stagger delay on a wrapper span; Icon only takes className */}
                  <span
                    className="vip-float"
                    style={{ animationDelay: `${i * 0.4}s` } as CSSProperties}
                  >
                    <Icon className="h-6 w-6" />
                  </span>
                </div>

                {/* Feature label */}
                <span className="text-sm font-semibold text-ink">{feature}</span>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
