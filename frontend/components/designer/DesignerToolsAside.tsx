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
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-orange/25 bg-orange/10 px-4 text-sm font-semibold text-ink transition-colors hover:bg-orange/15 sm:hidden"
      >
        <span aria-hidden>{open ? "▲" : "▼"}</span>
        {open ? "إخفاء الأدوات — توسيع الوشاح" : "إظهار الأدوات"}
      </button>

      <aside
        id={panelId}
        className={`flex-col gap-3 overflow-y-auto sm:max-h-none sm:flex sm:overflow-visible ${
          open ? "flex max-h-[min(60vh,520px)]" : "hidden sm:flex"
        }`}
      >
        {children}
      </aside>
    </div>
  );
}
