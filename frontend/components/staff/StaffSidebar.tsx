"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BrandMark } from "@/components/ui/BrandLogo";
import { logout } from "@/lib/auth";
import { toast } from "sonner";
import type { StaffListFilter } from "@/lib/staff-types";
import type { User } from "@/lib/types";

const navItems: { filter: StaffListFilter; label: string; href: string }[] = [
  { filter: "all", label: "لوحة الطلبات", href: "/staff" },
  {
    filter: "review",
    label: "طلبات قيد المراجعة",
    href: "/staff?filter=review",
  },
  {
    filter: "printing",
    label: "جاهز للطباعة",
    href: "/staff?filter=printing",
  },
  { filter: "done", label: "مكتمل", href: "/staff?filter=done" },
  { filter: "all", label: "طلاب الممثلين", href: "/staff/wholesalers" },
];

interface StaffSidebarProps {
  user: User;
  open: boolean;
  onClose: () => void;
}

export function StaffSidebar({ user, open, onClose }: StaffSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentFilter = (searchParams.get("filter") || "all") as StaffListFilter;

  function handleLogout() {
    logout();
    toast.success("تم تسجيل الخروج");
    window.location.href = "/login";
  }

  function isActive(item: (typeof navItems)[0]) {
    if (item.href === "/staff/wholesalers") return pathname.startsWith("/staff/wholesalers");
    if (pathname !== "/staff") return false;
    if (item.filter === "all") {
      return !searchParams.get("filter") || currentFilter === "all";
    }
    return currentFilter === item.filter;
  }

  const sidebar = (
    <aside className="flex h-full w-64 flex-col bg-ink text-cream">
      <div className="relative overflow-hidden border-b border-cream/10 px-5 py-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-10 -end-8 h-28 w-28 rounded-full bg-orange/25 blur-2xl"
        />
        <div className="relative flex items-center gap-3">
          <BrandMark size={56} priority />
          <div>
            <p className="font-display text-base font-semibold text-cream/90">لولو شوب</p>
            <p className="mt-0.5 text-xs text-cream/60">لوحة الموظف</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClose}
            className={`group relative flex min-h-11 items-center rounded-xl px-3 py-2.5 text-sm transition-all duration-200 ${
              isActive(item)
                ? "bg-orange/15 font-semibold text-cream"
                : "text-cream/75 hover:bg-cream/10 hover:text-cream"
            }`}
          >
            {isActive(item) && (
              <span
                aria-hidden
                className="absolute bottom-2 end-0 top-2 w-1 rounded-full bg-brand-gradient"
              />
            )}
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="border-t border-cream/10 px-5 py-4">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="truncate text-xs text-cream/50" dir="ltr">{user.phone}</p>
        <button
          type="button"
          onClick={handleLogout}
          className="mt-3 min-h-11 w-full rounded-xl border border-cream/20 py-2 text-sm text-cream/80 transition-colors hover:border-cream/40 hover:bg-cream/10"
        >
          تسجيل الخروج
        </button>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:fixed lg:inset-y-0 lg:start-0 lg:z-30 lg:block">
        {sidebar}
      </div>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/50"
            onClick={onClose}
            role="presentation"
          />
          <div className="absolute inset-y-0 start-0 shadow-xl">{sidebar}</div>
        </div>
      )}
    </>
  );
}
