"use client";

import { useState } from "react";
import { AdminSidebar } from "@/components/AdminSidebar";
import { BrandMark } from "@/components/ui/BrandLogo";
import { NotificationBell } from "@/components/NotificationBell";
import { PageLoader } from "@/components/ui/Spinner";
import { useRequireAuth } from "@/hooks/useRequireAuth";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useRequireAuth("admin");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (loading || !user) {
    return <PageLoader />;
  }

  return (
    <div className="shop-paper min-h-screen bg-cream bg-warm-veil" dir="rtl" lang="ar">
      <AdminSidebar
        user={user}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:ms-64">
        <header className="safe-top safe-x sticky top-0 z-20 flex items-center gap-3 border-b border-ink/10 bg-[var(--shop-paper)] px-4 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-ink/15 bg-beige text-ink transition-colors hover:border-orange/40 hover:text-orange-ink"
            aria-label="فتح القائمة"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <BrandMark size={32} />
          <span className="font-display text-base font-bold text-ink">لولو شوب</span>
          {/* The admin bell was missing entirely: the backend already writes admin
              `notifications` rows (the assistant's budget warning, the nightly staff report) and
              there was no screen to read them on — so a missed push was a lost message. */}
          <div className="ms-auto">
            <NotificationBell />
          </div>
        </header>

        {/* Desktop has no header bar at all (the sidebar is the chrome), so the bell needs its
            own anchor — admin is laptop-primary, which is exactly where it would be missed. */}
        <div className="sticky top-0 z-20 hidden justify-end px-8 pt-4 lg:flex">
          <NotificationBell />
        </div>

        <main className="safe-bottom safe-x mx-auto w-full max-w-6xl p-4 lg:p-8 animate-fade-page-in">{children}</main>
      </div>
    </div>
  );
}
