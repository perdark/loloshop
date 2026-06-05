import type { CSSProperties } from "react";
import { vipAccent } from "./vipAccent";

/**
 * Premium VIP pill — ink ground + gold accent text/ring (high contrast, accessible),
 * with an optional sheen sweep. The accent is the only "gold" used; CTAs stay on the
 * WCAG-safe brand gradient.
 */
export function VipBadge({
  label,
  accent,
  sheen = false,
  size = "sm",
  className = "",
}: {
  label?: string | null;
  accent?: string | null;
  sheen?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const a = vipAccent(accent);
  const pad = size === "md" ? "px-3 py-1 text-xs" : "px-2.5 py-0.5 text-[11px]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-ink font-display font-bold tracking-wide ${pad} ${
        sheen ? "vip-sheen" : ""
      } ${className}`}
      style={{ color: a, boxShadow: `inset 0 0 0 1px ${a}66`, "--vip-accent": a } as CSSProperties}
    >
      <svg aria-hidden viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
        <path d="m5 16-2-9 5.5 4L12 4l3.5 7L21 7l-2 9H5Zm-.5 2h15v2.1h-15V18Z" />
      </svg>
      {label || "VIP"}
    </span>
  );
}
