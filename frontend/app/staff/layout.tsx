"use client";

import { Suspense, useState } from "react";
import { StaffSidebar } from "@/components/staff/StaffSidebar";
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

      <div className="lg:mr-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-ink/10 bg-cream/95 px-4 py-3 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-ink/15 text-ink"
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
        </header>

        <main className="p-4 lg:p-8">{children}</main>
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
