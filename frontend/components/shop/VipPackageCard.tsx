"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listVipPackages } from "@/lib/packages";
import { formatIQD } from "@/lib/format";
import type { PackageTier } from "@/lib/types";
import type { StorefrontCopy } from "@/lib/copy-ar";

/**
 * The VIP band, storefront-D treatment: the ONE dark card on a cream page, so it
 * reads as a different class of product before a word is read. Gold appears only
 * here — the documented carve-out to the one-accent-hue rule, because VIP is a
 * deliberate sub-brand rather than another orange CTA.
 *
 * ⚠️ EVERY NUMBER HERE IS THE PACKAGE'S OWN. The mockup assembled a manifest by
 * taking the dearest product in each family and pricing the bundle at a round
 * 15% under the sum — an invented discount and an invented contents list. The
 * real package carries its own price, perks and «what's inside», so this renders
 * those and shows NO saving at all rather than a fabricated one.
 *
 * Renders nothing when no VIP package exists.
 */
function GoldTick() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="#d4af49"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m20 6-11 11-5-5" />
    </svg>
  );
}

export function VipPackageCard({ copy }: { copy: StorefrontCopy }) {
  const [vip, setVip] = useState<PackageTier | null>(null);

  useEffect(() => {
    let alive = true;
    listVipPackages()
      .then((list) => {
        if (alive && list.length) setVip(list[0]);
      })
      .catch(() => {
        /* a missing VIP band must never break the storefront */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!vip) return null;

  // Prefer the admin-managed checklist; fall back to the bundled catalog products.
  const manifest =
    vip.includedItems && vip.includedItems.length > 0
      ? vip.includedItems.map((label) => ({ label, note: null as string | null }))
      : (vip.products || []).map((p) => ({ label: p.nameAr, note: null }));
  const perks = (vip.features || []).slice(0, 3);

  return (
    <Link
      href="/vip"
      className="relative isolate mt-8 block overflow-hidden rounded-card px-4 py-6 text-start shadow-[var(--shadow-card)]"
      style={{
        background: "linear-gradient(158deg, #3a2f26, #211c18 62%)",
        color: "#eae4dc",
      }}
    >
      <span
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(120% 80% at 88% 0%, rgba(212,175,73,0.16), transparent 62%)",
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-card"
        style={{ boxShadow: "inset 0 0 0 1px rgba(212,175,73,0.34)" }}
      />

      <span className="flex items-center gap-2 font-display text-[11px] font-bold tracking-[0.22em] text-[#d4af49]">
        {vip.badgeLabel || "VIP"}
        <i
          aria-hidden
          className="h-px flex-1"
          style={{
            background: "linear-gradient(to left, rgba(212,175,73,0.5), transparent)",
          }}
        />
      </span>

      <h2 className="mt-3 font-display-ar text-[1.75rem] font-bold leading-[1.4] text-[#f7f3ee]">
        {copy.vipTitle}
      </h2>
      <p className="mt-2 text-[13.5px] leading-relaxed text-[#c3bab0]">
        {vip.description || copy.vipLede}
      </p>

      {/* The contents. The first cut rendered these as full-width table rows with
          a divider and nothing in the other column — a lone label beside an empty
          gutter, which read as an unfinished table. A tick list has no second
          column to leave empty, and it is what the package actually is: a list of
          what you get. */}
      {manifest.length > 0 && (
        <>
          <span className="mt-6 block text-[11.5px] font-extrabold text-[#a99d8c]">
            شنو بالباقة
          </span>
          <ul className="mt-2.5 grid gap-2">
            {manifest.map((row) => (
              <li
                key={row.label}
                className="flex items-center gap-2.5 text-[14px] font-semibold text-[#ece6df]"
              >
                <GoldTick />
                {row.label}
              </li>
            ))}
          </ul>
        </>
      )}

      {perks.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1.5 border-t border-white/10 pt-4">
          {perks.map((perk) => (
            <li
              key={perk}
              className="inline-flex items-center rounded-pill bg-white/10 px-2.5 py-1 text-[11.5px] font-bold text-[#cfc6ba]"
            >
              {perk}
            </li>
          ))}
        </ul>
      )}

      {/* The price gets a label. A naked ٣٥٠٬٠٠٠ on a dark card reads as a
          number the reader has to guess the meaning of. */}
      <span className="mt-6 flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-bold text-[#a99d8c]">سعر الباقة</span>
        <span className="text-[26px] font-extrabold leading-none tabular-nums text-[#f7f3ee]" dir="ltr">
          {formatIQD(vip.price)}
        </span>
      </span>

      <span
        className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-pill px-6 text-sm font-extrabold"
        style={{ background: "#d4af49", color: "#211c18" }}
      >
        {copy.vipCta}
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 12H5" />
          <path d="M12 19l-7-7 7-7" />
        </svg>
      </span>
    </Link>
  );
}
