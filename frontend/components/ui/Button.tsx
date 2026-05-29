import { type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
}

const variants: Record<Variant, string> = {
  primary:
    "btn-shine bg-(--color-orange-ink) text-white shadow-[var(--shadow-float)] hover:shadow-[var(--shadow-pop)] hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0",
  secondary:
    "bg-ink text-cream shadow-[var(--shadow-card)] hover:bg-ink/90 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50",
  ghost:
    "bg-white/60 text-ink border border-ink/15 hover:border-orange/40 hover:bg-white hover:text-orange-ink disabled:opacity-50",
  danger:
    "bg-red-700 text-cream shadow-[var(--shadow-card)] hover:bg-red-800 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50",
};

const sizes: Record<Size, string> = {
  sm: "min-h-9 px-3.5 py-1.5 text-xs",
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
      className={`group inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 ${sizes[size]} ${variants[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
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
