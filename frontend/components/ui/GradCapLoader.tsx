/**
 * GradCapLoader — graduation-cap (mortarboard) themed loading mark.
 * Lightweight inline SVG, no external libs. Brand orange gradient.
 * Gentle bob on the cap + a swinging tassel. Respects prefers-reduced-motion
 * via the global reduce rule in globals.css. RTL-safe (purely visual, no text).
 */
export function GradCapLoader({
  className = "",
  size = 56,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <span
      role="status"
      aria-label="جاري التحميل"
      className={`inline-block ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        fill="none"
        aria-hidden="true"
        className="block"
      >
        <defs>
          <linearGradient id="gradcap-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-orange-light)" />
            <stop offset="100%" stopColor="var(--color-orange)" />
          </linearGradient>
        </defs>

        {/* Cap group: gentle vertical bob */}
        <g className="gradcap-bob" style={{ transformOrigin: "50px 50px" }}>
          {/* Mortarboard board (diamond) */}
          <path
            d="M50 22 L88 40 L50 58 L12 40 Z"
            fill="url(#gradcap-fill)"
          />
          {/* Cap base / head band under the board */}
          <path
            d="M32 49 L50 58 L68 49 L68 64 Q50 76 32 64 Z"
            fill="var(--color-orange-ink)"
            opacity="0.92"
          />
          {/* Button at the top center of the board */}
          <circle cx="50" cy="40" r="3.2" fill="var(--color-orange-ink)" />
        </g>

        {/* Tassel: anchored at the board centre, swings like a pendulum */}
        <g className="gradcap-tassel" style={{ transformOrigin: "50px 40px" }}>
          <line
            x1="50"
            y1="40"
            x2="50"
            y2="66"
            stroke="var(--color-orange-ink)"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          {/* Tassel knot + fringe */}
          <circle cx="50" cy="68" r="3.4" fill="var(--color-orange)" />
          <path
            d="M50 70 L50 80 M46 70 L47 79 M54 70 L53 79"
            stroke="var(--color-orange)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
      </svg>
    </span>
  );
}
