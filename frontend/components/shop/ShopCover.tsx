import Link from "next/link";

/**
 * The lookbook cover — the storefront's first impression. A composed, type-led
 * cover on warm paper carrying the single earned-orange call to action: design
 * your own sash.
 */

const DESIGN_HREF = "/design";

export function ShopCover() {
  return <TypeCover />;
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
        <svg className="animate-scroll-cue h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
