"use client";

import type { ReactNode } from "react";

/**
 * Reveal-or-mask wrapper for a single sensitive figure.
 *
 * When `show` is true it renders `children` (the real number). Otherwise it
 * renders a muted placeholder ("••••••" by default) styled to sit in the same
 * inline flow, so toggling the gate open/closed doesn't shift the layout.
 *
 * The placeholder is `aria-hidden` — screen readers skip the dots when masked.
 *
 *   <MoneyMask show={revealed}>{formatIQD(order.profit)}</MoneyMask>
 */
export function MoneyMask({
  show,
  children,
  placeholder = "••••••",
  className = "",
}: {
  show: boolean;
  children: ReactNode;
  placeholder?: string;
  className?: string;
}) {
  if (show) {
    return className ? <span className={className}>{children}</span> : <>{children}</>;
  }
  return (
    <span
      aria-hidden="true"
      className={`select-none tracking-widest text-ink-soft/50 ${className}`}
    >
      {placeholder}
    </span>
  );
}

export default MoneyMask;
