import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string;
  accent?: "default" | "profit";
  /** Small monochrome line icon, sized 18px, rendered muted. */
  icon?: ReactNode;
  /** Quiet context line under the value (e.g. a margin, a delta). */
  hint?: string;
}

export function StatCard({ label, value, accent = "default", icon, hint }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-beige p-5">
      <div className="flex items-center justify-between gap-3 border-b border-ink/10 pb-3">
        <p className="text-sm font-medium text-ink-soft">{label}</p>
        {icon && <span aria-hidden className="text-ink/35">{icon}</span>}
      </div>
      <p
        className={`mt-3 text-[2rem] font-bold leading-none tabular-nums ${
          accent === "profit" ? "text-emerald-700" : "text-ink"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-2 text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}
