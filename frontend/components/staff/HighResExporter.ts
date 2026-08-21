import { exportGownCompositePng } from "@/lib/render-gown-composite";
import { saveDataUrl } from "@/lib/download";
import { rasterizePanelCanvas } from "@/lib/render-sash-panel";
import {
  HIGH_RES_PANEL_HEIGHT,
  HIGH_RES_PANEL_WIDTH,
  sashColorToHex,
} from "@/lib/sash-colors";

export interface HighResExportInput {
  leftCanvas: unknown | null;
  rightCanvas: unknown | null;
  sashColor: string | null;
  fontsUsed: string[];
}

async function renderPanelToDataUrl(
  json: unknown | null,
  sashColor: string | null,
  fontsUsed: string[]
): Promise<string | null> {
  // Use the proven rasterizer (awaits fonts + a frame, renders horizontal board at
  // source size then 2D-rotates) — the same path that fixed the on-screen flat panels.
  const out = await rasterizePanelCanvas({
    json,
    sashColor,
    targetWidth: HIGH_RES_PANEL_WIDTH,
    targetHeight: HIGH_RES_PANEL_HEIGHT,
    fontsUsed,
  });
  return out ? out.toDataURL("image/png") : null;
}

export async function buildHighResCombinedDataUrl(
  input: HighResExportInput
): Promise<string> {
  const [leftUrl, rightUrl] = await Promise.all([
    renderPanelToDataUrl(
      input.leftCanvas,
      input.sashColor,
      input.fontsUsed
    ),
    renderPanelToDataUrl(
      input.rightCanvas,
      input.sashColor,
      input.fontsUsed
    ),
  ]);

  if (!leftUrl && !rightUrl) {
    throw new Error("لا يوجد تصميم للتصدير");
  }

  const combinedW = HIGH_RES_PANEL_WIDTH * 2;
  const combinedH = HIGH_RES_PANEL_HEIGHT;
  const off = document.createElement("canvas");
  off.width = combinedW;
  off.height = combinedH;
  const ctx = off.getContext("2d");
  if (!ctx) throw new Error("تعذر إنشاء الصورة");

  ctx.fillStyle = sashColorToHex(input.sashColor);
  ctx.fillRect(0, 0, combinedW, combinedH);

  const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  if (rightUrl) {
    const img = await loadImage(rightUrl);
    ctx.drawImage(img, 0, 0, HIGH_RES_PANEL_WIDTH, HIGH_RES_PANEL_HEIGHT);
  }
  if (leftUrl) {
    const img = await loadImage(leftUrl);
    ctx.drawImage(
      img,
      HIGH_RES_PANEL_WIDTH,
      0,
      HIGH_RES_PANEL_WIDTH,
      HIGH_RES_PANEL_HEIGHT
    );
  }

  return off.toDataURL("image/png");
}

/** Combined unfolded sash — both panels side by side (2880×2400) */
export async function exportHighResCombinedPng(
  input: HighResExportInput,
  filename = "loloshop-sash-300dpi.png"
): Promise<void> {
  const dataUrl = await buildHighResCombinedDataUrl(input);
  await triggerDownload(dataUrl, filename);
}

/** Full gown photo with text/images composited on sash hotspots (2× native res) */
export async function exportHighResGownPng(
  input: HighResExportInput,
  filename = "loloshop-gown.png"
): Promise<void> {
  await exportGownCompositePng(input, filename, 2);
}

export async function exportHighResPanelPng(
  json: unknown | null,
  sashColor: string | null,
  fontsUsed: string[],
  filename: string
): Promise<void> {
  const url = await renderPanelToDataUrl(json, sashColor, fontsUsed);
  if (!url) throw new Error("اللوحة فارغة");
  await triggerDownload(url, filename);
}

/**
 * ⚠️ NOT a bare `<a download>`. iOS ignores the attribute on a `data:` URL (and inside
 * the app's WebView entirely), so the tap navigated to the image — a white page with the
 * board in the corner and no way back to the order. See `lib/download.ts`.
 */
async function triggerDownload(dataUrl: string, filename: string): Promise<void> {
  await saveDataUrl(dataUrl, filename);
}
