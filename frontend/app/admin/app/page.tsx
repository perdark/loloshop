"use client";

/**
 * /admin/app — «التطبيق والإشعارات».
 *
 * Two things the admin could not do before this page existed: see how the app is doing on each
 * platform, and send a notification they wrote themselves.
 *
 * They sit on one page because they answer each other. «كم شخص يوصله إشعار؟» is a statistic,
 * and it is also the single most important number to read before pressing send — so the
 * composer resolves it live rather than making the sender scroll up and remember it.
 */

import { AppStatsPanel } from "@/components/admin/AppStatsPanel";
import { PushComposer } from "@/components/admin/PushComposer";

export default function AdminAppPage() {
  return (
    <div dir="rtl" lang="ar" className="space-y-8 animate-fade-page-in">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          التطبيق والإشعارات
        </h1>
        <p className="mt-1.5 text-sm text-ink/50">
          أرقام التطبيق على الأندرويد والآيفون، وإرسال إشعار لأي مجموعة.
        </p>
      </header>

      <AppStatsPanel />
      <PushComposer />
    </div>
  );
}
