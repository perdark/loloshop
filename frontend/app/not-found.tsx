import Link from "next/link";
import { BrandMark } from "@/components/ui/BrandLogo";

/**
 * Lookbook-styled 404 page.
 * Server Component — no interactivity needed.
 * Design: warm paper canvas, Amiri display heading, earned-orange CTA only.
 */
export default function NotFound() {
  return (
    <main
      dir="rtl"
      lang="ar"
      className="min-h-screen bg-cream flex flex-col items-center justify-center px-6 py-20 text-center"
    >
      {/* Brand anchor */}
      <Link href="/" aria-label="لولو شوب — الصفحة الرئيسية" className="mb-12 inline-flex">
        <BrandMark size={56} eager />
      </Link>

      {/* Error code — minimal, typographic */}
      <p
        className="font-display-ar text-[clamp(4rem,18vw,9rem)] font-semibold leading-none tracking-tight text-line select-none"
        aria-hidden="true"
      >
        ٤٠٤
      </p>

      {/* Primary heading — Amiri at display scale, calligraphic confidence */}
      <h1 className="font-display-ar mt-4 text-[clamp(1.5rem,4vw,2.5rem)] font-bold leading-tight text-ink">
        الصفحة غير موجودة
      </h1>

      {/* Body — soft ink on paper, capped measure */}
      <p className="mt-4 text-base leading-relaxed text-ink-soft max-w-[52ch] mx-auto">
        يبدو أن هذه الصفحة انتقلت إلى مكان آخر، أو أن الرابط غير صحيح.
        لا تقلق، يمكنك البدء من الصفحة الرئيسية.
      </p>

      {/* Warm rule — a subtle lookbook divider */}
      <div
        className="mt-8 mb-8 w-16 h-px"
        style={{ background: "var(--color-line)" }}
        aria-hidden="true"
      />

      {/* CTAs — earned orange only on the primary action */}
      <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-xs sm:max-w-none sm:w-auto">
        <Link
          href="/"
          className="btn-shine inline-flex items-center justify-center min-h-[44px] min-w-[44px] w-full sm:w-auto rounded-full bg-orange-ink px-7 py-3 text-base font-semibold text-white shadow-[var(--shadow-soft)] transition-all duration-200 ease-out hover:bg-ink hover:shadow-[var(--shadow-float)] hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          العودة إلى الرئيسية
        </Link>
        <Link
          href="/sizes"
          className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] w-full sm:w-auto rounded-full border border-line bg-surface px-7 py-3 text-base font-semibold text-ink transition-all duration-200 ease-out hover:border-orange/40 hover:text-orange-ink focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          دليل المقاسات
        </Link>
      </div>
    </main>
  );
}
