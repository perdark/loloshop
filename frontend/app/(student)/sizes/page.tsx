import Link from "next/link";

export default function SizesPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-orange-ink transition-colors hover:text-orange"
        >
          <span aria-hidden>→</span>
          <span>المتجر</span>
        </Link>
        <h1 className="mt-2 font-display text-2xl font-bold text-ink">
          مقاسات المنتجات
        </h1>
      </div>

      {/* Robe Size Chart */}
      <section>
        <div className="mb-4 flex items-center gap-3">
          <h2 className="whitespace-nowrap font-display text-lg font-bold text-ink">
            روب التخرج
          </h2>
          <span
            aria-hidden
            className="h-px flex-1 bg-gradient-to-l from-transparent via-orange/25 to-orange/40"
          />
        </div>

        <div
          className="overflow-x-auto rounded-2xl ring-1 ring-orange/10"
          role="region"
          aria-label="جدول مقاسات الروب"
          tabIndex={0}
        >
          <p className="px-4 pt-2 pb-0 text-end text-xs text-ink/40 select-none" aria-hidden>
            اسحب ←
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-brand-gradient text-white">
                <th className="px-4 py-3 text-start font-semibold">المقاس</th>
                <th className="px-4 py-3 text-start font-semibold">
                  الطول (سم)
                </th>
                <th className="px-4 py-3 text-start font-semibold">
                  الصدر (سم)
                </th>
                <th className="px-4 py-3 text-start font-semibold">
                  الوزن التقريبي (كغ)
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-beige">
                <td className="px-4 py-3 font-bold text-orange-ink">S</td>
                <td className="px-4 py-3 tabular-nums text-ink-soft">155–165</td>
                <td className="px-4 py-3 tabular-nums text-ink-soft">86–92</td>
                <td className="px-4 py-3 tabular-nums text-ink-soft">50–65</td>
              </tr>
              <tr className="bg-cream">
                <td className="px-4 py-3 font-bold text-orange-ink">M</td>
                <td className="px-4 py-3 tabular-nums text-ink-soft">163–170</td>
                <td className="px-4 py-3 tabular-nums text-ink-soft">94–100</td>
                <td className="px-4 py-3 tabular-nums text-ink-soft">65–80</td>
              </tr>
              <tr className="bg-beige">
                <td className="px-4 py-3 font-bold text-orange-ink">L</td>
                <td className="px-4 py-3 tabular-nums text-ink-soft">168–175</td>
                <td className="px-4 py-3 tabular-nums text-ink-soft">102–108</td>
                <td className="px-4 py-3 tabular-nums text-ink-soft">78–95</td>
              </tr>
              <tr className="bg-cream">
                <td className="px-4 py-3 font-bold text-orange-ink">XL</td>
                <td className="px-4 py-3 tabular-nums text-ink-soft">173–180</td>
                <td className="px-4 py-3 tabular-nums text-ink-soft">110–116</td>
                <td className="px-4 py-3 tabular-nums text-ink-soft">90–110</td>
              </tr>
              <tr className="bg-beige">
                <td className="px-4 py-3 font-bold text-orange-ink">XXL</td>
                <td className="px-4 py-3 tabular-nums text-ink-soft">178–185</td>
                <td className="px-4 py-3 tabular-nums text-ink-soft">118–124</td>
                <td className="px-4 py-3 tabular-nums text-ink-soft">105+</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-3 rounded-xl bg-peach/40 px-4 py-3 text-sm text-ink-soft">
          القياسات تقريبية — إذا كنت بين مقاسين اختر الأكبر
        </p>
      </section>

      {/* Cap Section */}
      <section>
        <div className="mb-4 flex items-center gap-3">
          <h2 className="whitespace-nowrap font-display text-lg font-bold text-ink">
            قبعة التخرج
          </h2>
          <span
            aria-hidden
            className="h-px flex-1 bg-gradient-to-l from-transparent via-orange/25 to-orange/40"
          />
        </div>
        <div className="space-y-3 rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-start gap-2.5">
            <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-gradient" />
            <p className="text-sm text-ink-soft">
              قياس موحد يناسب معظم الرؤوس
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-gradient" />
            <p className="text-sm text-ink-soft">
              محيط الرأس المناسب: <span className="font-semibold tabular-nums text-ink">54–60 سم</span>
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-gradient" />
            <p className="text-sm text-ink-soft">
              يمكن ضبط الحجم عبر الشريط الداخلي
            </p>
          </div>
        </div>
      </section>

      {/* WhatsApp note */}
      <section className="rounded-2xl border border-orange/30 bg-orange/5 p-5 ring-1 ring-orange/10">
        <p className="font-display text-base font-bold text-ink">هل تحتاج مقاساً مخصصاً؟</p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
          تواصل معنا عبر واتساب وسنساعدك في اختيار المقاس المناسب.
        </p>
        <a
          href="https://wa.me/964"
          className="btn-shine mt-4 inline-flex min-h-11 items-center gap-2 rounded-pill bg-brand-gradient px-6 text-sm font-bold text-white shadow-[var(--shadow-pop)] transition-transform hover:scale-[1.02] active:scale-100"
        >
          تواصل عبر واتساب
        </a>
      </section>

      {/* Footer note */}
      <p className="text-center text-xs text-[var(--shop-muted)]">
        الدفع نقداً عند الاستلام — لا دفع إلكتروني
      </p>
    </div>
  );
}
