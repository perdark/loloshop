import { getFabric } from "@/lib/fabric-loader";
import { exportGownCompositePng } from "@/lib/render-gown-composite";
import { loadPanelOntoCanvas } from "@/lib/render-sash-panel";
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
  if (!json) return null;

  const fabric = await getFabric();
  const el = document.createElement("canvas");
  const canvas = new fabric.StaticCanvas(el, {
    width: HIGH_RES_PANEL_WIDTH,
    height: HIGH_RES_PANEL_HEIGHT,
    backgroundColor: sashColorToHex(sashColor),
  });

  await loadPanelOntoCanvas(canvas, {
    json,
    sashColor,
    targetWidth: HIGH_RES_PANEL_WIDTH,
    targetHeight: HIGH_RES_PANEL_HEIGHT,
    fontsUsed,
  });

  const url = canvas.toDataURL({
    format: "png",
    multiplier: 1,
    enableRetinaScaling: false,
  });

  canvas.dispose();
  return url;
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
  triggerDownload(dataUrl, filename);
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
  triggerDownload(url, filename);
}

function triggerDownload(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
