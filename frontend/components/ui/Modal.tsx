"use client";

import { useEffect, type ReactNode } from "react";
import { Button } from "./Button";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-cream shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="border-b border-ink/10 px-5 py-4">
          <h2 id="modal-title" className="font-display text-xl text-ink">
            {title}
          </h2>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer !== undefined ? (
          <div className="flex gap-2 border-t border-ink/10 px-5 py-4">
            {footer}
          </div>
        ) : (
          <div className="border-t border-ink/10 px-5 py-4">
            <Button variant="ghost" fullWidth onClick={onClose}>
              إغلاق
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
