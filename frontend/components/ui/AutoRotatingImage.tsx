"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Cross-fades through a list of images on a timer — used for storefront package
 * cards whose photos the admin sets and which "change automatically with time".
 * A single image renders statically. Respects prefers-reduced-motion (no auto
 * rotation; shows the first frame).
 *
 * With `controls`, it also becomes manually sliddable: ‹ › arrows (desktop), a
 * left/right swipe (touch), and dot indicators. A manual move restarts the
 * auto-rotate timer so the photo never jumps right after you tap.
 */
export function AutoRotatingImage({
  images,
  alt,
  sizes,
  intervalMs = 4000,
  imgClassName = "object-cover",
  className = "",
  priority = false,
  showDots = true,
  controls = false,
}: {
  images: string[];
  alt: string;
  sizes?: string;
  intervalMs?: number;
  imgClassName?: string;
  className?: string;
  priority?: boolean;
  showDots?: boolean;
  controls?: boolean;
}) {
  const [active, setActive] = useState(0);
  const n = images.length;
  const touchStartX = useRef<number | null>(null);

  // Move by `dir` (±1), wrapping at both ends.
  const step = useCallback(
    (dir: number) => setActive((i) => (((i + dir) % n) + n) % n),
    [n]
  );

  // Auto-rotate. Depends on `active` so a manual move restarts the timer (the
  // photo won't jump straight after a tap/swipe). Pauses on reduced-motion and
  // while the tab is hidden.
  useEffect(() => {
    if (n <= 1) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const t = setInterval(() => {
      if (!document.hidden) setActive((i) => (i + 1) % n);
    }, intervalMs);
    return () => clearInterval(t);
  }, [n, intervalMs, active]);

  if (n === 0) return null;

  return (
    <div className={`absolute inset-0 ${className}`}>
      {/* Photo layer + swipe surface */}
      <div
        className="absolute inset-0"
        onTouchStart={
          controls && n > 1
            ? (e) => {
                touchStartX.current = e.touches[0].clientX;
              }
            : undefined
        }
        onTouchEnd={
          controls && n > 1
            ? (e) => {
                const start = touchStartX.current;
                touchStartX.current = null;
                if (start == null) return;
                const dx = e.changedTouches[0].clientX - start;
                if (Math.abs(dx) < 40) return; // ignore taps / tiny drags
                // swipe left → next photo, swipe right → previous
                step(dx < 0 ? 1 : -1);
              }
            : undefined
        }
      >
        {images.map((src, i) => (
          <Image
            key={`${src}-${i}`}
            src={src}
            alt={i === 0 ? alt : ""}
            fill
            unoptimized
            priority={priority && i === 0}
            sizes={sizes}
            aria-hidden={i !== active}
            className={`${imgClassName} transition-opacity duration-700 ease-out ${
              i === active ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
      </div>

      {/* Manual arrows — RTL: previous on the start (right) edge, next on the
          end (left) edge. preventDefault stops the wrapping <Link> navigating. */}
      {controls && n > 1 && (
        <>
          <button
            type="button"
            aria-label="الصورة السابقة"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              step(-1);
            }}
            className="absolute start-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-colors hover:bg-black/55"
          >
            <span aria-hidden className="text-2xl leading-none">
              ›
            </span>
          </button>
          <button
            type="button"
            aria-label="الصورة التالية"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              step(1);
            }}
            className="absolute end-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-colors hover:bg-black/55"
          >
            <span aria-hidden className="text-2xl leading-none">
              ‹
            </span>
          </button>
        </>
      )}

      {showDots && n > 1 && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
          {images.map((_, i) => (
            <span
              key={i}
              aria-hidden
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === active ? "w-4 bg-white" : "w-1.5 bg-white/55"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
