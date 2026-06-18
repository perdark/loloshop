"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

/**
 * Cross-fades through a list of images on a timer — used for storefront package
 * cards whose photos the admin sets and which "change automatically with time".
 * A single image renders statically. Respects prefers-reduced-motion (no auto
 * rotation; shows the first frame).
 */
export function AutoRotatingImage({
  images,
  alt,
  sizes,
  intervalMs = 4000,
  imgClassName = "object-cover",
  className = "",
}: {
  images: string[];
  alt: string;
  sizes?: string;
  intervalMs?: number;
  imgClassName?: string;
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const n = images.length;

  useEffect(() => {
    if (n <= 1) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const t = setInterval(() => {
      // Pause while the tab is hidden to avoid pointless work.
      if (!document.hidden) setActive((i) => (i + 1) % n);
    }, intervalMs);
    return () => clearInterval(t);
  }, [n, intervalMs]);

  if (n === 0) return null;

  return (
    <div className={`absolute inset-0 ${className}`}>
      {images.map((src, i) => (
        <Image
          key={`${src}-${i}`}
          src={src}
          alt={i === 0 ? alt : ""}
          fill
          unoptimized
          sizes={sizes}
          aria-hidden={i !== active}
          className={`${imgClassName} transition-opacity duration-700 ease-out ${
            i === active ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}
      {n > 1 && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
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
