"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/BrandLogo";
import { getToken, logout } from "@/lib/auth";

const NAV = [
  {
    href: "/",
    label: "المتجر",
    icon: (
      <>
        <path d="M3 9.5 12 3l9 6.5" />
        <path d="M5 10v10h14V10" />
        <path d="M9 20v-6h6v6" />
      </>
    ),
  },
  {
    href: "/design",
    label: "صمّم وشاحك",
    icon: (
      <>
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <path d="M2 2l7.586 7.586" />
        <circle cx="11" cy="11" r="2" />
      </>
    ),
  },
  {
    href: "/sizes",
    label: "المقاسات",
    icon: (
      <>
        <path d="M21 6H3M21 12H3M21 18H3" />
        <path d="M7 3v3M12 9v3M17 15v3" />
      </>
    ),
  },
];

export function StudentNav() {
  const pathname = usePathname();
  const router = useRouter();
  // Resolve auth only after mount to avoid hydration mismatch.
  const [authed, setAuthed] = useState<boolean | null>(null);
  // Hide on scroll-down, reveal on scroll-up — keeps the cinematic frames clear.
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only auth read
    setAuthed(!!getToken());
  }, [pathname]);

  useEffect(() => {
    let last = window.scrollY;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = window.scrollY;
        if (Math.abs(y - last) > 6) {
          setHidden(y > last && y > 80);
          last = y;
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  function handleLogout() {
    logout();
    setAuthed(false);
    router.push("/login");
  }

  return (
    <header
      className={`animate-nav-in surface-glass sticky top-0 z-40 border-b border-orange/10 transition-[translate] duration-300 ease-out ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`}
      style={{ viewTransitionName: "student-header" }}
    >
      <div className="mx-auto max-w-lg px-4">
        {/* Brand row */}
        <div className="flex items-center justify-between py-2.5">
          <Link href="/" aria-label="لولو شوب — الرئيسية" className="flex items-center gap-2.5">
            <BrandMark size={44} priority />
            <span className="font-display text-sm font-bold tracking-wide text-ink">
              لولو شوب
            </span>
          </Link>

          {authed === null ? (
            <span aria-hidden className="h-9 w-20 rounded-pill bg-beige/60" />
          ) : authed ? (
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-pill border border-orange/25 bg-beige px-3.5 text-xs font-semibold text-orange-ink transition-colors hover:bg-orange/10"
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
              خروج
            </button>
          ) : (
            <Link
              href="/login"
              className="btn-shine inline-flex min-h-9 items-center gap-1.5 rounded-pill bg-brand-gradient px-4 text-xs font-bold text-white shadow-[var(--shadow-soft)] transition-transform active:scale-95"
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <path d="M10 17l5-5-5-5" />
                <path d="M15 12H3" />
              </svg>
              دخول
            </Link>
          )}
        </div>

        {/* Nav row */}
        <nav className="-mx-1 flex items-center gap-1 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="التنقل الرئيسي">
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-sm font-semibold transition-all duration-200 active:scale-95 ${
                  active
                    ? "bg-brand-gradient text-white shadow-[var(--shadow-soft)]"
                    : "text-ink/65 hover:bg-beige hover:text-orange-ink"
                }`}
              >
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {item.icon}
                </svg>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
