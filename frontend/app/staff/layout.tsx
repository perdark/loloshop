"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { StaffSidebar } from "@/components/staff/StaffSidebar";
import { BrandMark } from "@/components/ui/BrandLogo";
import { PageLoader } from "@/components/ui/Spinner";
import { useRequireAuth } from "@/hooks/useRequireAuth";

function StaffShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireAuth(["staff", "admin"]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (loading || !user) {
    return <PageLoader />;
  }

  const isAdmin = user.role === "admin";

  return (
    <div className="min-h-screen bg-cream bg-warm-veil" dir="rtl" lang="ar">
      <Suspense fallback={null}>
        <StaffSidebar
          user={user}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
      </Suspense>

      <div className="lg:ms-64">
        {/* Mobile header — flat bg-cream (no backdrop-blur for low-end Android perf) */}
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-cream px-4 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface text-ink shadow-[var(--shadow-soft)] transition-colors hover:border-orange-ink/40 hover:text-orange-ink"
            aria-label="فتح القائمة"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <span className="font-display text-lg font-bold text-ink">
            {isAdmin ? "الإنتاج والمتابعة" : "لوحة الموظف"}
          </span>
          <div className="ms-auto flex items-center gap-2">
            {isAdmin && (
              <Link
                href="/admin"
                className="flex h-9 items-center rounded-lg border border-orange-ink/30 bg-orange-ink/8 px-3 text-xs font-semibold text-orange-ink transition-colors hover:bg-orange-ink/15"
              >
                لوحة التحكم
              </Link>
            )}
            <BrandMark size={36} />
          </div>
        </header>

        <main className="p-4 lg:p-8 animate-fade-page-in">{children}</main>
      </div>
    </div>
  );
}

export default function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <StaffShell>{children}</StaffShell>;
}
