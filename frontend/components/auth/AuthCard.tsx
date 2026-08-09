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
export function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
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
      <header className="mx-auto w-full max-w-md shrink-0">
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
