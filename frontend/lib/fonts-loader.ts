// Helper: load a Google Font CSS link once, then wait for the font to be ready
// for Fabric.js to render with it.

import type { FontDef } from "./types";

const loadedIds = new Set<string>();
/** Known weights per font id, populated as fonts load (drives boldSupported). */
const weightsById = new Map<string, number[]>();

const DEFAULT_WEIGHTS = [400, 700];

function fontIdToGoogleFamily(id: string): string {
  return id
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("+");
}

function fontIdToCssFamily(id: string): string {
  return id
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function weightsFor(font: FontDef): number[] {
  const w = font.weights?.length ? font.weights : DEFAULT_WEIGHTS;
  weightsById.set(font.id, w);
  return w;
}

/** True when the font ships a 700 weight (real bold, not faux). */
export function boldSupported(id: string): boolean {
  const w = weightsById.get(id);
  // Unknown font → assume bold exists so the control isn't wrongly hidden.
  return w ? w.includes(700) : true;
}

export async function loadFont(font: FontDef): Promise<string> {
  const family = fontIdToCssFamily(font.id);
  const weights = weightsFor(font);

  if (loadedIds.has(font.id)) {
    if (typeof document !== "undefined" && document.fonts) {
      try {
        await Promise.all(
          weights.map((w) => document.fonts.load(`${w} 16px "${family}"`))
        );
      } catch {
        // ignore
      }
    }
    return family;
  }

  if (typeof document === "undefined") return family;

  const linkId = `gf-${font.id}`;
  if (!document.getElementById(linkId)) {
    const link = document.createElement("link");
    link.id = linkId;
    link.rel = "stylesheet";
    // Request only weights that exist — asking for a missing 700 silently fails
    // and makes the Bold toggle look broken.
    link.href = `https://fonts.googleapis.com/css2?family=${fontIdToGoogleFamily(
      font.id
    )}:wght@${weights.join(";")}&display=swap`;
    document.head.appendChild(link);
  }

  if (document.fonts) {
    try {
      // Await every declared weight, then the global ready signal, so Fabric
      // measures glyphs with the real face (not the fallback) before rendering.
      await Promise.all(
        weights.map((w) => document.fonts.load(`${w} 16px "${family}"`))
      );
      await document.fonts.ready;
    } catch {
      // tolerate failures — Fabric will fall back to default
    }
  }

  loadedIds.add(font.id);
  return family;
}

export function fontFamilyFor(id: string): string {
  return fontIdToCssFamily(id);
}
