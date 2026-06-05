"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/ui/BrandLogo";
import { logout, setSkipDashboardRedirect } from "@/lib/auth";
import { toast } from "sonner";
import { STAFF_TYPE_LABELS } from "@/lib/constants";
import type { User } from "@/lib/types";
import type { StaffType } from "@/lib/types";

// ─── Nav definitions per staff_type ──────────────────────────────────────────

interface NavLink {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** If true, this link is active for all sub-paths too */
  prefix?: boolean;
}

function iconClipboard() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 12h6M9 16h4" />
    </svg>
  );
}

function iconBarChart() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function iconUsers() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function iconWallet() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      <path d="M21 12a2 2 0 0 0-2-2h-4a2 2 0 0 0 0 4h4a2 2 0 0 0 2-2z" />
    </svg>
  );
}

function getNavLinks(
  staffType: StaffType | null | undefined,
  isAdmin: boolean,
): NavLink[] {
  // Admin gets full manager view over the production area.
  if (isAdmin || staffType === "manager") {
    return [
      { href: "/staff", label: "المتابعة", icon: iconBarChart() },
      { href: "/staff/queue", label: "جميع الطلبات", icon: iconClipboard(), prefix: true },
      { href: "/staff/wholesalers", label: "طلاب الممثلين", icon: iconUsers(), prefix: true },
    ];
  }
  switch (staffType) {
    case "designer":
      return [
        { href: "/staff", label: "مراجعة التصاميم", icon: iconClipboard() },
        { href: "/staff/wholesalers", label: "طلاب الممثلين", icon: iconUsers(), prefix: true },
      ];
    case "digitizer":
      return [
        { href: "/staff", label: "قائمة التحويل", icon: iconClipboard() },
      ];
    case "embroiderer":
      return [
        { href: "/staff", label: "قائمة التطريز", icon: iconClipboard() },
      ];
    case "presser":
      return [
        { href: "/staff", label: "قائمة الكوي", icon: iconClipboard() },
      ];
    case "preparer":
      return [
        { href: "/staff", label: "قائمة التجهيز", icon: iconClipboard() },
      ];
    default:
      // Fallback: legacy view
      return [
        { href: "/staff", label: "لوحة الطلبات", icon: iconClipboard() },
        { href: "/staff/wholesalers", label: "طلاب الممثلين", icon: iconUsers(), prefix: true },
      ];
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface StaffSidebarProps {
  user: User;
  open: boolean;
  onClose: () => void;
}

export function StaffSidebar({ user, open, onClose }: StaffSidebarProps) {
  const pathname = usePathname();

  function handleLogout() {
    logout();
    toast.success("تم تسجيل الخروج");
    window.location.href = "/login";
  }

  const isAdmin = user.role === "admin";
  const baseLinks = getNavLinks(user.staff_type, isAdmin);
  // Staff (not pure admins) track their own salary + activity.
  const links =
    user.role === "staff"
      ? [...baseLinks, { href: "/staff/me", label: "راتبي ونشاطي", icon: iconWallet(), prefix: true }]
      : isAdmin
        ? [...baseLinks, { href: "/staff/team", label: "الموظفون", icon: iconUsers(), prefix: true }]
        : baseLinks;
  // Admins viewing production show "مدير (إنتاج)" so it's clear they're not
  // looking at their usual admin panel.
  const typeLabel = isAdmin
    ? "مدير — متابعة الإنتاج"
    : user.staff_type
      ? STAFF_TYPE_LABELS[user.staff_type]
      : "موظف";

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-e border-line bg-surface">
      {/* Brand header — warm veil so it reads as a premium header, not a plain bar */}
      <div className="bg-warm-veil border-b border-line px-5 py-5">
        <div className="flex items-center gap-3">
          <BrandMark size={44} priority />
          <div>
            <p className="font-display text-sm font-semibold text-ink">لولو شوب</p>
            <p className="mt-0.5 text-xs font-medium text-orange-ink">{typeLabel}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5" aria-label="قائمة الموظف">
        {isAdmin && (
          <Link
            href="/admin"
            onClick={onClose}
            className="mb-2 flex min-h-11 items-center gap-2.5 rounded-xl border border-orange-ink/30 bg-orange-ink/8 px-3 py-2 text-sm font-semibold text-orange-ink transition-colors hover:bg-orange-ink/15"
          >
            <span aria-hidden>→</span>
            العودة للوحة التحكم
          </Link>
        )}
        {links.map((link) => {
          const isActive = link.prefix
            ? pathname.startsWith(link.href)
            : pathname === link.href;

          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={onClose}
              aria-current={isActive ? "page" : undefined}
              className={`flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                isActive
                  ? "bg-orange-ink/10 text-orange-ink"
                  : "font-medium text-ink-soft hover:bg-surface-sink hover:text-ink"
              }`}
            >
              {link.icon}
              {link.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer: user info + logout */}
      <div className="border-t border-line px-5 py-4">
        <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted" dir="ltr">{user.phone}</p>
        <Link
          href="/"
          onClick={() => {
            setSkipDashboardRedirect();
            onClose();
          }}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface-sink px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:border-orange-ink/40 hover:text-orange-ink"
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
