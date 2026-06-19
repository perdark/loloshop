"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { listFullSetPackages } from "@/lib/catalog";
import type { FullSetPackage } from "@/lib/catalog";
import { formatIQD } from "@/lib/format";
import { AutoRotatingImage } from "@/components/ui/AutoRotatingImage";
import { Reveal } from "@/components/Reveal";

/**
 * Regular (full-set) packages showcase — `/full-set`.
 *
 * The lookbook spread for the complete graduation set (روب + قبعة + وشاح). Each
 * package is a full-width editorial row — big photo on one side, the story +
 * what's-included + price + CTA on the other, alternating sides so it reads like
 * turning pages, not a card grid. Each row links into the existing `/full-set/[id]`
 * order wizard. Public (browsing); the wizard handles auth.
 *
 * VIP packages live at `/vip`; this is the regular tier.
 */

/** Cover photo first, then the rest of the admin gallery — de-duplicated. */
function packagePhotos(pkg: FullSetPackage): string[] {
  return [
    ...new Set(
      [pkg.imageUrl, ...(pkg.gallery ?? [])].filter((u): u is string => !!u)
    ),
  ];
}

/** What the set includes — admin list when set, else the canonical three pieces. */
function includedChips(pkg: FullSetPackage): string[] {
  if (pkg.includedItems.length > 0) return pkg.includedItems;
  return ["روب التخرّج", "قبعة التخرّج", "وشاح مخصّص"];
}

export default function FullSetIndexPage() {
  const [packages, setPackages] = useState<FullSetPackage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    listFullSetPackages()
      .then((list) => setPackages([...list].sort((a, b) => a.sort - b.sort)))
      .catch((e) => {
        const msg = getApiErrorMessage(e, "تعذر تحميل الأطقم — تحقق من الاتصال");
        setError(msg);
        toast.error(msg);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loading = packages === null && !error;

  return (
    <div className="animate-fade-page-in pb-6">
      <BackLink />

      {/* ── Page header ── */}
      <header className="mt-3 max-w-2xl">
        <h1 className="text-balance font-display-ar text-[clamp(2rem,7vw,3.25rem)] font-bold leading-[1.06] text-ink">
          أطقم التخرّج
        </h1>
        <p className="mt-4 max-w-[46ch] text-base leading-relaxed text-ink-soft sm:text-lg">
          إطلالتك الكاملة ليومٍ لا يتكرّر — روب وقبعة ووشاح مخصّص باسمك وجامعتك،
          نخيطه لك يدوياً ونوصله، تدفع نقداً.
        </p>
      </header>

      {/* ── States ── */}
      {loading ? (
        <FullSetSkeleton />
      ) : error ? (
        <div className="mt-12 flex flex-col items-center gap-4 rounded-card border border-dashed border-orange/25 bg-[var(--shop-sink)] px-6 py-14 text-center">
          <p className="max-w-[34ch] text-sm font-medium text-ink-soft">{error}</p>
          <button
            type="button"
            onClick={load}
            className="inline-flex min-h-11 items-center rounded-pill bg-orange-ink px-6 text-sm font-semibold text-white transition-colors hover:bg-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-ink"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : packages && packages.length === 0 ? (
        <div className="mt-12 flex flex-col items-center gap-3 rounded-card border border-dashed border-orange/25 bg-[var(--shop-sink)] px-6 py-16 text-center">
          <p className="font-script text-4xl leading-none text-orange-ink/80">lolo</p>
          <p className="max-w-[34ch] text-sm font-medium text-ink-soft">
            نجهّز أطقم هذا الموسم — تابعونا على إنستغرام{" "}
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
        </div>
      ) : (
        <div className="mt-12 space-y-16 sm:mt-16 sm:space-y-24 lg:space-y-28">
          {packages!.map((pkg, i) => (
            <PackageRow
              key={pkg.id}
              pkg={pkg}
              flip={i % 2 === 1}
              priority={i === 0}
            />
          ))}
        </div>
      )}

      {/* ── Quiet close ── */}
      {packages && packages.length > 0 && (
        <p className="mt-16 text-center text-xs text-[var(--shop-muted)] sm:mt-24">
          كل الأسعار شاملة التوصيل — الدفع نقداً عند الاستلام
        </p>
      )}
    </div>
  );
}

/** One editorial row — photo on one side, the set's story on the other. */
function PackageRow({
  pkg,
  flip,
  priority = false,
}: {
  pkg: FullSetPackage;
  flip: boolean;
  priority?: boolean;
}) {
  const photos = packagePhotos(pkg);
  const href = `/full-set/${pkg.id}`;
  const chips = includedChips(pkg);
  const perks = (pkg.features ?? []).slice(0, 4);
  const accent = pkg.accent || "#f47b42";

  return (
    <Reveal>
      <section className="group/row grid items-center gap-6 lg:grid-cols-2 lg:gap-12 xl:gap-16">
        {/* Photo — links into the order wizard; hover lifts gently. */}
        <Link
          href={href}
          aria-label={`اطلب ${pkg.nameAr}`}
          className={`group/photo relative block overflow-hidden rounded-[var(--radius-card)] bg-[var(--shop-sink)] ${
            flip ? "lg:order-2" : ""
          }`}
        >
          <div className="relative aspect-[4/5] w-full sm:aspect-[5/6] lg:aspect-[4/5]">
            {photos.length > 1 ? (
              <AutoRotatingImage
                images={photos}
                alt={pkg.nameAr}
                sizes="(max-width: 1023px) 100vw, 48vw"
                priority={priority}
                autoRotate={false}
                className="transition-transform duration-700 ease-out group-hover/photo:scale-[1.03]"
              />
            ) : photos.length === 1 ? (
              <Image
                src={photos[0]}
                alt={pkg.nameAr}
                fill
                priority={priority}
                sizes="(max-width: 1023px) 100vw, 48vw"
                className="object-cover transition-transform duration-700 ease-out group-hover/photo:scale-[1.03]"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="font-script text-5xl text-orange-ink/25">lolo</p>
              </div>
            )}
            {pkg.badgeLabel && (
              <span
                className="absolute end-3 top-3 rounded-full px-3 py-1 text-xs font-bold text-white shadow-[var(--shadow-soft)]"
                style={{ background: accent }}
              >
                {pkg.badgeLabel}
              </span>
            )}
          </div>
        </Link>

        {/* Story */}
        <div className={flip ? "lg:order-1" : ""}>
          <h2 className="text-balance font-display-ar text-[clamp(1.6rem,4.5vw,2.4rem)] font-bold leading-tight text-ink">
            <Link
              href={href}
              className="transition-colors hover:text-orange-ink focus-visible:text-orange-ink focus-visible:outline-none"
            >
              {pkg.nameAr}
            </Link>
          </h2>

          {pkg.description && (
            <p className="mt-3.5 max-w-[52ch] text-base leading-relaxed text-ink-soft text-pretty">
              {pkg.description}
            </p>
          )}

          {/* What's included */}
          <ul className="mt-5 flex flex-wrap gap-2 p-0">
            {chips.map((label) => (
              <li
                key={label}
                className="inline-flex list-none items-center gap-1.5 rounded-pill bg-[var(--shop-sink)] px-3 py-1.5 text-xs font-semibold text-ink-soft ring-1 ring-ink/5"
              >
                <Check className="h-3 w-3 text-orange-ink" />
                {label}
              </li>
            ))}
          </ul>

          {/* Perks — only when the admin set features */}
          {perks.length > 0 && (
            <ul className="mt-5 flex flex-col gap-2 p-0">
              {perks.map((perk) => (
                <li
                  key={perk}
                  className="flex list-none items-start gap-2.5 text-sm leading-relaxed text-ink-soft"
                >
                  <span
                    aria-hidden
                    className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-white"
                    style={{ background: accent }}
                  >
                    <Check className="h-2.5 w-2.5" />
                  </span>
                  {perk}
                </li>
              ))}
            </ul>
          )}

          {/* Price + CTA */}
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
            <p className="flex items-baseline gap-1.5" dir="ltr">
              <span className="text-xs font-medium text-[var(--shop-muted)]">
                يبدأ من
              </span>
              <span className="font-display-ar text-2xl font-bold tabular-nums text-ink">
                {formatIQD(pkg.price)}
              </span>
            </p>
            <Link
              href={href}
              className="group/cta inline-flex min-h-12 items-center gap-2 rounded-pill bg-orange-ink px-7 text-sm font-semibold text-white shadow-[var(--shadow-float)] transition-[background-color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:bg-ink active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-ink"
            >
              اطلب طقمك
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-4 w-4 transition-transform duration-200 ease-out group-hover/cta:-translate-x-0.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 12H5" />
                <path d="M12 19l-7-7 7-7" />
              </svg>
            </Link>
          </div>
          <p className="mt-3 text-xs text-[var(--shop-muted)]">
            شامل التوصيل — الدفع نقداً عند الاستلام
          </p>
        </div>
      </section>
    </Reveal>
  );
}

function Check({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function FullSetSkeleton() {
  return (
    <div
      className="mt-12 space-y-16 sm:mt-16 sm:space-y-24"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">جارٍ تحميل الأطقم…</span>
      {[0, 1].map((i) => (
        <div key={i} className="grid items-center gap-6 lg:grid-cols-2 lg:gap-12">
          <div
            className={`skeleton aspect-[4/5] w-full rounded-[var(--radius-card)] ${
              i % 2 ? "lg:order-2" : ""
            }`}
          />
          <div className={`space-y-4 ${i % 2 ? "lg:order-1" : ""}`}>
            <div className="skeleton h-9 w-2/3 rounded-xl" />
            <div className="skeleton h-4 w-full rounded-pill" />
            <div className="skeleton h-4 w-5/6 rounded-pill" />
            <div className="flex gap-2 pt-1">
              {[0, 1, 2].map((c) => (
                <div key={c} className="skeleton h-7 w-20 rounded-pill" />
              ))}
            </div>
            <div className="flex items-center gap-4 pt-2">
              <div className="skeleton h-8 w-24 rounded-pill" />
              <div className="skeleton h-12 w-32 rounded-pill" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-orange-ink transition-colors hover:text-ink"
    >
      <span aria-hidden>→</span>
      المتجر
    </Link>
  );
}
