"use client";

/** Sticky bottom glass CTA bar — mirrors the cart/package bars. Primary + optional secondary.
 *  `visible` slides it up/down from the bottom so the parent can reveal after the hero. */
export function VipStickyCta({
  visible = true,
  priceLabel,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  busy = false,
  disabled = false,
}: {
  visible?: boolean;
  priceLabel?: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      aria-hidden={!visible}
      style={{ paddingBottom: "calc(0.875rem + env(safe-area-inset-bottom))" }}
      className={[
        "fixed inset-x-0 bottom-0 z-30 border-t border-line surface-glass px-4 py-3.5 shadow-[var(--shadow-float)]",
        "transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
        visible ? "translate-y-0" : "translate-y-full pointer-events-none",
      ].join(" ")}
    >
      <div className="mx-auto flex max-w-lg flex-col gap-2">
        <button
          type="button"
          onClick={onPrimary}
          disabled={busy || disabled}
          className="btn-shine cta-pulse inline-flex min-h-12 w-full items-center justify-center rounded-pill bg-brand-gradient px-6 text-sm font-bold text-white shadow-[var(--shadow-card)] transition-transform active:scale-[0.99] disabled:opacity-60"
        >
          {busy ? "جارٍ…" : primaryLabel}
        </button>
        {secondaryLabel && onSecondary && (
          <button
            type="button"
            onClick={onSecondary}
            disabled={busy || disabled}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-pill border border-line bg-beige/60 px-6 text-sm font-semibold text-ink transition-colors hover:border-orange-ink/40 hover:text-orange-ink disabled:opacity-60"
          >
            {secondaryLabel}
          </button>
        )}
        {priceLabel && (
          <p className="text-center text-xs text-[var(--shop-muted)]">{priceLabel}</p>
        )}
      </div>
    </div>
  );
}
