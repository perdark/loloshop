"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/BrandLogo";
import { NotificationBell } from "@/components/NotificationBell";
import { AUTH_CHANGED_EVENT, getToken } from "@/lib/auth";
import { getCart } from "@/lib/cart";
import { copyFor } from "@/lib/copy-ar";
import { getProfile, PROFILE_CHANGED_EVENT } from "@/lib/profile";

/**
 * Storefront chrome, app-shaped (storefront-D): a slim sticky top bar for
 * identity + search + notifications, and a bottom TAB BAR for navigation.
 *
 * Why a tab bar replaced the old pill row: this ships inside a Capacitor shell
 * on both stores, and the pill row put every destination in a horizontally
 * scrolling strip at the top — the one place a thumb cannot reach on a phone.
 * Four fixed tabs at the bottom is what a native app does, and «السلة» finally
 * gets a permanent home instead of hiding behind an icon that only appeared
 * once you were signed in.
 *
 * The cart and account tabs are shown to everyone, signed in or not: hiding
 * them made the app look emptier than it is, and both routes already handle
 * their own auth. Tapping them signed-out lands on /login, which is the
 * expected outcome rather than a dead end.
 */

const TABS = [
  {
    href: "/",
    label: "الرئيسية",
    icon: (
      <>
        <path d="M3 9.5 12 3l9 6.5" />
        <path d="M5 10v10h14V10" />
        <path d="M9 20v-6h6v6" />
      </>
    ),
  },
  {
    href: "/shop",
    label: "القطع",
    icon: (
      <>
        <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
      </>
    ),
  },
  {
    href: "/cart",
    label: "السلة",
    icon: (
      <>
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <path d="M3 6h18" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </>
    ),
  },
  {
    /* The ONLY route to self-service account deletion, which Apple requires to
       be reachable in-app (5.1.1(v) — the first iOS submission was rejected for
       its absence). It must stay a visible tab. */
    href: "/account",
    label: "حسابي",
    icon: (
      <>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
  },
];

export function StudentNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const [gender, setGender] = useState(() => null as ReturnType<typeof getProfile>["gender"]);

  useEffect(() => {
    const token = getToken();
    setAuthed(!!token);
    if (token) {
      getCart()
        .then((c) => setCartCount(c.items.length))
        .catch(() => setCartCount(0));
    } else {
      setCartCount(0);
    }
  }, [pathname]);

  // The auth check above is keyed on `pathname`, so a session that ends WITHOUT
  // a route change leaves this stale — which is exactly what account deletion
  // does (it finishes on /account and shows a confirmation without navigating).
  useEffect(() => {
    const resync = () => {
      const token = getToken();
      setAuthed(!!token);
      if (!token) setCartCount(0);
    };
    window.addEventListener(AUTH_CHANGED_EVENT, resync);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, resync);
  }, []);

  // Read the visitor profile after mount (localStorage is client-only) and keep
  // the search placeholder in sync when onboarding or /account changes it.
  useEffect(() => {
    const sync = () => setGender(getProfile().gender);
    sync();
    window.addEventListener(PROFILE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(PROFILE_CHANGED_EVENT, sync);
  }, []);

  const copy = copyFor(gender);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <>
      <header
        className="sticky top-0 z-40 border-b border-line bg-cream/97 shadow-[var(--shadow-soft)] backdrop-blur-[10px]"
        style={{ viewTransitionName: "student-header" }}
      >
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-2.5 md:max-w-3xl lg:max-w-6xl">
          <Link href="/" aria-label="لولو شوب — الرئيسية" className="shrink-0">
            <BrandMark size={36} />
          </Link>

          {/* Search is a BUTTON, not an input: the field itself lives on /shop,
              so there is exactly one search implementation to keep working. */}
          <button
            type="button"
            onClick={() => router.push("/shop?focus=search")}
            className="flex min-h-11 flex-1 items-center gap-2 rounded-pill border border-line bg-beige px-3 text-start text-[13.5px] font-semibold text-[var(--shop-muted)] shadow-[var(--shadow-soft)] transition-colors hover:border-orange-ink/30"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-4 w-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            {copy.searchPlaceholder}
          </button>

          {authed && <NotificationBell />}
          {authed === false && (
            <Link
              href="/login"
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-pill bg-brand-gradient px-4 text-xs font-bold text-white shadow-[var(--shadow-soft)] transition-transform active:scale-95"
            >
              دخول
            </Link>
          )}
        </div>
      </header>

      {/* ── Bottom tab bar ──
          `fixed`, not `sticky`: <main> is transformed (animate-page-in), and a
          transformed ancestor becomes the containing block for fixed children —
          so this is rendered as a sibling of <main>, never inside it. */}
      <nav
        aria-label="التنقّل الرئيسي"
        className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-lg border-t border-line bg-beige px-1.5 pt-1.5 shadow-[0_-6px_18px_-12px_rgba(26,26,26,0.2)] md:max-w-3xl lg:max-w-6xl"
        style={{ paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom, 0px))" }}
      >
        {TABS.map((tab) => {
          const active = isActive(tab.href);
          const showBadge = tab.href === "/cart" && cartCount > 0;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-14 flex-1 flex-col items-center gap-[3px] py-1 text-[10.5px] transition-colors ${
                active ? "font-extrabold text-orange-ink" : "font-semibold text-[var(--shop-muted)]"
              }`}
            >
              <span
                className={`relative grid h-[30px] w-[46px] place-items-center rounded-pill transition-colors ${
                  active ? "bg-orange-ink text-white" : ""
                }`}
              >
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {tab.icon}
                </svg>
                {showBadge && (
                  <span
                    aria-hidden
                    className={`absolute -top-0.5 end-0.5 min-w-4 rounded-pill border-[1.5px] border-beige px-1 text-[9px] font-extrabold leading-[13px] text-white ${
                      active ? "bg-ink" : "bg-orange-ink"
                    }`}
                  >
                    {cartCount > 9 ? "9+" : cartCount}
                  </span>
                )}
              </span>
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
