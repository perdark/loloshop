"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/BrandLogo";
import { getToken, logout } from "@/lib/auth";
import { getCart } from "@/lib/cart";

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
  // Cart item count — loaded lazily, never blocks render.
  const [cartCount, setCartCount] = useState(0);
  // Hide on scroll-down, reveal on scroll-up — keeps the cinematic frames clear.
  const [hidden, setHidden] = useState(false);
  // Immersive routes (VIP) hide the header over the hero so the lookbook cover
  // reads full-bleed on first paint, revealing it once the hero is scrolled past.
  const immersive = pathname.startsWith("/vip");
  const [pastHero, setPastHero] = useState(false);

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

  useEffect(() => {
    let last = window.scrollY;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = window.scrollY;
        setPastHero(y > window.innerHeight * 0.6);
        if (Math.abs(y - last) > 6) {
          setHidden(y > last && y > 80);
          last = y;
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
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
      className={`${immersive ? "" : "animate-nav-in"} ${
        immersive ? "fixed inset-x-0" : "sticky"
      } top-0 z-40 transition-[translate] duration-300 ease-out ${
        (immersive ? !pastHero : hidden) ? "-translate-y-full" : "translate-y-0"
      } ${
        immersive && !pastHero
          ? ""
          : "border-b border-line bg-cream/97 shadow-[var(--shadow-soft)]"
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

          <div className="flex items-center gap-2">
            {/* Cart icon — always visible for retail students; hidden until auth resolved */}
            {authed && (
              <Link
                href="/cart"
                aria-label={`السلة${cartCount > 0 ? ` — ${cartCount} عناصر` : ""}`}
                className="relative flex h-11 w-11 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-beige hover:text-orange-ink active:scale-95"
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
                  <circle cx="9" cy="21" r="1" />
                  <circle cx="20" cy="21" r="1" />
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                </svg>
                {cartCount > 0 && (
                  <span
                    aria-hidden
                    className="absolute -end-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-orange-ink text-[10px] font-bold leading-none text-white"
                  >
                    {cartCount > 9 ? "9+" : cartCount}
                  </span>
                )}
              </Link>
            )}

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
                    : "text-ink-soft hover:bg-beige hover:text-orange-ink"
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
