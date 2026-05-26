import Link from "next/link";

export default function SizesPage() {
  return (
    <div dir="rtl" lang="ar" className="min-h-screen bg-cream px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/"
          className="flex items-center gap-1 text-sm font-medium text-orange hover:underline"
        >
          <span>→</span>
          <span>المتجر</span>
        </Link>
      </div>

      <h1 className="mb-8 font-display text-2xl font-bold text-ink">
        مقاسات المنتجات
      </h1>

      {/* Robe Size Chart */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-bold text-ink">روب التخرج</h2>

        <div className="overflow-x-auto rounded-xl border border-ink/10 shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-orange/90 text-white">
                <th className="px-4 py-3 text-right font-semibold">المقاس</th>
                <th className="px-4 py-3 text-right font-semibold">
                  الطول (سم)
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  الصدر (سم)
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  الوزن التقريبي (كغ)
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-beige">
                <td className="px-4 py-3 font-bold text-orange">S</td>
                <td className="px-4 py-3 text-ink/80">155–165</td>
                <td className="px-4 py-3 text-ink/80">86–92</td>
                <td className="px-4 py-3 text-ink/80">50–65</td>
              </tr>
              <tr className="bg-cream">
                <td className="px-4 py-3 font-bold text-orange">M</td>
                <td className="px-4 py-3 text-ink/80">163–170</td>
                <td className="px-4 py-3 text-ink/80">94–100</td>
                <td className="px-4 py-3 text-ink/80">65–80</td>
              </tr>
              <tr className="bg-beige">
                <td className="px-4 py-3 font-bold text-orange">L</td>
                <td className="px-4 py-3 text-ink/80">168–175</td>
                <td className="px-4 py-3 text-ink/80">102–108</td>
                <td className="px-4 py-3 text-ink/80">78–95</td>
              </tr>
              <tr className="bg-cream">
                <td className="px-4 py-3 font-bold text-orange">XL</td>
                <td className="px-4 py-3 text-ink/80">173–180</td>
                <td className="px-4 py-3 text-ink/80">110–116</td>
                <td className="px-4 py-3 text-ink/80">90–110</td>
              </tr>
              <tr className="bg-beige">
                <td className="px-4 py-3 font-bold text-orange">XXL</td>
                <td className="px-4 py-3 text-ink/80">178–185</td>
                <td className="px-4 py-3 text-ink/80">118–124</td>
                <td className="px-4 py-3 text-ink/80">105+</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-3 rounded-lg bg-peach/40 px-4 py-3 text-sm text-ink/70">
          القياسات تقريبية — إذا كنت بين مقاسين اختر الأكبر
        </p>
      </section>

      {/* Cap Section */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-bold text-ink">قبعة التخرج</h2>
        <div className="rounded-xl border border-ink/10 bg-beige p-5 space-y-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-orange">●</span>
            <p className="text-sm text-ink/80">
              قياس موحد يناسب معظم الرؤوس
            </p>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-orange">●</span>
            <p className="text-sm text-ink/80">
              محيط الرأس المناسب: <span className="font-semibold text-ink">54–60 سم</span>
            </p>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-orange">●</span>
            <p className="text-sm text-ink/80">
              يمكن ضبط الحجم عبر الشريط الداخلي
            </p>
          </div>
        </div>
      </section>

      {/* WhatsApp note */}
      <section className="mb-8 rounded-xl border border-orange/30 bg-orange/5 p-5">
        <p className="text-sm font-semibold text-ink">هل تحتاج مقاساً مخصصاً؟</p>
        <p className="mt-1 text-sm text-ink/70">
          تواصل معنا عبر واتساب وسنساعدك في اختيار المقاس المناسب.
        </p>
        <a
          href="https://wa.me/964"
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-orange px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-light"
        >
          تواصل عبر واتساب
        </a>
      </section>

      {/* Footer note */}
      <p className="text-center text-xs text-ink/50">
        الدفع نقداً عند الاستلام — لا دفع إلكتروني
      </p>
    </div>
  );
}
