"use client";

import { Suspense, useState } from "react";
import { StaffSidebar } from "@/components/staff/StaffSidebar";
import { BrandMark } from "@/components/ui/BrandLogo";
import { PageLoader } from "@/components/ui/Spinner";
import { useRequireAuth } from "@/hooks/useRequireAuth";

function StaffShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireAuth("staff");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (loading || !user) {
    return <PageLoader />;
  }

  return (
    <div className="min-h-screen bg-cream" dir="rtl" lang="ar">
      <Suspense fallback={null}>
        <StaffSidebar
          user={user}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
      </Suspense>

      <div className="lg:ms-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-ink/10 bg-cream/85 px-4 py-3 backdrop-blur-md lg:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-ink/15 bg-white text-ink shadow-[var(--shadow-soft)] transition-colors hover:border-orange/40 hover:text-orange-ink"
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
            لوحة الموظف
          </span>
          <BrandMark size={36} className="ms-auto" />
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
