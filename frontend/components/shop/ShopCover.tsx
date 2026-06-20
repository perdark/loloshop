import Link from "next/link";

/**
 * The lookbook cover — the storefront's first impression. A bold, type-led cover
 * on the single warm-cream canvas (no gradient — one flat page color). Arabic-first
 * eyebrow, an oversized headline with an earned-orange accent line, and two clear
 * calls to action. Tuned for iPhone: solid brand colors, large readable type, one font.
 */

const CATALOG_HREF = "/#catalog";
const FULLSET_HREF = "/full-set";

export function ShopCover() {
  return (
    <section className="full-bleed -mt-6 relative isolate flex min-h-[86svh] items-center overflow-hidden px-5">
      {/* Oversized script wordmark drifting in the back — quiet brand depth. */}
      <span
        aria-hidden
        className="animate-sash-float pointer-events-none absolute -start-[8%] top-1/2 -z-10 -translate-y-1/2 select-none font-script leading-none text-orange/[0.06] text-[42vw]"
      >
        lolo
      </span>

      <div className="mx-auto w-full max-w-5xl">
        {/* Arabic-first eyebrow — orange rule + brand line (one font, no Latin swap). */}
        <div
          className="mb-5 flex items-center gap-3"
          style={{ animation: "hero-line 0.7s cubic-bezier(0.16,1,0.3,1) both" }}
        >
          <span aria-hidden className="h-px w-9 bg-orange-ink/70" />
          <span className="font-display text-[0.8rem] font-bold tracking-[0.04em] text-orange-ink">
            لولو شوب · أزياء التخرّج
          </span>
        </div>

        <h1 className="text-balance font-display-ar text-[clamp(2.6rem,12vw,6.25rem)] font-bold leading-[1.04] text-ink">
          <span
            className="block"
            style={{ animation: "hero-line 0.8s cubic-bezier(0.16,1,0.3,1) 0.08s both" }}
          >
            إطلالة تخرّجٍ
          </span>
          <span
            className="block text-orange-ink"
            style={{ animation: "hero-line 0.8s cubic-bezier(0.16,1,0.3,1) 0.22s both" }}
          >
            مصمّمة على ذوقك
          </span>
        </h1>

        <p
          className="mt-5 max-w-[44ch] text-base leading-relaxed text-ink-soft sm:text-lg"
          style={{ animation: "hero-line 0.8s cubic-bezier(0.16,1,0.3,1) 0.36s both" }}
        >
          أوشحة وروبات وقبعات تخرّج فاخرة، بلونك وتطريزك واسمك، بتفاصيل تليق بيومٍ
          لا يتكرّر.
        </p>

        <div
          className="mt-7 flex flex-wrap items-center gap-3"
          style={{ animation: "hero-line 0.8s cubic-bezier(0.16,1,0.3,1) 0.5s both" }}
        >
          <PrimaryCta label="تسوّق الأوشحة" href={CATALOG_HREF} />
          <SecondaryCta label="الطقم الكامل" href={FULLSET_HREF} />
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

/* Forward arrow points left in RTL. */
function ArrowLeft() {
  return (
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
  );
}

function PrimaryCta({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex min-h-12 items-center gap-2 rounded-pill bg-orange-ink px-7 text-sm font-semibold text-white shadow-[var(--shadow-float)] transition-[background-color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:bg-ink active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-ink"
    >
      {label}
      <ArrowLeft />
    </Link>
  );
}

function SecondaryCta({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex min-h-12 items-center gap-2 rounded-pill border border-orange-ink/30 bg-surface px-7 text-sm font-semibold text-orange-ink shadow-[var(--shadow-soft)] transition-colors duration-200 ease-out hover:bg-orange-ink hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-ink"
    >
      {label}
      <ArrowLeft />
    </Link>
  );
}
