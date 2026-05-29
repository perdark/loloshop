"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BrandMark } from "@/components/ui/BrandLogo";
import { logout } from "@/lib/auth";
import { toast } from "sonner";
import type { StaffListFilter } from "@/lib/staff-types";
import type { User } from "@/lib/types";

// Filter chips — only the /staff route uses a filter param; wholesalers is a separate route.
const filterChips: { filter: StaffListFilter; label: string }[] = [
  { filter: "all",      label: "جميع الطلبات" },
  { filter: "review",   label: "قيد المراجعة" },
  { filter: "printing", label: "جاهز للطباعة" },
  { filter: "done",     label: "مكتمل" },
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

  const onOrdersPage = pathname === "/staff";
  const onWholesalersPage = pathname.startsWith("/staff/wholesalers");

  const sidebar = (
    // Surface background on warm paper — no dark ink shell, no brand-gradient stripe.
    <aside className="flex h-full w-64 flex-col border-e border-line bg-surface">
      {/* Brand header — flat surface, no orange blur blob */}
      <div className="border-b border-line px-5 py-5">
        <div className="flex items-center gap-3">
          <BrandMark size={48} priority />
          <div>
            <p className="font-display text-sm font-semibold text-ink">لولو شوب</p>
            <p className="mt-0.5 text-xs text-muted">لوحة الموظف</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="قائمة الموظف">
        {/* ── Main sections ── */}
        <div className="space-y-0.5">
          {/* Orders section — shows filter chips when active */}
          <Link
            href="/staff"
            onClick={onClose}
            className={`flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
              onOrdersPage
                ? "bg-orange-ink/8 text-orange-ink"
                : "text-ink-soft hover:bg-surface-sink hover:text-ink"
            }`}
          >
            {/* Orders icon */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
              <rect x="9" y="3" width="6" height="4" rx="1" />
              <path d="M9 12h6M9 16h4" />
            </svg>
            لوحة الطلبات
          </Link>

          {/* Filter chips — surface bg, hairline border, pill shape. Selected = orange-ink fill */}
          {onOrdersPage && (
            <div className="ms-6 mt-1.5 flex flex-col gap-1" role="group" aria-label="تصفية الطلبات">
              {filterChips.map((chip) => {
                const isSelected =
                  chip.filter === "all"
                    ? !searchParams.get("filter") || currentFilter === "all"
                    : currentFilter === chip.filter;

                const href =
                  chip.filter === "all" ? "/staff" : `/staff?filter=${chip.filter}`;

                return (
                  <Link
                    key={chip.filter}
                    href={href}
                    onClick={onClose}
                    aria-current={isSelected ? "page" : undefined}
                    className={`inline-flex min-h-9 items-center rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      isSelected
                        ? "border-orange-ink bg-orange-ink text-white"
                        : "border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink"
                    }`}
                  >
                    {chip.label}
                  </Link>
                );
              })}
            </div>
          )}

          <Link
            href="/staff/wholesalers"
            onClick={onClose}
            className={`mt-0.5 flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
              onWholesalersPage
                ? "bg-orange-ink/8 text-orange-ink"
                : "text-ink-soft hover:bg-surface-sink hover:text-ink"
            }`}
          >
            {/* Wholesalers icon */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            طلاب الممثلين
          </Link>
        </div>
      </nav>

      {/* Footer: user info + logout */}
      <div className="border-t border-line px-5 py-4">
        <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted" dir="ltr">{user.phone}</p>
        <button
          type="button"
          onClick={handleLogout}
          className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-line bg-surface-sink px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:border-danger/40 hover:text-danger"
        >
          تسجيل الخروج
        </button>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop: fixed sidebar */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:start-0 lg:z-30 lg:block">
        {sidebar}
      </div>

      {/* Mobile: overlay drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/40"
            onClick={onClose}
            role="presentation"
          />
          <div className="absolute inset-y-0 start-0 shadow-[var(--shadow-pop)]">{sidebar}</div>
        </div>
      )}
    </>
  );
}
