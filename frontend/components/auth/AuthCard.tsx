"use client";

import type { ReactNode } from "react";
import { BrandMark } from "@/components/ui/BrandLogo";

interface AuthCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function AuthCard({ title, subtitle, children }: AuthCardProps) {
  return (
    <div
      className="shop-paper flex min-h-screen flex-col items-center justify-center bg-cream px-5 py-12"
      dir="rtl"
      lang="ar"
    >
      <div className="w-full max-w-md animate-auth-card-in">
        {/* Brand lockup — the script wordmark on paper, calm and composed.
            No dark block, no glow, no emoji: the type carries it. */}
        <header className="mb-8 text-center">
          <BrandMark size={88} className="mb-2" />
          <p className="mt-1.5 font-display-ar text-base font-semibold tracking-wide text-ink">
            لولو شوب
          </p>
        </header>

        {/* The sheet — a raised Surface on Paper: warm hairline, soft ink-toned
            lift, large radius. Flat by character, not decorated. */}
        <main>
          <div className="rounded-[20px] border border-ink/10 bg-beige px-6 py-8 shadow-[var(--shadow-card)] sm:px-8">
            <div className="mb-6 text-center">
              <h1 className="font-display-ar text-2xl font-bold text-ink">{title}</h1>
              {subtitle && <p className="mt-1.5 text-sm text-ink-soft">{subtitle}</p>}
            </div>
            {children}
          </div>
        </main>

        <p className="mt-6 text-center text-xs text-ink-soft">
          أوشحة وروبات التخرّج · @lolo_shop96
        </p>
      </div>
    </div>
  );
}
