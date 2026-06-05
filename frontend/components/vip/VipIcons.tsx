import type { SVGProps } from "react";

/**
 * Inline SVG icons for the VIP surfaces — replaces the Stitch mock's Material
 * Symbols (the app loads no icon font). Stroke-based on `currentColor`, 24×24.
 * The crest is filled (reused from VipBadge); the rest are stroked.
 */
type IconProps = { className?: string };

const STROKE: SVGProps<SVGSVGElement> = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function IconCrest({ className = "h-6 w-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="m5 16-2-9 5.5 4L12 4l3.5 7L21 7l-2 9H5Zm-.5 2h15v2.1h-15V18Z" />
    </svg>
  );
}

export function IconDiamond({ className = "h-6 w-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE} aria-hidden>
      <path d="M6 3h12l3 5.5-9 12.5L3 8.5 6 3Z" />
      <path d="M3 8.5h18M9 3 6 8.5 12 21M15 3l3 5.5L12 21" />
    </svg>
  );
}

export function IconFabric({ className = "h-6 w-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE} aria-hidden>
      <path d="M4 6c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 4 0" />
      <path d="M4 12c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 4 0" />
      <path d="M4 18c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 4 0" />
    </svg>
  );
}

export function IconTruck({ className = "h-6 w-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE} aria-hidden>
      <path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.7" />
      <circle cx="17.5" cy="18" r="1.7" />
    </svg>
  );
}

export function IconGift({ className = "h-6 w-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE} aria-hidden>
      <path d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13" />
      <path d="M12 7C12 7 11 3.2 8.6 4 6.8 4.6 7.6 7 12 7ZM12 7c0 0 1-3.8 3.4-3 1.8.6 1 3-3.4 3Z" />
    </svg>
  );
}

export function IconCheck({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE} strokeWidth={2.4} aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function IconList({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE} aria-hidden>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="m3.5 6 1 1 1.6-1.7M3.5 12l1 1 1.6-1.7M3.5 18l1 1 1.6-1.7" />
    </svg>
  );
}

/** Forward chevron — points start-ward (visually "forward") in the RTL layout. */
export function IconArrow({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE} strokeWidth={2} aria-hidden>
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

/** Perks-strip glyphs by index: gold embroidery · fabric · priority · gift. */
export const PERK_ICONS = [IconDiamond, IconFabric, IconTruck, IconGift];
