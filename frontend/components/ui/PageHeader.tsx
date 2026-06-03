import Link from "next/link";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  /** When set, renders a back link above the title (e.g. "العودة للوحة التحكم"). */
  backHref?: string;
  backLabel?: string;
}

export function PageHeader({
  title,
  subtitle,
  action,
  backHref,
  backLabel = "العودة للوحة التحكم",
}: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-3 border-b border-ink/10 pb-5">
      {backHref && (
        <Link
          href={backHref}
          className="inline-flex min-h-[44px] w-fit items-center gap-1.5 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-soft shadow-[var(--shadow-soft)] transition-colors hover:border-orange-ink/40 hover:text-orange-ink"
        >
          <span aria-hidden>→</span>
          {backLabel}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold leading-tight text-ink lg:text-3xl">
            {title}
          </h1>
          {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}
