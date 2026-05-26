"use client";

import type { ReactNode } from "react";

interface AuthCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function AuthCard({ title, subtitle, children }: AuthCardProps) {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-cream px-4 py-8"
      dir="rtl"
      lang="ar"
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-lg">
        <div className="bg-ink px-6 py-5 text-center">
          <p className="font-script text-3xl text-orange-ink">lolo shop</p>
          <p className="font-display text-lg font-semibold text-cream">لولو شوب</p>
          {subtitle && (
            <p className="mt-1 text-sm text-cream/70">{subtitle}</p>
          )}
        </div>
        <div className="px-6 py-6">
          <h1 className="mb-6 text-center font-display text-xl font-bold text-ink">
            {title}
          </h1>
          {children}
        </div>
      </div>
    </div>
  );
}
