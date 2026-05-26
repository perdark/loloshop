/**
 * Single source of truth: map horizontal editor JSON (600×360) onto a target
 * canvas (preview, staff viewer, high-res export) with optional rotation.
 */

import { listFonts } from "@/lib/designer";
import { getFabric } from "@/lib/fabric-loader";
import { sashHexBase, type CanvasSideJson } from "@/lib/designer-colors";
import { loadFont } from "@/lib/fonts-loader";
import {
  EDITOR_CANVAS_HEIGHT,
  EDITOR_CANVAS_WIDTH,
  sashColorToHex,
} from "@/lib/sash-colors";

export function parseSideJson(json: unknown | null): CanvasSideJson {
  return (json ?? {}) as CanvasSideJson;
}

export function sideSourceSize(data: CanvasSideJson): { w: number; h: number } {
  return {
    w: data.sourceWidth ?? EDITOR_CANVAS_WIDTH,
    h: data.sourceHeight ?? EDITOR_CANVAS_HEIGHT,
  };
}

export function isHorizontalBoard(data: CanvasSideJson): boolean {
  return (data.orientation ?? "horizontal") === "horizontal";
}

/** Scale one Fabric object tree from display-sized canvas → 600×360 design space */
function scaleFabricObject(
  obj: Record<string, unknown>,
  sx: number,
  sy: number
): Record<string, unknown> {
  const next = { ...obj };
  const mul = (key: string, factor: number) => {
    const v = next[key];
    if (typeof v === "number") next[key] = v * factor;
  };
  mul("left", sx);
  mul("top", sy);
  mul("scaleX", sx);
  mul("scaleY", sy);
  mul("fontSize", (sx + sy) / 2);
  mul("width", sx);
  mul("height", sy);
  if (Array.isArray(next.objects)) {
    next.objects = (next.objects as Record<string, unknown>[]).map((child) =>
      scaleFabricObject(child, sx, sy)
    );
  }
  return next;
}

/**
 * Export editor canvas JSON in canonical 600×360 coordinates.
 * The TextEditor shrinks the canvas with setDimensions/setZoom on mobile; without
 * this, gown preview and print export place objects off the sash.
 */
export function panelHasContent(json: unknown | null): boolean {
  if (!json || typeof json !== "object") return false;
  const objects = (json as { objects?: unknown[] }).objects;
  return Array.isArray(objects) && objects.length > 0;
}

export function serializeHorizontalCanvas(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  canvas: any
): Record<string, unknown> {
  const displayW = canvas.getWidth?.() ?? EDITOR_CANVAS_WIDTH;
  const displayH = canvas.getHeight?.() ?? EDITOR_CANVAS_HEIGHT;
  const sx = EDITOR_CANVAS_WIDTH / displayW;
  const sy = EDITOR_CANVAS_HEIGHT / displayH;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawObjects = (canvas.getObjects?.() ?? []) as any[];
  const objects = rawObjects
    .filter((o) => !o.excludeFromExport)
    .map((o) => o.toObject?.() ?? o);
  const needsScale = Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001;
  const normalized = needsScale
    ? objects.map((obj) =>
        scaleFabricObject(obj as Record<string, unknown>, sx, sy)
      )
    : objects;

  return {
    version: "6.0.0",
    objects: normalized,
    orientation: "horizontal",
    sourceWidth: EDITOR_CANVAS_WIDTH,
    sourceHeight: EDITOR_CANVAS_HEIGHT,
  };
}

/** Re-measure text after fonts load (required for Fabric v6 IText on panel canvases) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function reflowTextOnPanel(canvas: any): void {
  for (const obj of canvas.getObjects?.() ?? []) {
    const t = obj?.type ?? "";
    if (t === "i-text" || t === "IText" || t === "text" || t === "Textbox") {
      obj.initDimensions?.();
      obj.setCoords?.();
    }
  }
}

/** Strip viewport/zoom from saved JSON before loading onto a panel canvas */
export function panelJsonForLoad(
  json: unknown | null
): Record<string, unknown> | null {
  if (!json || typeof json !== "object") return null;
  const raw = { ...(json as Record<string, unknown>) };
  delete raw.viewportTransform;
  delete raw.zoom;
  delete raw.width;
  delete raw.height;
  if (!Array.isArray(raw.objects)) raw.objects = [];
  return raw;
}

/** Collect font ids from Fabric JSON objects */
export function fontIdsFromCanvasJson(json: unknown | null): string[] {
  if (!json || typeof json !== "object") return [];
  const root = json as { objects?: unknown[] };
  const ids = new Set<string>();
  for (const obj of root.objects ?? []) {
    if (!obj || typeof obj !== "object") continue;
    const ff = (obj as { fontFamily?: string }).fontFamily;
    if (!ff || typeof ff !== "string") continue;
    const id = ff
      .trim()
      .split(/\s+/)[0]
      .replace(/['"]/g, "")
      .toLowerCase()
      .replace(/\s+/g, "-");
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

export async function ensureDesignFontsLoaded(
  fontIds: string[],
  extraIds: string[] = []
): Promise<void> {
  const all = Array.from(new Set([...fontIds, ...extraIds]));
  if (!all.length) return;
  try {
    const catalog = await listFonts();
    const byId = new Map(catalog.map((f) => [f.id, f]));
    await Promise.all(
      all.map((id) => {
        const def = byId.get(id);
        return def ? loadFont(def) : Promise.resolve();
      })
    );
  } catch {
    // offline / mock
  }
  if (typeof document !== "undefined" && document.fonts) {
    await document.fonts.ready;
  }
}

/** Fabric viewport matrix for horizontal editor JSON → vertical panel size */
export function horizontalPanelViewportMatrix(
  json: unknown | null,
  targetWidth: number,
  targetHeight: number
): [number, number, number, number, number, number] | null {
  const data = parseSideJson(json);
  if (!isHorizontalBoard(data)) return null;
  const { w: srcW, h: srcH } = sideSourceSize(data);
  const s = Math.min(targetWidth / srcH, targetHeight / srcW);
  const e = (targetWidth + s * srcH) / 2;
  const f = (targetHeight - s * srcW) / 2;
  return [0, s, -s, 0, e, f];
}

/** Apply viewport after loadFromJSON — horizontal editor → vertical (or custom) target */
export function applyPanelViewport(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  canvas: any,
  json: unknown | null,
  targetWidth: number,
  targetHeight: number
): void {
  const data = parseSideJson(json);
  const { w: srcW, h: srcH } = sideSourceSize(data);

  const matrix = horizontalPanelViewportMatrix(json, targetWidth, targetHeight);
  if (matrix) {
    canvas.setViewportTransform(matrix);
  } else {
    canvas.setZoom(targetWidth / srcW);
  }
}

export type PanelRenderOptions = {
  json: unknown | null;
  sashColor: string | null;
  targetWidth: number;
  targetHeight: number;
  fontsUsed?: string[];
  transparentBg?: boolean;
};

/**
 * Load JSON onto an existing Fabric StaticCanvas (or Canvas) and apply viewport.
 */
export async function loadPanelOntoCanvas(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  canvas: any,
  opts: PanelRenderOptions
): Promise<void> {
  const {
    json,
    sashColor,
    targetWidth,
    targetHeight,
    fontsUsed = [],
    transparentBg = false,
  } = opts;

  const bg = transparentBg ? null : sashHexBase(sashColor ?? "أبيض");

  if (json) {
    const payload = panelJsonForLoad(json);
    if (!payload) return;
    const fromJson = fontIdsFromCanvasJson(payload);
    await ensureDesignFontsLoaded(fromJson, fontsUsed);
    await canvas.loadFromJSON(payload);
    applyPanelViewport(canvas, json, targetWidth, targetHeight);
    reflowTextOnPanel(canvas);
  }

  canvas.backgroundColor = bg;
  canvas.requestRenderAll?.() ?? canvas.renderAll();
}

/**
 * Rasterize panel JSON to a canvas element.
 * Horizontal boards render at source size, then rotate via 2D (reliable for gown PNG overlays).
 */
export async function rasterizePanelCanvas(
  opts: PanelRenderOptions
): Promise<HTMLCanvasElement | null> {
  if (!panelHasContent(opts.json)) return null;

  const data = parseSideJson(opts.json);
  const { w: srcW, h: srcH } = sideSourceSize(data);
  const targetW = opts.targetWidth;
  const targetH = opts.targetHeight;
  const payload = panelJsonForLoad(opts.json);
  if (!payload) return null;

  const fabric = await getFabric();
  const horizEl = document.createElement("canvas");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const horizCanvas: any = new fabric.StaticCanvas(horizEl, {
    width: srcW,
    height: srcH,
  });

  try {
    await ensureDesignFontsLoaded(
      fontIdsFromCanvasJson(payload),
      opts.fontsUsed ?? []
    );
    await horizCanvas.loadFromJSON(payload);
    horizCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    horizCanvas.setZoom(1);
    horizCanvas.backgroundColor = opts.transparentBg
      ? null
      : sashHexBase(opts.sashColor ?? "أبيض");
    reflowTextOnPanel(horizCanvas);
    horizCanvas.requestRenderAll?.() ?? horizCanvas.renderAll();

    if (typeof document !== "undefined" && document.fonts) {
      await document.fonts.ready;
    }
    reflowTextOnPanel(horizCanvas);
    horizCanvas.requestRenderAll?.() ?? horizCanvas.renderAll();
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    const source = horizCanvas.lowerCanvasEl as HTMLCanvasElement | undefined;
    if (!source) return null;

    const out = document.createElement("canvas");
    out.width = targetW;
    out.height = targetH;
    const ctx = out.getContext("2d");
    if (!ctx) return null;

    const matrix = horizontalPanelViewportMatrix(opts.json, targetW, targetH);
    if (matrix) {
      const [a, b, c, d, e, f] = matrix;
      ctx.setTransform(a, b, c, d, e, f);
      ctx.drawImage(source, 0, 0, srcW, srcH);
    } else {
      ctx.drawImage(source, 0, 0, targetW, targetH);
    }

    return out;
  } finally {
    horizCanvas.dispose();
  }
}

/** Render a sash panel to a PNG data URL (used for gown hotspot previews) */
export async function renderPanelToDataUrl(
  opts: PanelRenderOptions
): Promise<string | null> {
  const out = await rasterizePanelCanvas(opts);
  return out?.toDataURL("image/png") ?? null;
}

export function panelBackgroundHex(
  sashColor: string | null,
  transparentBg: boolean
): string {
  if (transparentBg) return "";
  return sashColorToHex(sashColor);
}
