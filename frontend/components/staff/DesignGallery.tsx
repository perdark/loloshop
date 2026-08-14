"use client";

// صور التصميم — the order's design imagery, front and center.
// An order's "design" is the set of images riding its spec lines (the calligraphy
// plates auto-attached per zone + any customer reference photos), plus a legacy
// final-design image when one was uploaded before that flow was retired.
// Used by: الكوي station, التحويل/full order view. Renders nothing when no images.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface GalleryEntry {
  title: string;
  url: string;
}

function resolveUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  const base =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:4000";
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

interface DesignGalleryItem {
  label_snapshot: string;
  /** What the STUDENT uploaded as reference. */
  customer_image_url: string | null;
  /** What the calligraphy generator produced for this line (migration 080). */
  plate_image_url?: string | null;
}

export function DesignGallery({
  items,
  finalDesignUrl,
  title = "صور التصميم",
}: {
  items: DesignGalleryItem[];
  finalDesignUrl?: string | null;
  title?: string;
}) {
  // Both images per line, plate first — it is the artwork to work from, and the student's
  // photo is the reference behind it. They used to be the same column, so whichever was
  // written last was the only one anybody could see.
  const entries: GalleryEntry[] = [];
  for (const it of items) {
    const plate = resolveUrl(it.plate_image_url ?? null);
    if (plate) entries.push({ title: `${it.label_snapshot} — الخط المولّد`, url: plate });
    const url = resolveUrl(it.customer_image_url);
    if (url) entries.push({ title: it.label_snapshot, url });
  }
  const finalUrl = resolveUrl(finalDesignUrl);
  if (finalUrl) entries.push({ title: "التصميم النهائي", url: finalUrl });

  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const close = useCallback(() => setOpenIdx(null), []);
  useEffect(() => {
    if (openIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIdx, close]);

  if (!entries.length) return null;

  const open = openIdx !== null ? entries[openIdx] : null;

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)] lg:p-5">
      <h2 className="mb-3 font-display-ar text-lg font-bold text-ink">{title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {entries.map((entry, idx) => (
          <figure key={`${entry.url}-${idx}`} className="min-w-0">
            <button
              type="button"
              onClick={() => setOpenIdx(idx)}
              className="block w-full overflow-hidden rounded-xl border border-line bg-white focus:outline-none focus:ring-2 focus:ring-orange-ink/40"
              aria-label={`عرض ${entry.title} بالحجم الكامل`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={entry.url}
                alt={entry.title}
                className="h-36 w-full object-contain transition-transform duration-200 hover:scale-[1.03] sm:h-44"
                loading="lazy"
              />
            </button>
            <figcaption className="mt-1.5 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs font-semibold text-ink-soft">
                {entry.title}
              </span>
              <a
                href={entry.url}
                download
                className="shrink-0 rounded-full border border-line bg-beige px-2.5 py-1 text-[11px] font-semibold text-ink transition-colors hover:border-orange/40 hover:text-orange-ink"
              >
                تنزيل
              </a>
            </figcaption>
          </figure>
        ))}
      </div>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-ink/80 p-4"
            role="dialog"
            aria-modal="true"
            aria-label={open.title}
            onClick={close}
          >
            <button
              type="button"
              onClick={close}
              aria-label="إغلاق"
              /* Status-bar clearance — same reason as Lightbox.tsx: this is the only
                 way out of a fullscreen viewer, and edge-to-edge would bury it. */
              className="absolute end-4 top-[max(1rem,calc(env(safe-area-inset-top,0px)+0.5rem))] flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl leading-none text-white transition-colors hover:bg-white/30"
            >
              ✕
            </button>
            <figure
              className="max-h-full max-w-4xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={open.url}
                alt={open.title}
                className="max-h-[82vh] w-auto max-w-full rounded-xl bg-white object-contain"
              />
              <figcaption className="mt-3 flex items-center justify-center gap-3">
                <span className="text-sm font-semibold text-white">{open.title}</span>
                <a
                  href={open.url}
                  download
                  className="rounded-full bg-white/15 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-white/30"
                >
                  تنزيل
                </a>
              </figcaption>
            </figure>
          </div>,
          document.body
        )}
    </section>
  );
}
