import Image from "next/image";
import Link from "next/link";

/**
 * Brand-story sections that sit between the cover and the catalog, so a visitor
 * feels the house (handmade, milestone, made-to-order) before they shop. All on
 * the lookbook system: real photos with the caption below (no scrim), Amiri
 * display, paper and ink, orange earned only on the call to action.
 */

/* 1 — The atelier: made by hand. */
export function AtelierStory() {
  return (
    <section
      aria-labelledby="atelier-title"
      className="grid items-center gap-6 lg:grid-cols-2 lg:gap-12"
    >
      <figure className="m-0">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl">
          <Image
            src="/lookbook/detail-flatlay.jpg"
            alt="تفاصيل وشاح تخرّج مطرّز يدوياً على طاولة الورشة"
            fill
            sizes="(min-width: 1024px) 48vw, 100vw"
            className="object-cover parallax-photo"
          />
        </div>
        <figcaption className="mt-2.5 text-xs text-[var(--shop-muted)]">
          تفاصيل من الورشة
        </figcaption>
      </figure>

      <div className="max-w-md">
        <h2
          id="atelier-title"
          className="text-balance font-display-ar text-[clamp(1.75rem,5vw,2.6rem)] font-bold leading-tight text-ink"
        >
          نحيكها بأيدينا، غرزة غرزة
        </h2>
        <p className="mt-4 text-base leading-relaxed text-ink-soft">
          كل وشاح يُخاط ويُطرَّز يدوياً في ورشتنا. لا قالب جاهز ولا طباعة سريعة،
          بل تفصيلٌ يليق بيومٍ لا يتكرّر.
        </p>
      </div>
    </section>
  );
}

/* 2 — The milestone: candid, editorial row. */
const LOOKS = [
  { src: "/lookbook/look-boutique.jpg", caption: "الإطلالة الكاملة" },
  { src: "/lookbook/look-pharmacy-blue.jpg", caption: "أزرق الصيدلة" },
  { src: "/lookbook/look-english-red.jpg", caption: "الأحمر الإنجليزي" },
];

export function MilestoneStory() {
  return (
    <section aria-labelledby="milestone-title" className="space-y-6">
      <div className="max-w-md">
        <h2
          id="milestone-title"
          className="text-balance font-display-ar text-[clamp(1.6rem,4.5vw,2.4rem)] font-bold leading-tight text-ink"
        >
          لِلحظةٍ تنتظرها سنوات
        </h2>
        <p className="mt-3.5 text-base leading-relaxed text-ink-soft">
          وشاح يحمل اسمك وجامعتك وسنة تخرّجك. تلبسه مرّة، وتبقى الصورة طول العمر.
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-6 p-0 sm:grid-cols-3">
        {LOOKS.map((look) => (
          <li key={look.src} className="list-none">
            <figure className="m-0">
              <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl">
                <Image
                  src={look.src}
                  alt={look.caption}
                  fill
                  sizes="(min-width: 640px) 30vw, 45vw"
                  className="object-cover parallax-photo"
                />
              </div>
              <figcaption className="mt-2 text-xs text-[var(--shop-muted)]">
                {look.caption}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* 4 — Made to order: the three steps into the designer. */
const STEPS = [
  { n: "١", text: "اختر القماش واللون" },
  { n: "٢", text: "اكتب اسمك وجامعتك بخط عربي" },
  { n: "٣", text: "نخيطه يدوياً ونوصله، تدفع نقداً" },
];

export function DesignProcess() {
  return (
    <section
      aria-labelledby="process-title"
      className="rounded-2xl bg-[var(--shop-sink)] px-6 py-10 sm:px-10 sm:py-12"
    >
      <h2
        id="process-title"
        className="text-balance font-display text-[clamp(1.6rem,4.5vw,2.4rem)] font-bold leading-tight text-ink"
      >
        صمّمه بنفسك، في دقائق
      </h2>

      <ol className="mt-8 grid gap-7 p-0 sm:grid-cols-3 sm:gap-6">
        {STEPS.map((step) => (
          <li key={step.n} className="flex items-start gap-3.5 sm:flex-col sm:gap-3">
            <span
              aria-hidden
              className="font-display text-3xl font-bold leading-none text-orange-ink"
            >
              {step.n}
            </span>
            <p className="text-base leading-relaxed text-ink-soft">{step.text}</p>
          </li>
        ))}
      </ol>

      <Link
        href="/design"
        className="mt-9 inline-flex min-h-11 items-center justify-center rounded-pill bg-orange-ink px-8 text-sm font-semibold text-white transition-colors hover:bg-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-ink"
      >
        صمّم وشاحك
      </Link>
    </section>
  );
}
