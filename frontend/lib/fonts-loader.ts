// Helper: load a Google Font CSS link once, then wait for the font to be ready
// for Fabric.js to render with it.

import type { FontDef } from "./types";

const loadedIds = new Set<string>();

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

export async function loadFont(font: FontDef): Promise<string> {
  const family = fontIdToCssFamily(font.id);
  if (loadedIds.has(font.id)) {
    if (typeof document !== "undefined" && document.fonts) {
      try {
        await document.fonts.load(`16px "${family}"`);
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
    link.href = `https://fonts.googleapis.com/css2?family=${fontIdToGoogleFamily(
      font.id
    )}:wght@400;700&display=swap`;
    document.head.appendChild(link);
  }

  if (document.fonts) {
    try {
      await document.fonts.load(`16px "${family}"`);
      await document.fonts.load(`bold 16px "${family}"`);
    } catch {
      // tolerate failures — Fabric will fall back to default
    }
  }

  loadedIds.add(font.id);
  return family;
}

export function fontFamilyFor(id: string): string {
  return id
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}
