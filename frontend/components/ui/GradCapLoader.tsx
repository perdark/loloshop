/** Hydration-stable brand loader. Avoid inline SVG ids/defs in loading fallbacks. */

export function GradCapLoader({
  className = "",
  size = 56,
}: {
  className?: string;
  size?: number;
}) {
  const sizeClass = size >= 64 ? "h-16 w-16" : "h-14 w-14";

  return (
    <span
      role="status"
      aria-label="جاري التحميل"
      className={`inline-flex ${sizeClass} animate-pulse items-center justify-center rounded-full bg-orange-ink/10 text-orange-ink ${className}`}
    >
      <span
        aria-hidden="true"
        className="h-1/2 w-1/2 rotate-45 rounded-[0.35rem] bg-orange-ink"
      />
    </span>
  );
}
