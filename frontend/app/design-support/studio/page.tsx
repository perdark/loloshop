"use client";

import Link from "next/link";
import { StudioTool } from "@/components/studio/StudioTool";
import { PageLoader } from "@/components/ui/Spinner";
import { useRequireAuth } from "@/hooks/useRequireAuth";

// The studio tool for أيادي التصميم. Same component as /admin/studio and /staff/studio.
// The backend opens /studio/* to role='design_helper' (active member) in allowToolUser,
// exactly like /calligraphy/* — mirrors app/design-support/calligraphy/page.tsx.
export default function DesignSupportStudioPage() {
  const { user, loading } = useRequireAuth(["design_helper", "admin", "staff"]);

  if (loading || !user) return <PageLoader />;

  return (
    <div className="safe-bottom safe-x min-h-dvh bg-cream" dir="rtl" lang="ar">
      <header className="sticky top-0 z-20 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <div>
            <p className="text-xs font-medium text-orange-ink">لولو شوب</p>
            <p className="font-display-ar text-xl font-bold text-ink">ChatGPT</p>
          </div>
          <Link
            href="/design-support"
            className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface-sink px-4 text-sm font-semibold text-ink transition-colors hover:border-orange-ink/40 hover:text-orange-ink"
          >
            ← رجوع للتصميم
          </Link>
        </div>
      </header>
      <StudioTool />
    </div>
  );
}
