import Image from "next/image";
import Link from "next/link";

/**
 * «الدفعة» — the proof band (first-look bet C, chosen 2026-08-02).
 *
 * The bet: TRUST BEFORE TASTE. In Iraq the first question is «هذا محل حقيقي لو
 * حساب إنستغرام؟», and a real cohort photo plus a real number answers it before
 * any marketing line does. `graduates` is `lib/counts`' distinct-students figure
 * carried on the shop feed, so it grows on its own and can never drift into a
 * rounded marketing number.
 *
 * It sits BETWEEN the قبعات and شالات rails rather than on top of the page:
 * storefront-D's whole thesis is that the goods come first and the story is told
 * in the gaps, so a full-bleed hero at the top would undo the layout it lives in.
 *
 * The rep door the mockup drew here («أنت ممثل دفعتك؟») is deliberately absent —
 * reps are created by an admin who hands out the referral link, so the card had
 * no real destination (owner decision, 2026-08-02).
 */
export function CohortProof({
  graduates,
  atTop = false,
}: {
  graduates?: number | null;
  /** Opening band: taller, and the photo loads eagerly because it IS the LCP. */
  atTop?: boolean;
}) {
  return (
    <section
      aria-labelledby="cohort-title"
      className={atTop ? "full-bleed -mt-6" : "full-bleed mt-10"}
    >
      {/* The source frame carries an Instagram watermark and a mute button along
          its bottom edge; grad-crowd-hero.jpg is the same photo pre-cropped above
          both, so no CSS trickery is needed to hide them. */}
      <div
        className={`relative isolate overflow-hidden bg-ink ${
          atTop
            ? "h-[34svh] min-h-[240px] max-h-[380px]"
            : "h-[30svh] min-h-[210px] max-h-[340px]"
        }`}
      >
        <Image
          src="/lookbook/grad-crowd-hero.jpg"
          alt="مدرّجات مليئة بالخرّيجين والخرّيجات يرتدون أوشحة تخرّج من لولو شوب في حفل تخرّج جامعي"
          fill
          sizes="100vw"
          /* NOT `priority` — a silent no-op in Next 16. */
          loading={atTop ? "eager" : "lazy"}
          fetchPriority={atTop ? "high" : undefined}
          className="object-cover object-center"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5"
          style={{
            background:
              "linear-gradient(to top, var(--color-cream) 2%, color-mix(in srgb, var(--color-cream) 72%, transparent) 40%, transparent 100%)",
          }}
        />
      </div>

      <div className="relative z-10 -mt-10 px-4 sm:px-6">
        <div className="mx-auto w-full max-w-lg md:max-w-3xl lg:max-w-6xl">
          {graduates != null && (
            <p className="flex items-baseline gap-2.5">
              <span className="font-display text-[clamp(2.6rem,11vw,3.75rem)] font-bold leading-[0.9] tabular-nums text-orange-ink">
                {graduates.toLocaleString("en-US")}
              </span>
              <span className="max-w-[14ch] text-sm font-bold leading-snug text-ink-soft">
                طالب وطالبة لبسوا تصاميمنا
              </span>
            </p>
          )}

          <h2
            id="cohort-title"
            className="mt-3 text-balance font-display-ar text-[clamp(1.75rem,7vw,2.6rem)] font-bold leading-[1.3] text-ink"
          >
            دفعتك كلها تقدر تطلب سوية
          </h2>
          <p className="mt-3 max-w-[36ch] text-[15px] leading-relaxed text-ink-soft">
            أوشحة وروبات وقبعات بأسماء الطلاب وكلياتهم — للطالب الواحد أو للدفعة
            كاملة. نخيطها بورشتنا ونسلّمها قبل موعد الحفل.
          </p>

          <Link
            href="/shop"
            className="group mt-6 inline-flex min-h-12 items-center gap-2 rounded-pill bg-orange-ink px-7 text-sm font-semibold text-white shadow-[var(--shadow-float)] transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-ink"
          >
            تسوّق القطع
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-0.5"
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
      </div>
    </section>
  );
}
