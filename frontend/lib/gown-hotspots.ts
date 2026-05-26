/**
 * Calibrated hotspot geometry for public/gown-sash.png (V-stole navy columns).
 * Shared by SashGownPreview (DOM) and render-gown-composite (canvas export).
 */

import type { CSSProperties } from "react";

export const GOWN_IMAGE_SRC = "/gown-sash.png";
export const GOWN_NATIVE_WIDTH = 1402;
export const GOWN_NATIVE_HEIGHT = 1122;
export const GOWN_ASPECT_RATIO = `${GOWN_NATIVE_WIDTH} / ${GOWN_NATIVE_HEIGHT}`;

export type GownSide = "left" | "right";

/** Percent of gown image box */
export type HotspotPercent = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export const HOTSPOT_LEFT_PERCENT: HotspotPercent = {
  left: 35.5,
  top: 15,
  width: 13.5,
  height: 73,
};

export const HOTSPOT_RIGHT_PERCENT: HotspotPercent = {
  left: 51.5,
  top: 15,
  width: 13.5,
  height: 73,
};

/** CSS clip-path for sash panel (matches SashGownPreview) */
export const SASH_CLIP_PATH =
  "polygon(0% 0%, 100% 0%, 100% 88%, 50% 100%, 0% 88%)";

/** In-DOM FabricPanelPreview size inside each hotspot */
export const PREVIEW_PANEL_WIDTH = 150;
export const PREVIEW_PANEL_HEIGHT = 430;

export function hotspotPercent(side: GownSide): HotspotPercent {
  return side === "left" ? HOTSPOT_LEFT_PERCENT : HOTSPOT_RIGHT_PERCENT;
}

export function hotspotPixelRect(
  gownW: number,
  gownH: number,
  side: GownSide
): { left: number; top: number; width: number; height: number } {
  const p = hotspotPercent(side);
  return {
    left: Math.round((gownW * p.left) / 100),
    top: Math.round((gownH * p.top) / 100),
    width: Math.round((gownW * p.width) / 100),
    height: Math.round((gownH * p.height) / 100),
  };
}

/** CSS position styles for overlaying a hotspot on the gown container */
export function hotspotCssStyle(side: GownSide): CSSProperties {
  const p = hotspotPercent(side);
  return {
    position: "absolute",
    top: `${p.top}%`,
    left: `${p.left}%`,
    width: `${p.width}%`,
    height: `${p.height}%`,
    minWidth: "2.75rem",
    minHeight: "2.75rem",
  };
}
