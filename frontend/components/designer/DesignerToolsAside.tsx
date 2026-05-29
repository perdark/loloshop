"use client";

import type { ReactNode } from "react";

interface DesignerToolsAsideProps {
  open: boolean;
  onToggle: () => void;
  panelId: string;
  children: ReactNode;
  /** Tailwind width class for desktop sidebar, e.g. sm:w-72 */
  desktopWidthClass?: string;
}

/** Mobile: collapsible tools drawer under the canvas. Desktop: always visible sidebar. */
export function DesignerToolsAside({
  open,
  onToggle,
  panelId,
  children,
  desktopWidthClass = "sm:w-72",
}: DesignerToolsAsideProps) {
  return (
    <div className={`flex w-full shrink-0 flex-col gap-2 ${desktopWidthClass}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-beige px-4 text-sm font-semibold text-ink transition-colors hover:bg-[var(--shop-sink)] sm:hidden"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
        {open ? "إخفاء الأدوات" : "إظهار الأدوات"}
      </button>

      <aside
        id={panelId}
        className={`flex-col gap-3 overflow-y-auto sm:max-h-none sm:flex sm:overflow-visible ${
          open ? "flex max-h-[min(52vh,420px)]" : "hidden sm:flex"
        }`}
      >
        {children}
      </aside>
    </div>
  );
}
