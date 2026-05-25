import { listFonts } from "@/lib/designer";
import { loadFont } from "@/lib/fonts-loader";
import {
  DESIGN_PANEL_WIDTH,
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

async function ensureFontsLoaded(fontIds: string[]): Promise<void> {
  if (!fontIds.length) return;
  try {
    const catalog = await listFonts();
    const byId = new Map(catalog.map((f) => [f.id, f]));
    await Promise.all(
      fontIds.map((id) => {
        const def = byId.get(id);
        return def ? loadFont(def) : Promise.resolve();
      })
    );
  } catch {
    // mock / offline — fonts may already be in page from Google links
  }
  if (typeof document !== "undefined" && document.fonts) {
    await document.fonts.ready;
  }
}

async function renderPanelToDataUrl(
  json: unknown | null,
  sashColor: string | null,
  fontsUsed: string[]
): Promise<string | null> {
  if (!json) return null;

  const fabric = await import("fabric");
  await ensureFontsLoaded(fontsUsed);

  const el = document.createElement("canvas");
  const canvas = new fabric.StaticCanvas(el, {
    width: HIGH_RES_PANEL_WIDTH,
    height: HIGH_RES_PANEL_HEIGHT,
    backgroundColor: sashColorToHex(sashColor),
  });

  await canvas.loadFromJSON(json as Record<string, unknown>);
  const scale = HIGH_RES_PANEL_WIDTH / DESIGN_PANEL_WIDTH;
  canvas.setZoom(scale);
  canvas.backgroundColor = sashColorToHex(sashColor);
  canvas.renderAll();

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
