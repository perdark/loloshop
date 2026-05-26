"use client";

import { useEffect, useState } from "react";
import {
  panelHasContent,
  renderPanelToDataUrl,
} from "@/lib/render-sash-panel";

type Props = {
  json: unknown | null;
  sashColor: string;
  width: number;
  height: number;
  fontsUsed?: string[];
};

/** Renders panel JSON as a PNG overlay for gown hotspot (avoids nested Fabric DOM scaling bugs) */
export function GownPanelImage({
  json,
  sashColor,
  width,
  height,
  fontsUsed,
}: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const hasContent = panelHasContent(json);

  const jsonKey =
    json && typeof json === "object"
      ? JSON.stringify((json as { objects?: unknown[] }).objects ?? [])
      : "";

  useEffect(() => {
    if (!hasContent) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      renderPanelToDataUrl({
        json,
        sashColor,
        targetWidth: width,
        targetHeight: height,
        fontsUsed,
        transparentBg: true,
      })
        .then((url) => {
          if (!cancelled) setSrc(url);
        })
        .catch((err) => {
          if (process.env.NODE_ENV === "development") {
            console.warn("[GownPanelImage] render failed", err);
          }
          if (!cancelled) setSrc(null);
        });
    }, 80);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hasContent, jsonKey, json, sashColor, width, height, fontsUsed]);

  if (!hasContent || !src) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="pointer-events-none h-full w-full object-fill"
      draggable={false}
    />
  );
}
