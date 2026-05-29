"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
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

  if (!open) return null;

  return (
    <div
      className="animate-fade-page-in fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-4 backdrop-blur-sm sm:items-center"
      onClick={() => onCloseRef.current()}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="animate-auth-card-in w-full max-w-md overflow-hidden rounded-3xl bg-cream shadow-[var(--shadow-pop)] ring-1 ring-line"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(descriptionId ? { "aria-describedby": descriptionId } : {})}
      >
        <div className="border-b border-line bg-surface-sink px-5 py-4">
          <h2 id={titleId} className="font-display text-xl font-bold text-ink">
            {title}
          </h2>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer !== undefined ? (
          <div className="flex gap-2 border-t border-line px-5 py-4">
            {footer}
          </div>
        ) : (
          <div className="border-t border-line px-5 py-4">
            <Button variant="ghost" fullWidth onClick={onClose}>
              إغلاق
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
