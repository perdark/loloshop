import type { Metadata } from "next";
import Image from "next/image";
import { APP_STORE_URL, PLAY_URL } from "@/lib/app-gate";
import { BrandMark } from "@/components/ui/BrandLogo";
import { getShopFeedServer } from "@/lib/catalog-server";

/**
 * ── THE DOWNLOAD PAGE ────────────────────────────────────────────────────────
 * Where the app-only gate sends every browser visitor (lib/app-gate.ts). Since
 * 2026-09-12 that is EVERY device, not just laptops: the gate used to sniff the
 * user agent and bounce a phone straight into its store, so the shop's own
 * landing page was only ever seen by desktop — which is almost nobody here.
 * This page is now the first and often the ONLY LoloShop screen a new student
 * sees, so it carries the brand rather than apologising for the redirect.
 *
 * ── WHAT IS DELIBERATELY NOT CLAIMED ─────────────────────────────────────────
 * No delivery promise and no delivery time. The shop has never committed to one
 * — it is the single thing `backend/lib/answerGuard.js` refuses to let «لولو»
 * say, and a marketing page may not promise what the assistant is forbidden to.
 * Payment reads «الدفع عند الاستلام» because payments are CASH ONLY (CLAUDE.md);
 * there is no gateway to call "secure".
 * The cohort figure is «سجّلوا معنا», never «لبسوا تصاميمنا»: 1,141 counts
 * REGISTRATIONS and only ~554 of those have an order (HANDOFF, open decisions).
 *
 * Server component on purpose — no state, no effects, nothing to hydrate. The
 * phone mockups are markup, not screenshots, so they stay sharp at every DPI and
 * cost nothing to keep true as the app changes.
 */

export const metadata: Metadata = {
  title: "حمّل التطبيق",
  description:
    "لولو شوب صار تطبيق — صمّم وشاح تخرجك، اختر روبك وقبعتك، وتابع طلبك من هاتفك.",
  openGraph: {
    title: "حمّل تطبيق لولوشوب",
    description:
      "كل ما تحتاجه من وشاح، روب وقبعة — وتفاصيل تخرجك في مكان واحد.",
    images: ["/logo.png"],
  },
};

const WHATSAPP_URL = "https://wa.me/9647723078729";
const INSTAGRAM_URL = "https://instagram.com/lolo_shop96";

export default async function GetAppPage() {
  /*
    The one live number on the page. `getShopFeedServer` is the storefront's own
    unauthenticated feed fetch — it NEVER throws (a backend hiccup returns null),
    revalidates on the same 120 s window as the shop, and `graduates` is
    lib/counts' distinct-student figure, so this cannot drift into a rounded
    marketing number the way a hardcoded one would. Null → the card falls back to
    copy that claims nothing.
  */
  const feed = await getShopFeedServer();
  const graduates = typeof feed?.graduates === "number" ? feed.graduates : null;

  return (
    <div className="flex min-h-dvh flex-col bg-cream text-ink-soft">
      <SiteHeader />

      <main className="safe-x flex-1">
        <Hero />
        <ValueRow graduates={graduates} />
        <ClosingBanner />
      </main>

      <SiteFooter />
    </div>
  );
}

/* ─────────────────────────────── header ─────────────────────────────── */

function SiteHeader() {
  return (
    <header className="safe-x sticky top-0 z-30 border-b border-line/70 bg-cream/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
        <a href="#top" className="flex items-center gap-2.5" aria-label="لولو شوب">
          <BrandMark size={38} eager />
          <span className="font-display text-lg font-bold tracking-tight text-ink">
            LoloShop
          </span>
        </a>

        <nav className="flex items-center gap-4 text-sm sm:gap-6">
          <a
            href="#top"
            aria-current="page"
            className="border-b-2 border-orange pb-0.5 font-semibold text-orange-ink"
          >
            الرئيسية
          </a>
          <a
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink-soft transition-colors hover:text-orange-ink"
          >
            تواصل معنا
          </a>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden text-ink-soft transition-colors hover:text-orange-ink sm:inline"
          >
            الدعم
          </a>
        </nav>
      </div>
    </header>
  );
}

/* ──────────────────────────────── hero ──────────────────────────────── */

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      {/* Warm light behind the phones. Pointer-events-none so it can never eat a tap. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 start-[-10%] h-[520px] w-[520px] rounded-full bg-peach/45 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 end-[-15%] h-[420px] w-[420px] rounded-full bg-blush/50 blur-3xl"
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-12 lg:grid-cols-[1fr_1.05fr] lg:gap-8 lg:py-20">
        {/* In RTL the first grid child sits on the right — the copy, as designed. */}
        <div className="text-center lg:text-start">
          <span className="inline-flex items-center gap-2 rounded-pill border border-orange/25 bg-beige px-4 py-2 text-sm font-semibold text-orange-ink shadow-[var(--shadow-soft)]">
            <BagIcon className="size-4" />
            تطبيق لولوشوب
          </span>

          <h1 className="mt-6 text-balance font-display-ar text-[clamp(2.1rem,8vw,3.6rem)] font-bold leading-[1.3] text-ink">
            حمّل تطبيق
            <br />
            <span className="text-orange-ink">لولوشوب الآن</span>
          </h1>

          <p className="mx-auto mt-5 max-w-md text-balance text-base leading-[1.9] text-ink-soft lg:mx-0">
            كل ما تحتاجه من وشاح، روب، قبعة. صمّم تفاصيل تخرجك بنفسك وتابع طلبك
            خطوة بخطوة — من مكان واحد.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
            <StoreButton
              href={PLAY_URL}
              icon={<PlayIcon className="size-7" />}
              small="احصل عليه من"
              big="Google Play"
            />
            {/* Rendered only when the numeric App Store id is configured — a button that
                goes nowhere is worse than no button. See APP_STORE_URL in lib/app-gate.ts. */}
            {APP_STORE_URL && (
              <StoreButton
                href={APP_STORE_URL}
                icon={<AppleIcon className="size-7" />}
                small="حمّله من"
                big="App Store"
              />
            )}
          </div>

          <ul className="mt-10 grid grid-cols-3 gap-3 border-t border-line pt-8 lg:gap-5">
            <HeroFeature icon={<BrushIcon className="size-6" />} label="صمّم وشاحك بنفسك" />
            <HeroFeature icon={<CashIcon className="size-6" />} label="الدفع عند الاستلام" />
            <HeroFeature icon={<BoxIcon className="size-6" />} label="خامات وجودة عالية" />
          </ul>
        </div>

        <PhoneDuo />
      </div>
    </section>
  );
}

function HeroFeature({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <li className="flex flex-col items-center gap-2.5 text-center lg:items-start lg:text-start">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-peach/60 text-orange-ink">
        {icon}
      </span>
      <span className="text-[13px] font-semibold leading-[1.6] text-ink">{label}</span>
    </li>
  );
}

function StoreButton({
  href,
  icon,
  small,
  big,
}: {
  href: string;
  icon: React.ReactNode;
  small: string;
  big: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-14 items-center gap-3 rounded-2xl bg-ink px-5 py-2.5 text-white shadow-[var(--shadow-float)] transition-transform duration-200 ease-out hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-ink"
    >
      {icon}
      <span className="flex flex-col items-start leading-tight">
        <span className="text-[11px] font-medium text-white/80">{small}</span>
        <span className="font-display text-base font-bold tracking-tight" dir="ltr">
          {big}
        </span>
      </span>
    </a>
  );
}

/* ───────────────────────── the two phone mockups ───────────────────────── */

/**
 * Built in markup rather than screenshotted. A screenshot of the app would be
 * stale the first time a product tile changes, would ship a 500 KB PNG to a
 * student on a slow connection, and would blur on a retina phone. This renders
 * the SHAPE of the app — header, search, tiles, tab bar — with the shop's real
 * photography inside it, at any DPI, for a few KB of CSS.
 */
/**
 * Two real screenshots of the running app — the storefront home and a product
 * page — at 390x844 @3x, taken from the live build against the live database.
 *
 * ⚠️ THEY ARE A SNAPSHOT AND WILL GO STALE. This replaced a hand-built markup
 * mock (owner, 2026-09-12: «get a real photos from app»), and the trade is
 * honesty now for maintenance later: a redesign of the storefront makes these
 * wrong, and nothing in the build will say so. Re-take them the same way —
 * `docs/get-app-screenshots.md` has the recipe — rather than editing the files.
 * The number visible in app-home.webp is frozen at the moment of capture; the
 * LIVE one is the counter beside the badge above, which reads the shop feed.
 */
function PhoneDuo() {
  return (
    <div className="relative mx-auto w-full max-w-[440px] lg:max-w-none">
      <div className="relative flex items-center justify-center">
        {/* Back phone — the product page. Tucked behind and tilted; hidden on the
            narrowest screens, where two phones become a smudge. */}
        <div className="hidden w-[46%] -translate-x-[14%] translate-y-6 rotate-[7deg] sm:block">
          <PhoneFrame
            src="/get-app/app-product.webp"
            alt="صفحة منتج داخل تطبيق لولو شوب — وشاح الفراشة بخط عربي وشعار الكلية"
          />
        </div>

        {/* Front phone — the home screen. */}
        <div className="w-[62%] max-w-[260px] sm:w-[52%] sm:-rotate-[6deg]">
          <PhoneFrame
            src="/get-app/app-home.webp"
            alt="الشاشة الرئيسية في تطبيق لولو شوب — صورة دفعة تخرج وعدد الطلبة المسجّلين"
            eager
          />
        </div>
      </div>
    </div>
  );
}

function PhoneFrame({ src, alt, eager }: { src: string; alt: string; eager?: boolean }) {
  return (
    <div className="relative aspect-[390/844] w-full rounded-[2.2rem] border-[6px] border-[#22201d] bg-[#22201d] shadow-[var(--shadow-pop)]">
      <div className="relative h-full w-full overflow-hidden rounded-[1.8rem] bg-beige">
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(min-width: 1024px) 280px, 60vw"
          /* NOT `priority` — a silent no-op in Next 16 (see BrandLogo). */
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : undefined}
          className="object-cover object-top"
        />
      </div>
    </div>
  );
}

function ValueRow({ graduates }: { graduates: number | null }) {
  const cards = [
    {
      icon: <CrownIcon className="size-7" />,
      title: "تجربة تسوّق سهلة",
      body: "اختر، صمّم، وأرسل طلبك بدقائق من هاتفك.",
    },
    {
      icon: <StarIcon className="size-7" />,
      title: "تصاميم حصرية للتخرج",
      body: "خط عربي، شعار كليتك، واسمك — مطرّزة كما تريدها.",
    },
    {
      icon: <HeartIcon className="size-7" />,
      /* «سجّلوا معنا» is what the number actually counts — see the file header.
         The fallback claims nothing rather than guessing a figure. */
      title: graduates
        ? `${graduates.toLocaleString("en-US")} طالب وطالبة`
        : "طلبة من كل العراق",
      body: graduates
        ? "سجّلوا معنا من جامعات وكليات العراق، دفعة بعد دفعة."
        : "من جامعات وكليات العراق، دفعة بعد دفعة.",
    },
  ];

  return (
    <section className="mx-auto max-w-6xl px-5 pb-4">
      <div className="grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.title}
            className="flex flex-col items-center gap-3 bg-beige px-6 py-8 text-center"
          >
            <span className="text-orange">{c.icon}</span>
            <h2 className="font-display-ar text-lg font-bold leading-[1.5] text-ink">
              {c.title}
            </h2>
            <p className="max-w-[24ch] text-[13px] leading-[1.8] text-muted">{c.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────── closing banner ─────────────────────────── */

function ClosingBanner() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-10">
      {/*
        ⚠️ THE DARK END OF THE GRADIENT IS UNDER THE TEXT, AND THAT IS THE WHOLE POINT.
        White on the brand orange (#f47b42) is ~2.6:1 — it fails WCAG for body copy and is
        borderline even for the heading. `from-` is the RIGHT edge for `to-l`, which in RTL is
        where the copy sits, so the copy rides --color-orange-ink (~4.8:1 with white) while the
        cap gets the light end. Flipping the stops keeps the same picture and breaks the
        contrast.
      */}
      <div className="relative overflow-hidden rounded-[var(--radius-card)] bg-gradient-to-l from-orange-ink via-orange to-orange-light px-6 py-10 shadow-[var(--shadow-float)] sm:px-10">
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-16 end-[-4%] h-56 w-56 rounded-full bg-white/15"
        />

        <div className="relative flex flex-col items-center gap-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-center sm:text-start">
            <div className="flex items-center justify-center gap-2.5 sm:justify-start">
              <BagIcon className="size-6 text-white" />
              <h2 className="font-display-ar text-[clamp(1.4rem,5vw,1.9rem)] font-bold leading-[1.5] text-white">
                لحظاتك المميزة تستحق الأفضل
              </h2>
            </div>
            <p className="mt-3 text-sm leading-[1.9] text-white/90">
              ✨ حمّل التطبيق الآن وابدأ رحلتك مع لولوشوب
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
              <a
                href={PLAY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-12 items-center gap-2 rounded-pill bg-white px-5 text-sm font-bold text-ink shadow-[var(--shadow-soft)] transition-transform duration-200 ease-out hover:-translate-y-0.5"
              >
                <PlayIcon className="size-5" />
                Google Play
              </a>
              {APP_STORE_URL && (
                <a
                  href={APP_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-12 items-center gap-2 rounded-pill bg-ink px-5 text-sm font-bold text-white shadow-[var(--shadow-soft)] transition-transform duration-200 ease-out hover:-translate-y-0.5"
                >
                  <AppleIcon className="size-5" />
                  App Store
                </a>
              )}
            </div>
          </div>

          <div className="relative w-40 shrink-0 sm:w-52">
            {/* cap.webp, not gown-sash.png: the gown shot is a studio photo on an opaque
                near-white ground, which would sit on the orange as a white rectangle. This
                one is genuinely transparent (verified: every corner pixel is alpha 0). */}
            <Image
              src="/showcase/cap.webp"
              alt="قبعة تخرج من لولو شوب"
              width={520}
              height={283}
              sizes="(min-width: 640px) 208px, 160px"
              /* `mix-blend-multiply`, not a drop-shadow: the cutout is transparent at the
                 corners but keeps the studio's own pale ground shadow under the cap, which
                 reads as a white smear on orange. Multiplying maps that near-white to the
                 banner colour (white × orange = orange) and leaves the black cap untouched. */
              className="h-auto w-full object-contain mix-blend-multiply"
            />
            {/* Amiri, not Great Vibes — the script face is Latin-only and would silently
                fall back to a generic cursive for Arabic. */}
            <span className="mt-2 block text-center font-display-ar text-xl font-bold text-white">
              تخرّج بأسلوبك
            </span>
          </div>
        </div>
      </div>

      {/*
        The one thing neither store can do for us. Google Play carries `?referrer=` through an
        install, but the App Store passes NOTHING into a freshly installed app — deferred deep
        linking is not an iOS feature, and the workarounds are paid fingerprint SDKs or
        clipboard sniffing. So a student who installs FROM a link does not land back on it,
        and the only honest instruction is to tap it again.

        Referral links themselves no longer take this path — `/join` is allowlisted in
        BROWSER_ALLOWED_PREFIXES, so they open in the browser instead of bouncing here.
      */}
      <p className="mx-auto mt-8 max-w-md text-center text-xs leading-[1.9] text-muted">
        وصلت من رابط ممثل؟ بعد تثبيت التطبيق، ارجع واضغط على الرابط مرة ثانية — راح يفتح داخل
        التطبيق مباشرة.
      </p>
    </section>
  );
}

/* ─────────────────────────────── footer ─────────────────────────────── */

function SiteFooter() {
  return (
    <footer className="safe-bottom safe-x border-t border-line bg-beige">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-5 py-8 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col items-center gap-2 md:items-start">
          <span className="flex items-center gap-2.5">
            <BrandMark size={34} />
            <span className="font-display text-base font-bold text-ink">LoloShop</span>
          </span>
          <span className="text-xs text-muted">متجرك الأول لمنتجات التخرج والمناسبات</span>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-ink-soft">
          <a href="/privacy" className="transition-colors hover:text-orange-ink">
            سياسة الخصوصية
          </a>
          <a href="/terms" className="transition-colors hover:text-orange-ink">
            شروط الاستخدام
          </a>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-orange-ink"
          >
            تواصل معنا
          </a>
        </nav>

        <div className="flex flex-col items-center gap-3 md:items-end">
          <a
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="إنستغرام لولو شوب"
            className="flex size-10 items-center justify-center rounded-pill border border-line text-ink-soft transition-colors hover:border-orange hover:text-orange-ink"
          >
            <InstagramIcon className="size-5" />
          </a>
          <span className="text-[11px] text-muted">
            جميع الحقوق محفوظة © ٢٠٢٦ لولو شوب
          </span>
        </div>
      </div>
    </footer>
  );
}

/* ──────────────────────────────── icons ────────────────────────────────
   Inline so the page ships zero icon dependencies and every stroke inherits
   currentColor. `stroke-width` is 1.7 throughout — the storefront's weight. */

type IconProps = { className?: string };

function BagIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M5 8h14l-1 11.5a1.5 1.5 0 0 1-1.5 1.4h-11A1.5 1.5 0 0 1 4 19.5L5 8Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M9 10V7a3 3 0 1 1 6 0v3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M3.6 2.3 14 12 3.6 21.7a1.6 1.6 0 0 1-.6-1.3V3.6c0-.5.2-1 .6-1.3Z" fill="#34a853" />
      <path d="M14 12 3.6 2.3A1.5 1.5 0 0 1 4.5 2c.3 0 .6.1.8.2l12 6.8L14 12Z" fill="#ea4335" />
      <path d="m14 12 3.3-3 3.1 1.7c1 .6 1 2 0 2.6L17.3 15 14 12Z" fill="#fbbc04" />
      <path d="M14 12l3.3 3-12 6.8c-.3.2-.5.2-.8.2-.3 0-.6-.1-.9-.3L14 12Z" fill="#4285f4" />
    </svg>
  );
}

function AppleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M16.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.9-3.5.9-.7 0-1.8-.8-3-.8-1.5 0-2.9.9-3.7 2.3-1.6 2.7-.4 6.8 1.1 9 .8 1.1 1.6 2.3 2.8 2.3 1.1 0 1.6-.7 2.9-.7 1.3 0 1.7.7 2.9.7s2-1.1 2.7-2.2c.9-1.2 1.2-2.4 1.2-2.5 0 0-2.4-.9-2.4-3.7ZM14.2 5.8c.6-.8 1-1.8.9-2.9-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-.9 2.8 1 0 2-.5 2.7-1.3Z" />
    </svg>
  );
}

function BrushIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M16.5 3.9 20 7.4 10.4 17a3 3 0 0 1-1.4.8l-3.6.9.9-3.6A3 3 0 0 1 7 13.6l9.5-9.7Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M14.4 6 18 9.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function CashIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <rect
        x="2.6"
        y="6"
        width="18.8"
        height="12"
        rx="2.4"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6 9.6v4.8M18 9.6v4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function BoxIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M12 2.9 20.5 7v10L12 21.1 3.5 17V7L12 2.9Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M3.5 7 12 11.4 20.5 7M12 11.4v9.7" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function CrownIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M3 7.5 6.6 11 12 4.6 17.4 11 21 7.5V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V7.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="m12 3.4 2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.8-5.4 2.8 1-6L3.2 9.8l6.1-.9L12 3.4Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HeartIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M12 20s-7.6-4.4-7.6-9.4A4.1 4.1 0 0 1 12 8.1a4.1 4.1 0 0 1 7.6 2.5C19.6 15.6 12 20 12 20Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}






function InstagramIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <rect x="3.4" y="3.4" width="17.2" height="17.2" rx="5" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17.1" cy="6.9" r="1.1" fill="currentColor" />
    </svg>
  );
}
