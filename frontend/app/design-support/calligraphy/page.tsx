"use client";

import Link from "next/link";
import { CalligraphyTool } from "@/components/calligraphy/CalligraphyTool";
import { PageLoader } from "@/components/ui/Spinner";
import { useRequireAuth } from "@/hooks/useRequireAuth";

// The Arabic-calligraphy tool for أيادي التصميم. Same component as
// /admin/calligraphy and /staff/calligraphy. The backend opens /calligraphy/* to
// role='design_helper' (active member) in allowCalligraphyUser, so محمد هيثم and
// his team can generate name plates here without a staff account.
export default function DesignSupportCalligraphyPage() {
  const { user, loading } = useRequireAuth(["design_helper", "admin", "staff"]);

  if (loading || !user) return <PageLoader />;

  return (
    <div className="safe-bottom safe-x min-h-screen bg-cream" dir="rtl" lang="ar">
      <header className="sticky top-0 z-20 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <div>
            <p className="text-xs font-medium text-orange-ink">لولو شوب</p>
            <p className="font-display-ar text-xl font-bold text-ink">الخط العربي</p>
          </div>
          <Link
            href="/design-support"
            className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface-sink px-4 text-sm font-semibold text-ink transition-colors hover:border-orange-ink/40 hover:text-orange-ink"
          >
            ← رجوع للتصميم
          </Link>
        </div>
      </header>
      <CalligraphyTool />
    </div>
  );
}
