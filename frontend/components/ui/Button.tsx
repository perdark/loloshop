import { type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
}

/**
 * ⚠️ WHY THIS IS BUILT AROUND :active AND NOT :hover (owner report, 2026-08-04:
 * «the buttons need to be more beauty»).
 *
 * Every bit of this button's character used to live behind `:hover` —
 * `hover:-translate-y-0.5`, `hover:shadow-float`, and `.btn-shine:hover`. Students
 * and wholesalers are **phone-only** (see CLAUDE.md → Device Priority), and a touch
 * device has no hover state at all. So on the primary device the CTA was a flat
 * orange pill that did nothing when tapped, which is exactly what "not beautiful"
 * meant.
 *
 * The fix is not more decoration, it is putting the feedback on the interaction a
 * finger actually produces: `.btn-press` scales the button down under the thumb and
 * drops its shadow, and `.btn-shine` now fires its sheen on `:active` too. Hover
 * effects are kept — they cost nothing and desktop admin screens use the same
 * primitive — but nothing depends on them any more.
 *
 * Everything animated is `transform`/`box-shadow`/`opacity`: compositor-only, so it
 * stays smooth on the low-end Androids this audience carries. All of it collapses
 * under `prefers-reduced-motion` via the CSS in globals.css.
 */
const variants: Record<Variant, string> = {
  // Primary CTA earns a soft resting lift → float on hover, give-way on press.
  primary:
    "btn-shine bg-orange-ink text-white shadow-[var(--shadow-soft)] hover:shadow-[var(--shadow-float)] hover:-translate-y-0.5 disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0",
  secondary:
    "bg-ink text-cream hover:bg-ink/90 hover:-translate-y-0.5 disabled:opacity-50",
  ghost:
    "bg-beige text-ink border border-line hover:border-orange/40 hover:text-orange-ink active:border-orange/60 active:bg-orange/5 disabled:opacity-50",
  // Quiet at rest (warm-brick text on surface); fills only on hover — never hostile in a list.
  danger:
    "bg-beige text-danger border border-danger/35 hover:bg-danger hover:text-white active:bg-danger active:text-white disabled:opacity-50",
};

const sizes: Record<Size, string> = {
  sm: "min-h-11 px-3.5 py-1.5 text-xs",
  md: "min-h-11 px-5 py-2.5 text-sm",
  lg: "min-h-12 px-7 py-3 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  className = "",
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn-press group inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-ink ${sizes[size]} ${variants[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}
