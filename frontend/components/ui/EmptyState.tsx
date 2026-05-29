import type { ReactNode } from "react";

interface EmptyStateProps {
  /** Primary line — the situation. */
  message: string;
  /** Optional bold heading above the message. */
  title?: string;
  /** Optional custom icon; defaults to a neutral inbox (never a trash can). */
  icon?: ReactNode;
  /** Optional CTA / retry action rendered below the message. */
  action?: ReactNode;
}

/** Neutral "nothing here" tray — not a delete metaphor. */
function InboxIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12h4l2 3h6l2-3h4" />
      <path d="M5 12V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6" />
      <path d="M3 12v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

export function EmptyState({ message, title, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-[var(--shop-sink)] px-4 py-14 text-center">
      <span
        aria-hidden
        className="flex h-14 w-14 items-center justify-center rounded-full bg-ink/[0.06] text-ink-soft"
      >
        {icon ?? <InboxIcon />}
      </span>
      {title && <p className="text-base font-semibold text-ink">{title}</p>}
      <p className="max-w-[40ch] text-sm font-medium text-ink-soft">{message}</p>
      {action}
    </div>
  );
}
