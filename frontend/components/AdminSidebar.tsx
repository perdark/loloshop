"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/ui/BrandLogo";
import { logout, setSkipDashboardRedirect } from "@/lib/auth";
import { toast } from "sonner";
import type { User } from "@/lib/types";

const navItems: {
  href: string;
  label: string;
  exact: boolean;
}[] = [
  { href: "/admin", label: "لوحة التحكم", exact: true },
  { href: "/admin/orders", label: "الطلبات", exact: false },
  { href: "/design-support", label: "أيادي التصميم", exact: false },
  { href: "/admin/custom-order", label: "طلب مخصص", exact: false },
  { href: "/admin/attendance", label: "بصمة الموظفين", exact: false },
  { href: "/admin/payouts", label: "تحويل الرواتب", exact: false },
  { href: "/admin/wholesalers", label: "الممثلون", exact: false },
  { href: "/admin/products", label: "الكتالوج", exact: false },
  { href: "/admin/packages", label: "باقات VIP", exact: false },
  { href: "/admin/calligraphy", label: "الخط العربي", exact: false },
  { href: "/admin/workshop", label: "الورشة", exact: false },
  { href: "/staff", label: "الإنتاج ومتابعة الموظفين", exact: false },
];

interface AdminSidebarProps {
  user: User;
  open: boolean;
  onClose: () => void;
}

export function AdminSidebar({ user, open, onClose }: AdminSidebarProps) {
  const pathname = usePathname();
  const onCloseRef = useRef(onClose);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Modal drawer accessibility: focus trap, Escape key, body scroll lock
  useEffect(() => {
    if (!open) return;

    const prevFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";

    // Move focus into panel on open
    requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelector<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      focusable?.focus();
    });

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.closest('[aria-hidden="true"]'));
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prevFocus?.focus?.();
    };
  }, [open]);

  function handleLogout() {
    logout();
    toast.success("تم تسجيل الخروج");
    window.location.href = "/login";
  }

  function isActive(href: string, exact: boolean) {
    if (href === "#") return false;
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  }

  const sidebar = (
    <aside className="relative flex h-full w-64 flex-col overflow-hidden bg-ink text-cream">
      <div className="relative border-b border-cream/10 px-5 py-6">
        <div className="flex items-center gap-3">
          <BrandMark size={56} eager />
          <div>
            <p className="font-display text-base font-semibold text-cream/90">لولو شوب</p>
            <p className="text-xs tracking-wide text-cream/55">لوحة المدير</p>
          </div>
        </div>
      </div>

      <nav className="relative min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClose}
            className={`block min-h-11 rounded-xl px-3 py-2.5 text-sm transition-colors duration-200 ${
              isActive(item.href, item.exact)
                ? "bg-cream/12 font-semibold text-cream"
                : "text-cream/70 hover:bg-cream/8 hover:text-cream"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="relative border-t border-cream/10 px-5 py-4">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="truncate text-xs text-cream/50" dir="ltr">{user.phone}</p>
        <Link
          href="/"
          onClick={() => {
            setSkipDashboardRedirect();
            onClose();
          }}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-cream/20 py-2 text-sm text-cream/80 transition-colors hover:border-cream/40 hover:bg-cream/10 hover:text-cream"
        >
          <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M9 22V12h6v10" />
          </svg>
          زيارة الموقع الرئيسي
        </Link>
        <button
          type="button"
          onClick={handleLogout}
          className="mt-3 min-h-11 w-full rounded-xl border border-cream/20 py-2 text-sm text-cream/80 transition-colors hover:border-cream/40 hover:bg-cream/10 hover:text-cream"
        >
          تسجيل الخروج
        </button>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:fixed lg:inset-y-0 lg:start-0 lg:z-30 lg:block lg:shadow-[var(--shadow-float)]">
        {sidebar}
      </div>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/60 backdrop-blur-sm animate-fade-page-in"
            onClick={onClose}
            role="presentation"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="قائمة التنقل"
            className="absolute inset-y-0 start-0 shadow-[var(--shadow-pop)]"
          >
            {sidebar}
          </div>
        </div>
      )}
    </>
  );
}
