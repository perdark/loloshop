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

function iconScissors() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
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

function iconPen() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  );
}

// Home-list label per queue role. /staff shows the FIRST such role's queue (mirrors
// app/staff/page.tsx routing), so the home link is labelled by that first role.
const HOME_LABELS: Partial<Record<StaffType, string>> = {
  designer: "مراجعة التصاميم",
  digitizer: "قائمة التحويل",
  embroiderer: "قائمة التطريز",
  presser: "قائمة الكوي",
  preparer: "قائمة التجهيز",
};

function iconUserPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="20" y1="8" x2="20" y2="14" />
      <line x1="17" y1="11" x2="23" y2="11" />
    </svg>
  );
}

function getNavLinks(staffTypes: StaffType[], isAdmin: boolean): NavLink[] {
  // Admin gets full manager view over the production area.
  if (isAdmin || staffTypes.includes("manager")) {
    return [
      { href: "/staff", label: "المتابعة", icon: iconBarChart() },
      { href: "/staff/queue", label: "جميع الطلبات", icon: iconClipboard(), prefix: true },
      // «طلب مخصص» has TWO mounts and they are not interchangeable: the whole
      // /api/staff/* router is `requireRole('staff')`, which blocks the admin role by
      // design (backend/routes/staff.js), so an admin sent to /staff/custom-order lands
      // on a form whose config request 403s. Admins get their own /admin mount.
      {
        href: isAdmin ? "/admin/custom-order" : "/staff/custom-order",
        label: "طلب مخصص",
        icon: iconClipboard(),
        prefix: true,
      },
      // «تسجيل طالب في المحل» has NO admin mount — the endpoint sits behind the same
      // requireRole('staff') router as custom-order, and admin is blocked there by design.
      // Shown only to manager staff, never to admin (see the isAdmin/isManager gate on the
      // page itself for the reasoning).
      ...(isAdmin
        ? []
        : [
            {
              href: "/staff/counter-signup",
              label: "تسجيل طالب في المحل",
              icon: iconUserPlus(),
              prefix: true,
            },
          ]),
      { href: "/staff/tailor", label: "الفصال", icon: iconScissors(), prefix: true },
      { href: "/staff/shelf", label: "رف التجهيز", icon: iconClipboard(), prefix: true },
    ];
  }
  // Every production-role staffer also gets the live production console — the same
  // /staff/queue screen the admin uses. The backend auto-scopes it to just the stages
  // this staff member works (their role[s]), so it shows their own queue, richer than
  // the per-stage card list (search · source tabs · rep drill-down · alerts · paging).
  const consoleLink: NavLink = {
    href: "/staff/queue",
    label: "قائمة الإنتاج",
    icon: iconBarChart(),
    prefix: true,
  };
  // Merge links across ALL held roles (the staff_types[] union) — a tailor+embroiderer
  // needs BOTH «قائمة التطريز» and «الفصال», not just the primary role's link.
  const links: NavLink[] = [];
  const homeType = staffTypes.find((t) => t in HOME_LABELS);
  if (homeType) {
    links.push({ href: "/staff", label: HOME_LABELS[homeType]!, icon: iconClipboard() });
  } else if (!staffTypes.includes("tailor")) {
    // Legacy/unknown role: generic board. A PURE tailor skips /staff entirely —
    // that page redirects them to /staff/tailor, so the link would be a bounce.
    links.push({ href: "/staff", label: "لوحة الطلبات", icon: iconClipboard() });
  }
  // رف التجهيز — the preparer packs from it; the presser shelves into it right after الكوي.
  // Shown to either role (the backend scopes the board itself).
  if (staffTypes.includes("preparer") || staffTypes.includes("presser")) {
    links.push({
      href: "/staff/shelf",
      label: "رف التجهيز",
      icon: iconClipboard(),
      prefix: true,
    });
  }
  if (staffTypes.includes("tailor")) {
    // مفصل (ابو عبدو): the parallel «الفصال» console — a retail-only tailoring to-do
    // that runs alongside (and never moves) the pipeline. Shown to ANY holder of the role.
    links.push({ href: "/staff/tailor", label: "الفصال", icon: iconScissors(), prefix: true });
  }
  links.push(consoleLink);
  return links;
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

  // The multi-role staff_types[] union is the authoritative role set (falls back to the
  // primary scalar for older payloads) — ALL nav links derive from it, so a multi-role
  // staffer (e.g. tailor+embroiderer) sees every screen they work, not just the primary's.
  const myTypes: StaffType[] =
    user.staff_types && user.staff_types.length
      ? user.staff_types
      : user.staff_type
        ? [user.staff_type]
        : [];
  const baseLinks = getNavLinks(myTypes, isAdmin);

  // Calligraphy tool: admin + manager/designer staff (matches the backend guard
  // requireStaffType('designer')).
  const canCalligraphy =
    isAdmin || myTypes.includes("manager") || myTypes.includes("designer");
  // أيادي التصميم desk — محمد هيثم (manager) leads it from his staff account
  // (2026-07-15). Backend membership gates the data; the link shows for managers.
  const canDesignSupport = myTypes.includes("manager");
  const productionAndToolLinks = [
    ...baseLinks,
    ...(canCalligraphy
      ? [{ href: "/staff/calligraphy", label: "الخط العربي", icon: iconPen(), prefix: true }]
      : []),
    ...(canDesignSupport
      ? [{ href: "/design-support", label: "أيادي التصميم", icon: iconPen(), prefix: true }]
      : []),
  ];
  const canSeeWholesalers =
    user.role === "staff" &&
    (myTypes.includes("manager") || user.order_scope === "wholesaler" || user.order_scope === "both");
  const productionLinks = canSeeWholesalers
    ? [
        ...productionAndToolLinks,
        { href: "/staff/wholesalers", label: "الممثلون", icon: iconUsers(), prefix: true },
      ]
    : productionAndToolLinks;

  // Staff (not pure admins) track their own salary + activity.
  const links =
    user.role === "staff"
      ? [
          ...productionLinks,
          { href: "/staff/attendance", label: "بصمة الموظف", icon: iconClipboard(), prefix: true },
          { href: "/staff/me", label: "راتبي ونشاطي", icon: iconWallet(), prefix: true },
        ]
      : isAdmin
        ? [...productionLinks, { href: "/staff/team", label: "الموظفون", icon: iconUsers(), prefix: true }]
        : productionLinks;
  // Admins viewing production show "مدير (إنتاج)" so it's clear they're not
  // looking at their usual admin panel.
  const typeLabel = isAdmin
    ? "مدير — متابعة الإنتاج"
    : myTypes.length
      ? myTypes.map((t) => STAFF_TYPE_LABELS[t]).join(" · ")
      : "موظف";

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-e border-line bg-surface">
      {/* Brand header — warm veil so it reads as a premium header, not a plain bar */}
      <div className="bg-warm-veil border-b border-line px-5 py-5">
        <div className="flex items-center gap-3">
          <BrandMark size={44} eager />
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
