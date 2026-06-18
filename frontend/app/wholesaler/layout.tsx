"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/auth";
import { toast } from "sonner";
import { PageLoader } from "@/components/ui/Spinner";
import { NotificationBell } from "@/components/NotificationBell";
import { useRequireAuth } from "@/hooks/useRequireAuth";

export default function WholesalerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useRequireAuth("wholesaler");
  const pathname = usePathname();

  if (loading || !user) {
    return <PageLoader />;
  }

  function handleLogout() {
    logout();
    toast.success("تم تسجيل الخروج");
    window.location.href = "/login";
  }

  return (
    <div className="min-h-screen bg-cream" dir="rtl" lang="ar">
      <header className="sticky top-0 z-20 border-b border-line bg-cream shadow-[var(--shadow-soft)]">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3.5">
          <h1 className="font-display text-lg font-bold text-ink">لوحة الممثل</h1>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <button
              type="button"
              onClick={handleLogout}
              className="min-h-11 rounded-xl px-4 text-sm font-medium text-ink-soft transition-colors hover:bg-ink/5"
            >
              خروج
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 py-5 pb-28 animate-page-in">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-cream pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-pop)]" aria-label="التنقل الرئيسي">
        <div className="mx-auto flex max-w-md px-2 py-1.5">
          {[
            { href: "/wholesaler", label: "الرئيسية" },
            { href: "/wholesaler/students", label: "الطلاب" },
          ].map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-13 flex-1 flex-col items-center justify-center gap-1 rounded-xl py-1.5 text-sm font-semibold transition-all duration-200 ${
                  active
                    ? "bg-orange/10 text-orange-ink"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute -top-px h-0.5 w-6 rounded-full bg-orange-ink"
                  />
                )}
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
