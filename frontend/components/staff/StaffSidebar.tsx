"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
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
    if (pathname !== "/staff") return false;
    if (item.filter === "all") {
      return !searchParams.get("filter") || currentFilter === "all";
    }
    return currentFilter === item.filter;
  }

  const sidebar = (
    <aside className="flex h-full w-64 flex-col bg-ink text-cream">
      <div className="border-b border-cream/10 px-5 py-6">
        <p className="font-script text-2xl text-orange">lolo shop</p>
        <p className="font-display text-sm font-semibold text-cream/90">لولو شوب</p>
        <p className="mt-1 text-xs text-cream/60">لوحة الموظف</p>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => (
          <Link
            key={item.filter}
            href={item.href}
            onClick={onClose}
            className={`block rounded-lg px-3 py-2.5 text-sm transition-colors ${
              isActive(item)
                ? "bg-orange/20 font-semibold text-orange"
                : "text-cream/80 hover:bg-cream/10"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="border-t border-cream/10 px-5 py-4">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="truncate text-xs text-cream/50">{user.phone}</p>
        <button
          type="button"
          onClick={handleLogout}
          className="mt-3 w-full rounded-lg border border-cream/20 py-2 text-sm text-cream/80 transition-colors hover:bg-cream/10"
        >
          تسجيل الخروج
        </button>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:fixed lg:inset-y-0 lg:right-0 lg:z-30 lg:block">
        {sidebar}
      </div>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/50"
            onClick={onClose}
            role="presentation"
          />
          <div className="absolute inset-y-0 right-0 shadow-xl">{sidebar}</div>
        </div>
      )}
    </>
  );
}
