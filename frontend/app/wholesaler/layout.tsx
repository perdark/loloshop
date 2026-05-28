"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/auth";
import { toast } from "sonner";
import { PageLoader } from "@/components/ui/Spinner";
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
      <header className="sticky top-0 z-20 border-b border-ink/10 bg-cream/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
          <h1 className="font-display text-lg font-bold text-ink">لوحة الممثل</h1>
          <button
            type="button"
            onClick={handleLogout}
            className="min-h-11 rounded-lg px-3 text-sm text-ink/70 hover:bg-ink/5"
          >
            خروج
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 py-4 pb-24 animate-page-in">{children}</main>

      <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-ink/10 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-md">
          {[
            { href: "/wholesaler", label: "الرئيسية" },
            { href: "/wholesaler/students", label: "الطلاب" },
            { href: "/wholesaler/batch", label: "الدفعة" },
            { href: "/wholesaler/package", label: "الباقات" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-14 flex-1 items-center justify-center text-sm font-medium transition-colors duration-200 ${
                pathname === item.href ? "text-orange-ink" : "text-ink/50 hover:text-ink/80"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
