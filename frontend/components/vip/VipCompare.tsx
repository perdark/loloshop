"use client";

import type { CSSProperties } from "react";
import { formatIQD } from "@/lib/format";
import type { PackageTier } from "@/lib/types";
import { VipBadge } from "./VipBadge";
import { vipAccent } from "./vipAccent";
import { IconCheck } from "./VipIcons";

/**
 * Standard vs VIP comparison — two option cards.
 * Used by the designer tier-gate and anywhere a side-by-side upsell is needed.
 * Export signature is stable — do not change props.
 */
export function VipCompare({
  vip,
  standardLabel = "الوشاح العادي",
  standardNote = "اطلب وشاحك مباشرةً بالسعر الأساسي.",
  standardPrice,
  onChoose,
  busy = false,
}: {
  vip: PackageTier;
  standardLabel?: string;
  standardNote?: string;
  standardPrice?: number;
  onChoose: (choice: "standard" | "vip") => void;
  busy?: boolean;
}) {
  const a = vipAccent(vip.accent);
  const perks = (vip.features ?? []).slice(0, 4);

  return (
    <div className="grid gap-4 sm:grid-cols-2" dir="rtl">
      {/* ── Standard card ── */}
      <div className="flex flex-col rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-soft)]">
        <h3 className="font-display-ar text-lg font-bold text-ink">{standardLabel}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{standardNote}</p>

        {standardPrice != null && (
          <p className="mt-3 font-display text-xl font-bold text-ink" dir="ltr">
            {formatIQD(standardPrice)}
          </p>
        )}

        {/* ghost button */}
        <button
          type="button"
          disabled={busy}
          onClick={() => onChoose("standard")}
          className="mt-auto inline-flex min-h-12 items-center justify-center rounded-pill border border-line bg-beige px-6 pt-4 text-sm font-bold text-ink transition-colors hover:border-orange-ink/40 hover:text-orange-ink disabled:opacity-60"
        >
          متابعة عادية
        </button>
      </div>

      {/* ── VIP card ── */}
      <div
        className="vip-tilt vip-border relative flex flex-col overflow-hidden rounded-[var(--radius-card)] bg-surface p-6 shadow-[var(--shadow-card)] sm:-translate-y-2"
        style={{ "--vip-accent": a } as CSSProperties}
      >
        {/* gold top bar */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: `linear-gradient(to left, ${a}, #f6e3b0, ${a})` }}
        />

        {/* sheen overlay */}
        <span
          aria-hidden
          className="vip-sheen pointer-events-none absolute inset-0"
          style={{ "--vip-accent": a } as CSSProperties}
        />

        {/* header row */}
        <div className="relative flex items-center justify-between gap-2">
          <h3 className="font-display-ar text-lg font-bold text-ink">{vip.nameAr}</h3>

          {/* "موصى بها" pill — soft gold ground, no dark fill */}
          <span
            className="vip-sheen relative overflow-hidden rounded-full px-3 py-1 text-[11px] font-bold"
            style={{ background: `${a}1f`, color: a, "--vip-accent": a } as CSSProperties}
          >
            موصى بها
          </span>
        </div>

        {/* keep VipBadge accessible for consumers that rely on its label */}
        <div className="sr-only">
          <VipBadge label={vip.badgeLabel} accent={a} />
        </div>

        {/* perks list */}
        {perks.length > 0 && (
          <ul className="relative mt-4 space-y-2.5">
            {perks.map((f, i) => (
              <li key={`${f}-${i}`} className="flex items-center gap-2 text-sm text-ink-soft">
                <span style={{ color: a }}>
                  <IconCheck className="h-4 w-4 shrink-0" />
                </span>
                {f}
              </li>
            ))}
          </ul>
        )}

        {/* price */}
        <p className="relative mt-5 font-display text-2xl font-bold text-orange-ink" dir="ltr">
          {formatIQD(vip.price)}
        </p>

        {/* primary CTA */}
        <button
          type="button"
          disabled={busy}
          onClick={() => onChoose("vip")}
          className="btn-shine relative mt-4 inline-flex min-h-12 items-center justify-center rounded-pill bg-brand-gradient px-6 text-sm font-bold text-white shadow-[var(--shadow-card)] transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? "جارٍ…" : "اختر باقة VIP"}
        </button>
      </div>
    </div>
  );
}
