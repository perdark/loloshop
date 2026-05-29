import Image from "next/image";
import Link from "next/link";
import type { HeroSlide } from "@/lib/types";

/**
 * The lookbook cover — the storefront's first impression. When the admin has
 * published a hero slide, it runs as a cinematic full-bleed photo with the
 * headline set in Amiri over a bottom-anchored legibility veil (not a scrim
 * across the whole image). With no slide, it falls back to a composed,
 * type-led cover on warm paper. Either way it carries the single earned-orange
 * call to action: design your own sash.
 */

const DESIGN_HREF = "/design";
const DEFAULT_TITLE = "لحظة تخرّجك،\nمصمّمة على ذوقك";

export function ShopCover({ slide }: { slide: HeroSlide | null }) {
  return slide?.imageUrl ? <PhotoCover slide={slide} /> : <TypeCover />;
}

function PhotoCover({ slide }: { slide: HeroSlide }) {
  const ctaLabel = slide.ctaLabel?.trim() || "صمّم وشاحك";
  const ctaHref = slide.ctaHref?.trim() || DESIGN_HREF;
  const title = slide.title?.trim() || DEFAULT_TITLE.replace("\n", " ");

  return (
    <section className="full-bleed -mt-6 relative isolate overflow-hidden">
      <div className="relative h-[78svh] max-h-[660px] min-h-[440px] w-full">
        <Image
          src={slide.imageUrl}
          alt={title}
          fill
          priority
          sizes="100vw"
          className="animate-kenburns object-cover"
        />
        {/* Legibility veil — anchored to the lower edge where the type sits, so
            the photograph stays clean above it. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-ink via-ink/45 to-transparent opacity-90"
        />
        <div className="absolute inset-x-0 bottom-0 px-5 pb-9">
          <div className="mx-auto max-w-lg">
            {slide.kicker?.trim() && (
              <p dir="ltr" className="mb-2 font-display text-xs italic tracking-wide text-white/75">
                {slide.kicker}
              </p>
            )}
            <h1 className="text-balance font-display text-[clamp(2rem,8.5vw,3.25rem)] font-bold leading-[1.06] text-white">
              {title}
            </h1>
            {slide.caption?.trim() && (
              <p className="mt-3 max-w-[34ch] text-sm leading-relaxed text-white/85">
                {slide.caption}
              </p>
            )}
            <CoverCta label={ctaLabel} href={ctaHref} />
          </div>
        </div>
      </div>
    </section>
  );
}

function TypeCover() {
  return (
    <section className="pt-1">
      <span aria-hidden className="block h-px w-12 bg-orange-ink/40" />
      <h1 className="mt-5 text-balance font-display text-[clamp(2rem,9vw,3.1rem)] font-bold leading-[1.06] text-ink">
        لحظة تخرّجك،
        <br />
        مصمّمة على ذوقك
      </h1>
      <p className="mt-4 max-w-[39ch] text-[0.95rem] leading-relaxed text-ink-soft">
        أوشحة وروبات وقبعات تخرّج، وتجربة تصميم وشاحك بنفسك — بتفاصيل تليق بيومٍ لا
        يتكرّر.
      </p>
      <CoverCta label="صمّم وشاحك" href={DESIGN_HREF} />
    </section>
  );
}

function CoverCta({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="group mt-6 inline-flex min-h-12 items-center gap-2 rounded-pill bg-orange-ink px-7 text-sm font-semibold text-white shadow-[var(--shadow-float)] transition-[background-color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:bg-ink active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {label}
      {/* Forward arrow points left in RTL. */}
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="h-4 w-4 transition-transform duration-200 ease-out group-hover:-translate-x-0.5"
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
  );
}
