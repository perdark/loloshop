/**
 * Composite left/right Fabric panels onto gown-sash.png for staff export
 * and any server-free high-res gown PNG.
 */

import {
  GOWN_IMAGE_SRC,
  GOWN_NATIVE_HEIGHT,
  GOWN_NATIVE_WIDTH,
  type GownSide,
  hotspotPixelRect,
} from "@/lib/gown-hotspots";
import { panelHasContent, rasterizePanelCanvas } from "@/lib/render-sash-panel";
import { saveDataUrl } from "@/lib/download";

export type GownCompositeInput = {
  leftCanvas: unknown | null;
  rightCanvas: unknown | null;
  sashColor: string | null;
  fontsUsed?: string[];
  /** Multiplier on native gown size (2 = ~2804×2244) */
  scale?: number;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Canvas clip matching SASH_CLIP_PATH (tapered bottom) */
function applySashClip(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
): void {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, h * 0.88);
  ctx.lineTo(w * 0.5, h);
  ctx.lineTo(0, h * 0.88);
  ctx.closePath();
  ctx.clip();
}

async function renderSideToClippedCanvas(
  json: unknown | null,
  sashColor: string | null,
  fontsUsed: string[],
  panelW: number,
  panelH: number
): Promise<HTMLCanvasElement | null> {
  if (!panelHasContent(json) || panelW < 1 || panelH < 1) return null;

  const panel = await rasterizePanelCanvas({
    json,
    sashColor,
    targetWidth: panelW,
    targetHeight: panelH,
    fontsUsed,
    transparentBg: true,
  });
  if (!panel) return null;

  const clipped = document.createElement("canvas");
  clipped.width = panelW;
  clipped.height = panelH;
  const ctx = clipped.getContext("2d");
  if (!ctx) return null;
  applySashClip(ctx, panelW, panelH);
  ctx.drawImage(panel, 0, 0);
  return clipped;
}

export async function buildGownCompositeDataUrl(
  input: GownCompositeInput
): Promise<string> {
  const scale = input.scale ?? 1;
  const gownW = Math.round(GOWN_NATIVE_WIDTH * scale);
  const gownH = Math.round(GOWN_NATIVE_HEIGHT * scale);
  const sashColor = input.sashColor ?? "أبيض";
  const fontsUsed = input.fontsUsed ?? [];

  const gownImg = await loadImage(GOWN_IMAGE_SRC);
  const off = document.createElement("canvas");
  off.width = gownW;
  off.height = gownH;
  const ctx = off.getContext("2d");
  if (!ctx) throw new Error("تعذر إنشاء الصورة");

  ctx.drawImage(gownImg, 0, 0, gownW, gownH);

  const sides: GownSide[] = ["left", "right"];
  for (const side of sides) {
    const json = side === "left" ? input.leftCanvas : input.rightCanvas;
    const rect = hotspotPixelRect(gownW, gownH, side);
    const overlay = await renderSideToClippedCanvas(
      json,
      sashColor,
      fontsUsed,
      rect.width,
      rect.height
    );
    if (overlay) {
      ctx.drawImage(overlay, rect.left, rect.top);
    }
  }

  return off.toDataURL("image/png");
}

/**
 * ⚠️ Goes through `saveDataUrl`, not a bare `<a download>`. A 300-dpi board is a huge
 * `data:` URL, and iOS honours `download` on neither a data URL nor anything inside the
 * app's WebView — the tap NAVIGATED to the image, which is the «صفحة نصف فارغة وفيها
 * صورة» the staff iPad reported on 2026-08-21. See `lib/download.ts`.
 */
export async function exportGownCompositePng(
  input: GownCompositeInput,
  filename: string,
  scale = 2
): Promise<void> {
  const dataUrl = await buildGownCompositeDataUrl({ ...input, scale });
  await saveDataUrl(dataUrl, filename);
}
