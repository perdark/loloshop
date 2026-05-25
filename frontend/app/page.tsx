import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-cream px-4">
      <div className="w-full max-w-md text-center">
        <p className="font-display text-4xl font-bold text-ink">لولو شوب</p>
        <p className="mt-3 text-ink/70">
          أوشحة وروبات تخرج — صمم وشاحك بأسلوبك
        </p>
        <div className="mt-10 flex flex-col gap-3">
          <Link
            href="/shop"
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-orange px-6 py-3 font-semibold text-white transition-colors hover:bg-orange-light"
          >
            تصفّح المنتجات
          </Link>
          <Link
            href="/login"
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-ink/20 px-6 py-3 font-semibold text-ink transition-colors hover:bg-ink/5"
          >
            تسجيل الدخول
          </Link>
          <p className="text-xs text-ink/50">@loloshop96</p>
        </div>
      </div>
    </div>
  );
}
