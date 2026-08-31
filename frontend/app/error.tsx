"use client";

/**
 * Route-segment error boundary.
 * Must be a Client Component (React Error Boundary requirement).
 * Shows a calm Arabic error panel — never exposes the raw error message to users.
 */

import { useEffect } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/ui/BrandLogo";
import { Button } from "@/components/ui/Button";

interface ErrorPageProps {
  error: Error & { digest?: string };
  /** unstable_retry re-fetches + re-renders the boundary children (Next 16). */
  unstable_retry: () => void;
}

export default function ErrorPage({ error, unstable_retry }: ErrorPageProps) {
  // Log server-safe — digest is the safe server-side reference, not the raw message.
  useEffect(() => {
    console.error("[ErrorBoundary]", error.digest ?? error.name);
  }, [error]);

  return (
    <main
      dir="rtl"
      lang="ar"
      className="min-h-dvh bg-cream flex flex-col items-center justify-center px-6 py-20 text-center"
    >
      {/* Brand anchor */}
      <Link href="/" aria-label="لولو شوب — الصفحة الرئيسية" className="mb-12 inline-flex">
        <BrandMark size={48} />
      </Link>

      {/* Icon — a quiet visual beat, not alarming */}
      <div
        className="mb-6 flex h-14 w-14 items-center justify-center rounded-full"
        style={{
          background: "var(--color-surface-sink)",
          border: "1px solid var(--color-line)",
        }}
        aria-hidden="true"
      >
        {/* Minimal exclamation mark, ink-toned */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6 text-ink-soft"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>

      {/* Heading */}
      <h1 className="font-display-ar text-[clamp(1.5rem,4vw,2.5rem)] font-bold leading-tight text-ink">
        حدث خطأ غير متوقع
      </h1>

      {/* Body */}
      <p className="mt-4 text-base leading-relaxed text-ink-soft max-w-[52ch] mx-auto">
        نعتذر عن هذا الإزعاج. حدث خلل مؤقت في هذه الصفحة.
        يمكنك المحاولة مجدداً أو العودة إلى الرئيسية.
      </p>

      {/* Digest — small reference for reporting, not alarming */}
      {error.digest && (
        <p className="mt-3 font-label text-[0.75rem] text-muted tracking-wide">
          رقم المرجع: {error.digest}
        </p>
      )}

      {/* Warm rule */}
      <div
        className="mt-8 mb-8 w-16 h-px"
        style={{ background: "var(--color-line)" }}
        aria-hidden="true"
      />

      {/* Actions */}
      <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-xs sm:max-w-none sm:w-auto">
        <Button
          size="lg"
          variant="primary"
          onClick={() => unstable_retry()}
          className="w-full sm:w-auto"
        >
          إعادة المحاولة
        </Button>
        <Link
          href="/"
          className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] w-full sm:w-auto rounded-full border border-line bg-surface px-7 py-3 text-base font-semibold text-ink transition-all duration-200 ease-out hover:border-orange/40 hover:text-orange-ink focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          العودة إلى الرئيسية
        </Link>
      </div>
    </main>
  );
}
