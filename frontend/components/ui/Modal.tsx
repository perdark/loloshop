"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  descriptionId?: string;
}

const FOCUSABLE =
  'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children, footer, descriptionId }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  // Mount guard: createPortal needs document.body, which only exists client-side.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const close = () => onCloseRef.current();
    const prev = document.activeElement as HTMLElement | null;

    // Focus first focusable element inside the dialog
    requestAnimationFrame(() => {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      focusable?.[0]?.focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
        ).filter((el) => el.offsetParent !== null); // skip hidden
        if (focusable.length === 0) { e.preventDefault(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open]);

  if (!open || !mounted) return null;

  // Portaled to <body> so the overlay escapes any ancestor stacking context
  // (e.g. the wholesaler/student layouts whose `animate-page-in` leaves a
  // persistent transform on <main>, which would otherwise trap this z-50 below
  // the fixed bottom nav and clip the footer buttons off-screen).
  return createPortal(
    <div
      // Bottom sheet on mobile (`items-end`): pad past the iPhone home-indicator
      // safe area so the sheet — and its footer buttons — never sit under it.
      // `env()` resolves to 0 on devices without an inset, so this is a no-op there.
      className="animate-fade-page-in fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:pb-4"
      onClick={() => onCloseRef.current()}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="animate-auth-card-in flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-cream shadow-[var(--shadow-pop)] ring-1 ring-line"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(descriptionId ? { "aria-describedby": descriptionId } : {})}
      >
        <div className="shrink-0 border-b border-line bg-surface-sink px-5 py-4">
          <h2 id={titleId} className="font-display text-xl font-bold text-ink">
            {title}
          </h2>
        </div>
        {/* Scrollable body — caps the modal to the viewport so tall forms (e.g. add
            wholesaler) scroll instead of overflowing off-screen. */}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer !== undefined ? (
          <div className="flex shrink-0 gap-2 border-t border-line px-5 py-4">
            {footer}
          </div>
        ) : (
          <div className="shrink-0 border-t border-line px-5 py-4">
            <Button variant="ghost" fullWidth onClick={onClose}>
              إغلاق
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
