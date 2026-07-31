import type { Metadata } from "next";
import { APP_STORE_URL, PLAY_URL } from "@/lib/app-gate";

/**
 * Desktop / unknown-device fallback for the app-only gate. Phones are redirected straight
 * to their store and never see this page — it exists for laptops, where "open the store app"
 * is meaningless.
 *
 * DELIBERATELY MINIMAL: the real marketing landing page is a separate job the owner is doing
 * later. This is a placeholder that must not look broken, not a brand statement.
 */
export const metadata: Metadata = {
  title: "حمّل التطبيق",
  description: "لولو شوب صار تطبيق — حمّله على هاتفك لتصميم وشاح تخرجك ومتابعة طلبك.",
};

export default function GetAppPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-beige px-6 py-16 text-center">
      <div className="space-y-3">
        <h1 className="font-display text-3xl font-bold text-ink sm:text-4xl">
          لولو شوب صار تطبيق
        </h1>
        <p className="mx-auto max-w-md text-base leading-relaxed text-ink-soft">
          حمّل التطبيق على هاتفك لتصميم وشاح تخرجك، ومتابعة طلبك، والدخول إلى حسابك.
        </p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        <a
          href={PLAY_URL}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-pill bg-orange-ink px-6 text-sm font-semibold text-white transition-colors duration-200 ease-out hover:bg-ink"
        >
          تحميل لأجهزة أندرويد
        </a>
        {/* Rendered only when the numeric App Store id is configured — a button that goes
            nowhere is worse than no button. See APP_STORE_URL in lib/app-gate.ts. */}
        {APP_STORE_URL && (
          <a
            href={APP_STORE_URL}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-pill border border-ink/15 bg-white px-6 text-sm font-semibold text-ink transition-colors duration-200 ease-out hover:border-ink/30"
          >
            تحميل لأجهزة آيفون
          </a>
        )}
      </div>

      <p className="text-xs text-ink-soft">
        افتح هذه الصفحة من هاتفك لتنتقل مباشرة إلى المتجر.
      </p>
    </main>
  );
}
