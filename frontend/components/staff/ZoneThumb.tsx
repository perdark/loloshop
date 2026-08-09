"use client";

// One embroidery-zone artwork thumbnail, shared by التطريز (StudentSheet) and التجهيز
// (PrepConsole).
//
// ⚠️ WHY THIS EXISTS AS A COMPONENT — it replaces a raw `<img src>` that was pulling the
// FULL upload for a 44 px box. Customer artwork on disk measures 4–6 MB (see the
// 2026-08-01 handoff entry: uploads were never resized until that session, and the 54
// existing files are still full-size). A worker opening a student with five zones was
// downloading ~25 MB to look at five stamp-sized previews, over workshop wifi, every
// single time — `/uploads` is `Cache-Control: private, no-store`, so nothing was reused
// between visits.
//
// Routing through next/image fixes BOTH halves at once: the optimizer resizes to the box
// (~2–15 KB of WebP) AND serves its own `public, max-age=14400`, which overrides the
// upstream no-store. Measured on prod for the same 4.5 MB source: 96 KB PNG / 13 KB WebP.
//
// In dev the optimizer is off (`unoptimized` in next.config.ts — see the long comment
// there about the 7 s upstream timeout), so this renders exactly like the old raw <img>.
// The win is real on prod only, which is where the workshop actually runs.

import Image from "next/image";
import { useState } from "react";

export function ZoneThumb({
  url,
  label,
  size = 44,
  onOpen,
}: {
  url: string;
  label: string;
  /** Rendered box in px. The optimizer is asked for 2× this for retina. */
  size?: number;
  onOpen: (url: string, label: string) => void;
}) {
  const [failed, setFailed] = useState(false);

  // A broken artwork URL must not read as "this zone has no image" — the preparer would
  // pack a piece believing nothing was stitched on it. Show an explicit marker instead.
  if (failed) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-lg border border-dashed border-line bg-surface-sink text-[10px] font-semibold text-ink-soft"
        style={{ width: size, height: size }}
        title={`تعذر تحميل صورة ${label}`}
      >
        ؟
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(url, label)}
      aria-label={`عرض صورة ${label}`}
      className="shrink-0 overflow-hidden rounded-lg border border-line bg-white transition-colors hover:border-orange-ink/50 focus:outline-none focus:ring-2 focus:ring-orange-ink/40"
      style={{ width: size, height: size }}
    >
      <Image
        src={url}
        alt={label}
        width={size * 2}
        height={size * 2}
        sizes={`${size}px`}
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
        // Deliberately lazy: a student can carry 5+ zones and the worker scrolls past
        // most of them. `loading="eager"` here would undo the point of the optimizer.
        loading="lazy"
      />
    </button>
  );
}
