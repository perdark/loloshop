"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

export interface MoneyRevealTriggerProps {
  /** Verify the secret. Resolve true to reveal, false to reject. */
  onSubmit: (secret: string) => Promise<boolean>;
  /** Called after a correct secret unlocks the figures. */
  onRevealed?: () => void;
  /** Called when the (revealed) control is clicked to re-hide. */
  onHide?: () => void;
  /** Whether figures are currently revealed (controlled by the parent). */
  revealed?: boolean;
  className?: string;
  /**
   * `inline` (default) renders in normal flow; `fixed` pins the control to a
   * screen corner via a portal to <body> so it escapes stacking contexts
   * (used on the fullscreen TV board).
   */
  position?: "fixed" | "inline";
  /** Neutral accessible label. Never say "money"/"سعر"/"ربح". */
  label?: string;
}

/**
 * A DISGUISED reveal control. It looks like an innocuous 🎓 branding chip, not
 * a "show the money" button. Clicking it opens a tiny password popover; a
 * correct secret calls `onRevealed`. Once revealed, the same chip turns into a
 * quiet "hide" affordance (`onHide`). Shared by the public TV board (secret
 * verified server-side) and the admin dashboard (client masking).
 */
export function MoneyRevealTrigger({
  onSubmit,
  onRevealed,
  onHide,
  revealed = false,
  className = "",
  position = "inline",
  label = "خيارات العرض",
}: MoneyRevealTriggerProps) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  const closePopover = useCallback(() => {
    setOpen(false);
    setSecret("");
    setError(false);
    setShake(false);
  }, []);

  // Focus the input when the popover opens.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Outside-click + Escape close the popover. Portal children are real DOM
  // descendants of rootRef, so contains() still holds when position='fixed'.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        closePopover();
      }
    }
    function onKey(e: KeyboardEvent | globalThis.KeyboardEvent) {
      if (e.key === "Escape") closePopover();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey as EventListener);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey as EventListener);
    };
  }, [open, closePopover]);

  const handleTriggerClick = useCallback(() => {
    if (revealed) {
      onHide?.();
      return;
    }
    setOpen((v) => !v);
  }, [revealed, onHide]);

  const submit = useCallback(async () => {
    if (submitting || !secret) return;
    setSubmitting(true);
    setError(false);
    let ok = false;
    try {
      ok = await onSubmit(secret);
    } catch {
      ok = false;
    }
    setSubmitting(false);
    if (ok) {
      onRevealed?.();
      closePopover();
    } else {
      setError(true);
      setShake(true);
      setSecret("");
      inputRef.current?.focus();
      setTimeout(() => setShake(false), 480);
    }
  }, [submitting, secret, onSubmit, onRevealed, closePopover]);

  const onInputKey = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void submit();
      }
    },
    [submit]
  );

  const wrapperClass =
    position === "fixed"
      ? "fixed bottom-4 start-4 z-[80]"
      : "relative inline-flex";

  const popoverPos =
    position === "fixed"
      ? "bottom-full mb-2 start-0"
      : "top-full mt-2 end-0";

  const content = (
    <div ref={rootRef} className={`${wrapperClass} ${className}`.trim()}>
      <style>{`
        @keyframes money-reveal-shake {
          0%,100% { transform: translateX(0); }
          20% { transform: translateX(-5px); }
          40% { transform: translateX(5px); }
          60% { transform: translateX(-3px); }
          80% { transform: translateX(3px); }
        }
        .money-reveal-shake { animation: money-reveal-shake 0.45s ease-in-out; }
      `}</style>

      <button
        type="button"
        onClick={handleTriggerClick}
        aria-label={label}
        aria-expanded={open}
        title={label}
        className="flex h-11 w-11 items-center justify-center rounded-full text-base opacity-60 transition-all hover:opacity-100 hover:bg-orange/10 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-ink/60"
      >
        {revealed ? (
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-5 w-5 text-orange-ink"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="4" y="11" width="16" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        ) : (
          <span aria-hidden className="text-lg leading-none">
            🎓
          </span>
        )}
      </button>

      {open && !revealed && (
        <div
          role="dialog"
          aria-label={label}
          dir="rtl"
          className={`absolute ${popoverPos} z-[90] w-56 rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow-pop)] ${
            shake ? "money-reveal-shake" : ""
          }`}
        >
          <input
            ref={inputRef}
            type="password"
            inputMode="text"
            autoComplete="off"
            value={secret}
            onChange={(e) => {
              setSecret(e.target.value);
              if (error) setError(false);
            }}
            onKeyDown={onInputKey}
            placeholder="••••"
            aria-label={label}
            aria-invalid={error}
            className={`w-full rounded-xl border bg-white px-3 py-2 text-center text-lg tracking-widest text-ink outline-none transition-colors placeholder:text-ink-soft/40 ${
              error
                ? "border-red-400 focus:border-red-500"
                : "border-line focus:border-orange-ink"
            }`}
          />
          {error && (
            <p className="mt-1.5 text-center text-xs font-semibold text-red-600">
              غير صحيح
            </p>
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || !secret}
            className="mt-2 flex h-11 w-full items-center justify-center rounded-xl bg-orange-ink text-sm font-bold text-white transition-all hover:brightness-110 active:scale-95 disabled:opacity-40"
          >
            {submitting ? "…" : "تأكيد"}
          </button>
        </div>
      )}
    </div>
  );

  if (position === "fixed") {
    if (!mounted) return null;
    return createPortal(content, document.body);
  }
  return content;
}

export default MoneyRevealTrigger;
