"use client";

import Link from "next/link";
import { VipShowcase } from "@/components/vip/VipShowcase";

export default function VipPage() {
  return (
    <div className="animate-page-in space-y-6 pb-24" dir="rtl" lang="ar">
      <Link
        href="/"
        className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-orange-ink transition-colors hover:text-ink"
      >
        <span aria-hidden>→</span>
        المتجر
      </Link>

      <div>
        <h1 className="font-display-ar text-2xl font-bold leading-tight text-ink [text-wrap:balance]">
          باقات التخرج الكاملة
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          كل ما تحتاجه لحفل التخرج في مجموعة واحدة — الروب والوشاح والقبعة.
          اختر الباقة لتكمل اختيار شكل القبعة وتبدأ تصميم وشاحك.
        </p>
      </div>

      <VipShowcase />
    </div>
  );
}
