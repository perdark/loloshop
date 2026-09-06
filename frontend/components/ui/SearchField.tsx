"use client";

/**
 * A search box that can always be cleared.
 *
 * ── WHY THE ✕ IS OURS AND NOT THE BROWSER'S ──────────────────────────────────
 * `type="search"` renders a native clear control in a desktop browser, so on the laptop this
 * looks like work that was already done. It is not: every staff screen also runs inside the
 * **Capacitor WebView** on the iPad and on phones, where that control is not guaranteed to
 * appear at all. A worker who cannot clear a query sees a queue that looks EMPTY — the rows
 * are filtered out, not missing, and nothing on screen says so.
 *
 * Reported by برزان (مجهّز) on 2026-09-06, on التجهيز. The box on `/staff` had carried its own
 * copy of this ✕ since 2026-08-24 while the other seven staff search boxes had none — which is
 * exactly why it now lives in ONE component instead of being pasted per screen.
 *
 * ── NOTES FOR A FUTURE EDIT ──────────────────────────────────────────────────
 * · The button is 44×44 (`h-11 w-11`) because it is a real tap target on a phone, and it is
 *   rendered ONLY when there is something to clear — an always-present ✕ on an empty box reads
 *   as a decoration nobody presses.
 * · The end padding is reserved unconditionally, so the text does not jump sideways the moment
 *   the ✕ appears mid-typing.
 * · `end-*` / `pe-*` are logical properties: they resolve to the LEFT on these RTL screens.
 *   Never swap them for `right-*` / `pr-*`.
 * · Clearing returns focus to the field. On a phone the keyboard is already open and the worker
 *   is mid-search; dropping focus would close it and cost them a tap to start over.
 */

import { useRef } from "react";

/**
 * `card` mirrors the `Input` primitive (rounded-xl on beige) — for the boxes that sit inside a
 * `surface-card` filter panel. `pill` mirrors the rounded-full bar used on `/staff` and the
 * queue. Anything else a screen needs goes through `inputClassName`, which is appended last and
 * therefore wins, rather than by adding a third variant nobody else uses.
 */
type Variant = "card" | "pill";

const BASE =
  "w-full border text-ink outline-none transition-colors placeholder:text-muted " +
  "focus:border-orange-ink [&::-webkit-search-cancel-button]:appearance-none";

/* text-base on `card` is NOT decorative — it is the same rule the Input primitive documents:
   iOS Safari zooms the whole page when a focused field is under 16px and drops the worker
   mid-layout. `pill` keeps text-sm because those bars are not inside a zoom-prone form. */
const VARIANTS: Record<Variant, string> = {
  card: "min-h-12 rounded-xl border-line bg-beige px-3.5 py-2.5 text-base shadow-[var(--shadow-soft)] hover:border-ink/30 focus:ring-2 focus:ring-orange-ink/20",
  pill: "min-h-11 rounded-full border-line bg-surface px-4 py-1 text-sm",
};

export function SearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  variant = "card",
  className = "",
  inputClassName = "",
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Defaults to `placeholder` — a search box with neither is unlabelled for a screen reader. */
  ariaLabel?: string;
  variant?: Variant;
  /** Wrapper — width lives here (the wrapper is `relative`, so the ✕ anchors to it). */
  className?: string;
  /** Appended to the input after the variant, so a screen can override any single class. */
  inputClassName?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLInputElement | null>(null);

  return (
    <div className={`relative ${className}`}>
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        dir="rtl"
        autoFocus={autoFocus}
        className={`${BASE} ${VARIANTS[variant]} pe-12 ${inputClassName}`}
      />
      {value !== "" && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            ref.current?.focus();
          }}
          aria-label="مسح البحث"
          className="absolute inset-y-0 end-1 my-auto flex h-11 w-11 items-center justify-center rounded-full text-lg leading-none text-ink-soft transition-colors hover:bg-surface-sink hover:text-ink"
        >
          ✕
        </button>
      )}
    </div>
  );
}
