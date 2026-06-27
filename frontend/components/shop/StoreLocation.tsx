/**
 * «موقعنا» — LoloShop storefront location: an embedded Google Map + a link that
 * opens it in the Google Maps app/site for directions. Brand-warm, RTL, mobile-first.
 * The embed + share link were provided by the shop owner (محل لولو شوب).
 */
const MAP_EMBED_SRC =
  "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d424.89915383447516!2d44.61802836441445!3d33.74918965285756!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x15564d00690c2b6b%3A0xeb2473a6cc5904ab!2z2YXYt9io2LnYqSDZhNmI2YTZiCDYtNmI2Kg!5e1!3m2!1sar!2siq!4v1782573991001!5m2!1sar!2siq";
const MAP_SHARE_LINK = "https://maps.app.goo.gl/tjfh7JuSQGqNVUEd9";

export function StoreLocation() {
  return (
    <section
      aria-labelledby="store-location-title"
      className="mx-auto max-w-2xl px-4 py-14 sm:px-6 sm:py-20"
    >
      <div className="text-center">
        <h2
          id="store-location-title"
          className="font-display-ar text-[clamp(1.6rem,4.5vw,2.4rem)] font-bold leading-tight text-ink"
        >
          موقعنا
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          تفضّل بزيارتنا — نسعد بخدمتك في محل لولو شوب.
        </p>
      </div>

      <div className="mt-7 overflow-hidden rounded-2xl border border-line bg-beige shadow-[var(--shadow-soft)]">
        <div className="relative aspect-[4/3] w-full sm:aspect-[16/10]">
          <iframe
            src={MAP_EMBED_SRC}
            title="موقع محل لولو شوب على خرائط جوجل"
            className="absolute inset-0 h-full w-full"
            style={{ border: 0 }}
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </div>

      <div className="mt-5 flex justify-center">
        <a
          href={MAP_SHARE_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center gap-2 rounded-pill bg-orange-ink px-6 text-sm font-semibold text-white transition-[background-color,transform] duration-200 ease-out hover:bg-ink active:translate-y-px"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          افتح في خرائط جوجل
        </a>
      </div>
    </section>
  );
}
