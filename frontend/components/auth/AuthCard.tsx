"use client";

import type { CSSProperties, ReactNode } from "react";
import { BrandMark } from "@/components/ui/BrandLogo";

interface AuthCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /**
   * Pinned under the content column and rendered OUTSIDE `<main>`. Anything placed here is
   * therefore a SIBLING of the page's `<form>`, never a descendant — so a footer may safely
   * contain its OWN `<form>` (nested forms are invalid HTML and the inner one silently loses
   * its submit). That guarantee is why the slot exists; keep it if anything reuses it.
   *
   * Currently unused: its only consumer was `TeamKeyEntry` on /login, deleted 2026-08-06
   * because it showed students a staff entrance. See the note in app/login/page.tsx.
   */
  footer?: ReactNode;
  /**
   * Renders a back chevron at the START of the header (right, in RTL). Pass it and the screen
   * gets a way out; omit it and the header is exactly what it was.
   *
   * ⚠️ This is not decoration on the native shells: they are Capacitor webviews with NO
   * ADDRESS BAR and no browser chrome, so an auth screen without this prop is a dead end —
   * the only exits are whatever links the page itself prints. Android's hardware back still
   * works; iOS has nothing.
   */
  onBack?: () => void;
  /** Accessible name for the back control. Defaults to «رجوع». */
  backLabel?: string;
}

/**
 * Every auth screen in the app renders through here — login, register, forgot-password,
 * join/[code] and the three secret-key portals (/s, /w, /d). Fixing the shell once fixes
 * the family; that is the point of doing it here rather than per page.
 *
 * It is deliberately NOT a card. The old `rounded-[20px] border bg-beige` sheet floating on
 * a centred page is the single loudest "this is a web form in a browser" tell — apps do not
 * put their login inside a box. This is a full-bleed screen: brand lockup at the top, content
 * in a flowing column that grows, primary action free to sit at the bottom via `mt-auto`.
 *
 * SAFE AREA: the shells are Capacitor webviews, where `min-h-screen` alone lets a notch clip
 * the header and the iOS home bar sit on top of the submit button. Insets are physical
 * (left/right), NOT logical — `padding-inline-start` paired with `safe-area-inset-left` would
 * be backwards on these RTL screens.
 */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
  onBack,
  backLabel = "رجوع",
}: AuthCardProps) {
  const safeArea: CSSProperties = {
    paddingTop: "max(1.5rem, calc(env(safe-area-inset-top, 0px) + 0.75rem))",
    paddingBottom: "max(1.25rem, calc(env(safe-area-inset-bottom, 0px) + 0.75rem))",
    paddingLeft: "max(1.25rem, calc(env(safe-area-inset-left, 0px) + 0.5rem))",
    paddingRight: "max(1.25rem, calc(env(safe-area-inset-right, 0px) + 0.5rem))",
  };

  return (
    <div
      className="shop-paper animate-fade-page-in flex min-h-dvh flex-col bg-cream"
      style={safeArea}
      dir="rtl"
      lang="ar"
    >
      {/* Brand lockup — mark centred, title set start-aligned underneath. A large
          start-aligned title over a quiet subtitle is the native pattern; a centred
          heading inside a bordered box is the web-form one. */}
      <header className="relative mx-auto w-full max-w-md shrink-0">
        {onBack && (
          // Absolutely placed so the brand mark stays optically centred on the screen —
          // putting the button in the flow would shove the lockup off-centre on the screens
          // that have a back and leave the family inconsistent. 44px box = the tap target.
          // The chevron points RIGHT because this shell is RTL and "back" is rightwards here;
          // it is drawn, not typed, because the ←/→ characters are bidi-mirrored and flip
          // depending on the surrounding run.
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel}
            className="absolute -top-0.5 start-0 inline-flex h-11 w-11 items-center justify-center rounded-full text-ink transition-colors duration-200 hover:bg-ink/5 active:bg-ink/10"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        )}
        <BrandMark size={60} className="mx-auto" />
        <h1 className="mt-5 font-display-ar text-[1.7rem] font-bold leading-tight text-ink">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-soft">{subtitle}</p>
        )}
      </header>

      {/* Grows to fill the screen, so a short form can push its primary action to the
          bottom with `mt-auto` and a long one simply scrolls. */}
      <main className="mx-auto mt-7 flex w-full max-w-md flex-1 flex-col">{children}</main>

      {footer && (
        <div className="mx-auto mt-6 w-full max-w-md shrink-0">{footer}</div>
      )}
    </div>
  );
}
