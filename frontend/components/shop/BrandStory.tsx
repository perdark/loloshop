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
        <div className="parallax-frame relative aspect-[4/3] w-full overflow-hidden rounded-2xl">
          <Image
            src="/lookbook/detail-flatlay.jpg"
            alt="تفاصيل وشاح تخرّج مطرّز يدوياً على طاولة الورشة"
            fill
            sizes="(min-width: 1024px) 48vw, 100vw"
            loading="lazy"
            className="parallax-photo object-cover"
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

/* 2 — The milestone: real graduation moments from our cohorts. A mixed-aspect
   mosaic — wide crowd shots span the full row, the tall candid strips sit
   two-up. Each photo keeps an aspect that fits it, so nothing crops badly on
   phone. */
const HIGHLIGHTS: {
  src: string;
  caption: string;
  alt: string;
  span: "wide" | "tall";
}[] = [
  {
    src: "/lookbook/grad-crowd.jpg",
    caption: "دفعة كاملة بأوشحتنا",
    alt: "مئات الخرّيجين على مدرّجات الجامعة يرتدون أوشحة تخرّج من تصميمنا",
    span: "wide",
  },
  {
    src: "/lookbook/grad-moments-1.jpg",
    caption: "لحظات لا تتكرّر",
    alt: "لقطات من حفل تخرّج: خرّيجات بالقبعات والأوشحة وصورة جماعية للدفعة",
    span: "tall",
  },
  {
    src: "/lookbook/grad-moments-2.jpg",
    caption: "فرحة يومٍ واحد",
    alt: "خرّيجون وخرّيجات يحتفلون بالورود والقبعات في يوم التخرّج",
    span: "tall",
  },
  {
    src: "/lookbook/grad-diyala.jpg",
    caption: "جامعة ديالى — دفعة ٢٠٢٥",
    alt: "خرّيجو قسم الجغرافيا في جامعة ديالى بأوشحة وروبات زرقاء من تصميمنا",
    span: "wide",
  },
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
          لحظات حقيقية من تخريجات صمّمنا أوشحتها — وشاح يحمل اسمك وجامعتك وسنة
          تخرّجك، تلبسه مرّة وتبقى الصورة طول العمر.
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-3 p-0 sm:gap-4">
        {HIGHLIGHTS.map((item) => (
          <li
            key={item.src}
            className={item.span === "wide" ? "col-span-2 list-none" : "list-none"}
          >
            <figure className="m-0">
              <div
                className={`parallax-frame relative w-full overflow-hidden rounded-xl ${
                  item.span === "wide" ? "aspect-[16/10]" : "aspect-[4/5]"
                }`}
              >
                <Image
                  src={item.src}
                  alt={item.alt}
                  fill
                  sizes={
                    item.span === "wide"
                      ? "(min-width: 768px) 672px, 100vw"
                      : "(min-width: 768px) 330px, 48vw"
                  }
                  loading="lazy"
                  className="parallax-photo object-cover"
                />
              </div>
              <figcaption className="mt-2 text-xs text-[var(--shop-muted)]">
                {item.caption}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* 4 — Made to order: the three steps to a personalised sash. */
const STEPS = [
  { n: "١", text: "اختر الوشاح ولونه" },
  { n: "٢", text: "اكتب اسمك وجامعتك للتطريز" },
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
        خصّصه بتفاصيلك، في دقائق
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
        href="/#catalog"
        className="mt-9 inline-flex min-h-11 items-center justify-center rounded-pill bg-orange-ink px-8 text-sm font-semibold text-white transition-colors hover:bg-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-ink"
      >
        تسوّق الأوشحة
      </Link>
    </section>
  );
}
