"use client";

// Fullscreen image viewer for zone artwork (plates / customer photos) — portal'd
// like DesignGallery's viewer so no parent stacking context can trap it.

import Image from "next/image";
import { useEffect } from "react";
import { createPortal } from "react-dom";

export function Lightbox({
  url,
  title,
  onClose,
}: {
  url: string;
  title: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-ink/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="إغلاق الصورة"
        className="absolute end-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl leading-none text-white transition-colors hover:bg-white/30"
      >
        ✕
      </button>
      <figure className="max-h-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
        {/* Through the optimizer like the thumbnails (see components/staff/ZoneThumb.tsx):
            the raw upload is a 4–6 MB original, and the worker is looking at it on a
            phone/iPad. 1600 px wide is past retina for an 82vh box and still ~40× smaller.
            `object-contain` + intrinsic w/h keeps artwork undistorted whatever its ratio. */}
        <Image
          src={url}
          alt={title}
          width={1600}
          height={1600}
          sizes="(max-width: 896px) 100vw, 896px"
          className="max-h-[82vh] w-auto max-w-full rounded-xl bg-white object-contain"
          loading="eager"
        />
        <figcaption className="mt-3 text-center text-sm font-semibold text-white">{title}</figcaption>
      </figure>
    </div>,
    document.body
  );
}
