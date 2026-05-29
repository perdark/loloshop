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
    <section className="full-bleed -mt-6 relative isolate flex min-h-[82svh] items-center overflow-hidden bg-warm-veil px-5">
      {/* Oversized script flourish drifting in the back — cinematic depth. */}
      <span
        aria-hidden
        className="animate-sash-float pointer-events-none absolute -start-[8%] top-1/2 -z-10 -translate-y-1/2 select-none font-script leading-none text-orange/[0.07] text-[42vw]"
      >
        lolo
      </span>

      <div className="mx-auto w-full max-w-6xl">
        <p
          dir="ltr"
          className="mb-4 font-display text-xs italic tracking-[0.25em] text-orange-ink/80"
          style={{ animation: "hero-line 0.7s cubic-bezier(0.16,1,0.3,1) both" }}
        >
          LOLO SHOP · graduation lookbook
        </p>
        <h1 className="text-balance font-display-ar text-[clamp(2.5rem,11vw,6rem)] font-bold leading-[1.04] text-ink">
          <span
            className="block"
            style={{ animation: "hero-line 0.8s cubic-bezier(0.16,1,0.3,1) 0.08s both" }}
          >
            لحظة تخرّجك،
          </span>
          <span
            className="block"
            style={{ animation: "hero-line 0.8s cubic-bezier(0.16,1,0.3,1) 0.22s both" }}
          >
            مصمّمة على ذوقك
          </span>
        </h1>
        <p
          className="mt-5 max-w-[42ch] text-base leading-relaxed text-ink-soft sm:text-lg"
          style={{ animation: "hero-line 0.8s cubic-bezier(0.16,1,0.3,1) 0.36s both" }}
        >
          أوشحة وروبات وقبعات تخرّج، وتجربة تصميم وشاحك بنفسك — بتفاصيل تليق بيومٍ لا
          يتكرّر.
        </p>
        <div style={{ animation: "hero-line 0.8s cubic-bezier(0.16,1,0.3,1) 0.5s both" }}>
          <CoverCta label="صمّم وشاحك" href={DESIGN_HREF} />
        </div>
      </div>

      {/* Quiet scroll cue. */}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-6 mx-auto flex w-full justify-center text-orange-ink/45 motion-reduce:hidden"
      >
        <svg className="animate-bounce h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
      </span>
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
