"use client";

import dynamic from "next/dynamic";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { getFabric } from "@/lib/fabric-loader";
import { getApiErrorMessage } from "@/lib/api";
import { listFonts, resolveDesignMediaUrl } from "@/lib/designer";
import { SASH_COLOR_HEX, sashHexBase } from "@/lib/designer-colors";
import { boldSupported, fontFamilyFor, loadFont } from "@/lib/fonts-loader";
import {
  ensureDesignFontsLoaded,
  fontIdsFromCanvasJson,
  reflowTextOnPanel,
  serializeHorizontalCanvas,
} from "@/lib/render-sash-panel";
import type { FontDef } from "@/lib/types";
import { DesignerToolsAside } from "./DesignerToolsAside";

const Whiteboard = dynamic(
  () => import("./Whiteboard").then((m) => m.Whiteboard),
  { ssr: false }
);

const CANVAS = { w: 600, h: 360 };

/** Reverse of fontFamilyFor: "Aref Ruqaa" → "aref-ruqaa" */
function familyToId(family?: string): string {
  return (family ?? "").trim().toLowerCase().replace(/\s+/g, "-");
}

async function mergeWhiteboardOntoCanvas(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  canvas: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fabric: any,
  boardJson: unknown,
  fontsUsed: string[],
  usedFonts: Set<string>
) {
  for (const id of fontsUsed) usedFonts.add(id);
  await ensureDesignFontsLoaded(fontIdsFromCanvasJson(boardJson), fontsUsed);

  const objects =
    boardJson && typeof boardJson === "object"
      ? ((boardJson as { objects?: unknown[] }).objects ?? [])
      : [];
  if (!objects.length || !fabric?.util?.enlivenObjects) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enlivened: any[] = await fabric.util.enlivenObjects(objects);
  enlivened.forEach((o) => {
    // Re-apply decoration locks — the isDecoration flag is serialised in JSON
    // but Fabric does not restore custom lock/visibility settings on enliven.
    if (o.isDecoration) {
      o.lockMovementX = true;
      o.lockMovementY = true;
      o.lockRotation = true;
      o.setControlsVisibility?.({ mtr: false });
    }
    canvas.add(o);
  });
  canvas.discardActiveObject();
  canvas.renderAll();
  if (typeof document !== "undefined" && document.fonts?.ready) {
    document.fonts.ready.then(() => {
      enlivened.forEach((o) => o.initDimensions?.());
      canvas.requestRenderAll();
    });
  }
  toast.success("تمت الإضافة — رتّب العناصر على الوشاح");
}

/* Real embroidery-thread colours the student picks for the physical sash. */
const TEXT_COLORS: { hex: string; label: string }[] = [
  { hex: "#1a1a1a", label: "أسود" },
  { hex: "#ffffff", label: "أبيض" },
  { hex: "#c2410c", label: "برتقالي" },
  { hex: "#7a1f2b", label: "عنابي" },
  { hex: "#c9a961", label: "ذهبي" },
  { hex: "#0b1e3f", label: "كحلي" },
];

/* ── Tailoring-table line icons (18px, inherit color) ── */
function Glyph({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  );
}
const IconUndo = (
  <Glyph>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
  </Glyph>
);
const IconRedo = (
  <Glyph>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9a5 5 0 0 0 0 10h1" />
  </Glyph>
);
const IconClose = (
  <Glyph>
    <path d="M18 6 6 18M6 6l12 12" />
  </Glyph>
);
const IconText = (
  <Glyph>
    <path d="M4 7V5h16v2M9 19h6M12 5v14" />
  </Glyph>
);
const IconTrash = (
  <Glyph>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
    <path d="M10 11v6M14 11v6" />
  </Glyph>
);
const IconImage = (
  <Glyph>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.4" />
    <path d="m21 15-5-5L5 21" />
  </Glyph>
);
const IconLogo = (
  <Glyph>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 13s1.5 2 4 2 4-2 4-2" />
  </Glyph>
);

interface Props {
  open: boolean;
  side: "left" | "right";
  initialJson: unknown | null;
  sashColor: string;
  autoOpenText?: boolean;
  logoUrl?: string | null;
  extraImageUrl?: string | null;
  uploadLogo: (file: File) => Promise<string>;
  uploadImage: (file: File) => Promise<string>;
  onLogoChange: (url: string | null) => void;
  onImageChange: (url: string | null) => void;
  onSave: (json: unknown, fontsUsed: string[]) => void;
  onClose: () => void;
}

export function TextEditor({
  open,
  side,
  initialJson,
  sashColor,
  autoOpenText = false,
  logoUrl,
  extraImageUrl,
  uploadLogo,
  uploadImage,
  onLogoChange,
  onImageChange,
  onSave,
  onClose,
}: Props) {
  const titleId = useId();
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricLibRef = useRef<any>(null);
  const logoInputId = useId();
  const imageInputId = useId();
  const pendingWhiteboardRef = useRef<{ json: unknown; fonts: string[] } | null>(null);

  const [ready, setReady] = useState(false);
  const [fonts, setFonts] = useState<FontDef[]>([]);
  const [activeIsText, setActiveIsText] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [activeFontId, setActiveFontId] = useState<string>("");
  const [activeAlign, setActiveAlign] = useState<string>("center");
  const [uploading, setUploading] = useState(false);
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [canvasPopped, setCanvasPopped] = useState(false);
  const usedFontsRef = useRef<Set<string>>(new Set());
  const autoOpenedRef = useRef(false);
  // Undo/redo: snapshots of canvas JSON. restoringRef suppresses recording
  // while we programmatically reload a snapshot.
  const historyRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  const restoringRef = useRef(false);

  const sideLabel =
    side === "left" ? "جانب الاسم" : "جانب الجامعة";

  // Fabric tones for the editing stage so the canvas reads as the chosen sash.
  const sashFabric = SASH_COLOR_HEX[sashColor] || SASH_COLOR_HEX["أبيض"];

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    autoOpenedRef.current = false;
  }, [side, initialJson]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (whiteboardOpen) setWhiteboardOpen(false);
        else onClose();
        return;
      }
      if (whiteboardOpen) return;
      const z = e.key === "z" || e.key === "Z" || e.key === "ي";
      if ((e.ctrlKey || e.metaKey) && z) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, whiteboardOpen, onClose]);

  useEffect(() => {
    if (!open || whiteboardOpen || !canvasElRef.current) return;
    let disposed = false;
    // Pinch-zoom handler references stored for cleanup
    let _touchStart: ((e: TouchEvent) => void) | null = null;
    let _touchMove: ((e: TouchEvent) => void) | null = null;
    let _touchEnd: (() => void) | null = null;
    const _pinchEl = canvasElRef.current;

    (async () => {
      const fabric = await getFabric();
      if (disposed || !canvasElRef.current) return;
      fabricLibRef.current = fabric;

      const isTouch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
      const canvas = new fabric.Canvas(canvasElRef.current, {
        width: CANVAS.w,
        height: CANVAS.h,
        backgroundColor: sashHexBase(sashColor),
        preserveObjectStacking: true,
      });
      // ── Mobile-friendly control handles (cast via any — Fabric v6 types are
      //    incomplete; these properties exist at runtime on fabric.Canvas) ──
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cv = canvas as any;
      cv.cornerSize = isTouch ? 28 : 12;
      cv.touchCornerSize = 26;
      cv.cornerStyle = "circle";
      cv.transparentCorners = false;
      cv.cornerColor = "#f47b42";
      cv.borderColor = "#f47b42";
      fabricRef.current = canvas;

      // Read the live active object (event payload is unreliable for re-selects
      // and multi-select in Fabric v6).
      const syncSelection = () => {
        const obj = canvas.getActiveObject();
        const isText = isTextObject(obj);
        setHasSelection(!!obj);
        setActiveIsText(isText);
        if (isText) {
          setActiveFontId(familyToId(obj?.get?.("fontFamily")));
          setActiveAlign((obj?.get?.("textAlign") as string) || "center");
        }
      };
      canvas.on("selection:created", syncSelection);
      canvas.on("selection:updated", syncSelection);
      canvas.on("selection:cleared", () => {
        setHasSelection(false);
        setActiveIsText(false);
      });

      // ── Pinch-to-zoom (two-finger) for phone tashkeel placement ──
      // Listeners are stored in the outer-scope variables so the cleanup
      // function can remove the exact same references.
      let lastPinchDist = 0;
      _touchStart = (e: TouchEvent) => {
        if (e.touches.length === 2) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          lastPinchDist = Math.hypot(dx, dy);
        }
      };
      _touchMove = (e: TouchEvent) => {
        if (e.touches.length !== 2) return;
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (!lastPinchDist) { lastPinchDist = dist; return; }
        const ratio = dist / lastPinchDist;
        lastPinchDist = dist;
        const currentZoom = canvas.getZoom();
        const next = Math.min(5, Math.max(0.3, currentZoom * ratio));
        // Zoom toward the midpoint between fingers
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = _pinchEl.getBoundingClientRect();
        const point = new fabric.Point(mx - rect.left, my - rect.top);
        canvas.zoomToPoint(point, next);
        canvas.requestRenderAll();
      };
      _touchEnd = () => { lastPinchDist = 0; };
      _pinchEl.addEventListener("touchstart", _touchStart, { passive: true });
      _pinchEl.addEventListener("touchmove", _touchMove, { passive: false });
      _pinchEl.addEventListener("touchend", _touchEnd, { passive: true });

      const history = { stack: [] as string[], index: -1 };
      historyRef.current = history;
      const snapshot = () => {
        if (restoringRef.current) return;
        const json = JSON.stringify(canvas.toJSON());
        history.stack = history.stack.slice(0, history.index + 1);
        history.stack.push(json);
        if (history.stack.length > 50) history.stack.shift();
        history.index = history.stack.length - 1;
        setCanUndo(history.index > 0);
        setCanRedo(false);
      };
      canvas.on("object:added", () => {
        snapshot();
        // Tactile pop: flash the sash stage when a new element is added.
        // Triggers animate-edit-pop for 350ms then clears.
        if (!restoringRef.current) {
          setCanvasPopped(true);
          setTimeout(() => setCanvasPopped(false), 350);
        }
      });
      canvas.on("object:modified", snapshot);
      canvas.on("object:removed", snapshot);

      restoringRef.current = true;
      if (initialJson) {
        try {
          const jsonFontIds = fontIdsFromCanvasJson(initialJson);
          await ensureDesignFontsLoaded(jsonFontIds, []);
          // Seed usedFontsRef so save() emits correct fontsUsed even with no
          // further edits (fixes the "empty fontsUsed on re-save" bug).
          for (const id of jsonFontIds) usedFontsRef.current.add(id);
          await canvas.loadFromJSON(initialJson as Record<string, unknown>);
          canvas.backgroundColor = sashHexBase(sashColor);
          // Fonts are loaded now — re-measure so reopened text isn't laid out
          // with stale fallback metrics (the "text in wrong position" bug).
          reflowTextOnPanel(canvas);
          // Re-apply decoration locks that are not restored by loadFromJSON.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (canvas.getObjects() as any[]).forEach((o: any) => {
            if (o.isDecoration) {
              o.lockMovementX = true;
              o.lockMovementY = true;
              o.lockRotation = true;
              o.setControlsVisibility?.({ mtr: false });
            }
          });
          canvas.renderAll();
        } catch {
          // ignore bad json
        }
      }

      const pending = pendingWhiteboardRef.current;
      if (pending) {
        pendingWhiteboardRef.current = null;
        await mergeWhiteboardOntoCanvas(
          canvas,
          fabric,
          pending.json,
          pending.fonts,
          usedFontsRef.current
        );
      }
      restoringRef.current = false;
      // Baseline snapshot so the first edit is undoable back to the loaded state.
      snapshot();

      setReady(true);
    })();

    return () => {
      disposed = true;
      if (_touchStart) _pinchEl.removeEventListener("touchstart", _touchStart);
      if (_touchMove) _pinchEl.removeEventListener("touchmove", _touchMove);
      if (_touchEnd) _pinchEl.removeEventListener("touchend", _touchEnd);
      try {
        fabricRef.current?.dispose();
      } catch {
        // ignore
      }
      fabricRef.current = null;
      fabricLibRef.current = null;
      setReady(false);
    };
  }, [open, whiteboardOpen, side, initialJson, sashColor]);

  useEffect(() => {
    if (!open || !autoOpenText || initialJson || autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    setWhiteboardOpen(true);
  }, [open, autoOpenText, initialJson]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !ready) return;
    const bg = sashHexBase(sashColor);
    canvas.backgroundColor = bg;
    canvas.renderAll();
  }, [sashColor, ready]);

  useEffect(() => {
    if (!open) return;
    listFonts()
      .then(setFonts)
      .catch(() => toast.error("تعذر تحميل الخطوط"));
  }, [open]);

  // Preload every catalog font in parallel so the picker previews each in its
  // own face. Sequential loading stalled the UI for 8+ Arabic fonts.
  useEffect(() => {
    let cancelled = false;
    Promise.all(fonts.map((f) => loadFont(f).catch(() => {}))).then(() => {
      if (!cancelled) fabricRef.current?.requestRenderAll?.();
    });
    return () => {
      cancelled = true;
    };
  }, [fonts]);

  useEffect(() => {
    if (!ready || whiteboardOpen) return;
    const fit = () => {
      const canvas = fabricRef.current;
      const el = canvasElRef.current;
      const main = mainRef.current;
      if (!canvas || !el || !main || main.clientWidth < 80) return;
      const avail = Math.max(220, main.clientWidth - 16);
      const scale = Math.min(1, avail / CANVAS.w);
      // Keep Fabric coordinates at 600×360; scale display with CSS only
      canvas.setDimensions({ width: CANVAS.w, height: CANVAS.h });
      canvas.setZoom(1);
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      const wrap = el.parentElement;
      if (wrap) {
        wrap.style.width = `${CANVAS.w * scale}px`;
        wrap.style.height = `${CANVAS.h * scale}px`;
        wrap.style.marginInline = "auto";
      }
      el.style.width = "100%";
      el.style.height = "100%";
      canvas.calcOffset?.();
      canvas.requestRenderAll();
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (mainRef.current) ro.observe(mainRef.current);
    return () => ro.disconnect();
  }, [ready, whiteboardOpen, toolsOpen]);

  function isTextObject(obj: { type?: string } | undefined) {
    const t = obj?.type ?? "";
    return t === "i-text" || t === "text" || t === "IText" || t === "Textbox";
  }

  function activeText() {
    const o = fabricRef.current?.getActiveObject();
    return o && isTextObject(o) ? o : null;
  }

  /**
   * Downscale a File's bitmap on an offscreen canvas so that a 10–20MP phone
   * photo is reduced to at most MAX_EDGE pixels before being added to Fabric.
   * Returns a new Blob URL. Call URL.revokeObjectURL() when done.
   */
  async function downscaleImageFile(file: File, maxEdge = 1200): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objUrl);
        const { naturalWidth: w, naturalHeight: h } = img;
        const longest = Math.max(w, h);
        if (longest <= maxEdge) {
          // Already small enough — read as data URL and resolve.
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          c.getContext("2d")!.drawImage(img, 0, 0);
          resolve(c.toDataURL("image/jpeg", 0.85));
          return;
        }
        const scale = maxEdge / longest;
        const nw = Math.round(w * scale);
        const nh = Math.round(h * scale);
        const c = document.createElement("canvas");
        c.width = nw;
        c.height = nh;
        c.getContext("2d")!.drawImage(img, 0, 0, nw, nh);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = objUrl;
    });
  }

  // localSrc: optional pre-downscaled data URL to use on canvas instead of the
  // remote URL (avoids loading a 10MP bitmap into Fabric on low-end Android).
  async function addImage(url: string, localSrc?: string) {
    const canvas = fabricRef.current;
    const fabric = fabricLibRef.current;
    // Fabric v6: FabricImage.fromURL(url, options) → Promise (no callback)
    const ImageClass = fabric?.FabricImage ?? fabric?.Image;
    if (!canvas || !ImageClass?.fromURL) {
      toast.error("تعذر إضافة الصورة");
      return;
    }
    const src = localSrc ?? resolveDesignMediaUrl(url);
    try {
      const image = await ImageClass.fromURL(src, {
        crossOrigin: localSrc ? undefined : "anonymous",
      });
      image.scaleToWidth(140);
      image.set({
        left: CANVAS.w / 2,
        top: CANVAS.h / 2,
        originX: "center",
        originY: "center",
      });
      canvas.add(image);
      canvas.setActiveObject(image);
      canvas.requestRenderAll?.() ?? canvas.renderAll();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر إضافة الصورة"));
    }
  }

  async function pickUpload(e: React.ChangeEvent<HTMLInputElement>, kind: "logo" | "image") {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    // Lowered from 10 MB to 5 MB — phones produce ~8–15 MB JPEGs but we
    // downscale before adding so there's no need to allow large files.
    const maxMB = kind === "logo" ? 3 : 5;
    if (file.size > maxMB * 1024 * 1024) {
      toast.error(`الملف أكبر من ${maxMB} ميجا`);
      return;
    }
    setUploading(true);
    try {
      // Downscale the bitmap to ≤1200px on the longest edge before adding to
      // Fabric — avoids OOM on low-end Android with 10–20MP photos.
      const localSrc = await downscaleImageFile(file);
      const url = await (kind === "logo" ? uploadLogo(file) : uploadImage(file));
      if (kind === "logo") onLogoChange(url);
      else onImageChange(url);
      // Pass the downscaled local data URL for canvas rendering; the remote URL
      // is stored in state for future re-adds after editor re-open.
      await addImage(url, localSrc);
      toast.success("تم الرفع وأُضيف للوشاح");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "فشل الرفع"));
    } finally {
      setUploading(false);
    }
  }

  function applyWhiteboard(boardJson: unknown, fontsUsed: string[]) {
    const objects =
      boardJson && typeof boardJson === "object"
        ? ((boardJson as { objects?: unknown[] }).objects ?? [])
        : [];
    if (!objects.length) {
      toast.error("أضف نصاً أو زخرفة أولاً");
      return;
    }
    pendingWhiteboardRef.current = { json: boardJson, fonts: fontsUsed };
    setWhiteboardOpen(false);
  }

  // Record a manual mutation (set() doesn't fire object:modified on its own).
  function commitChange(target: unknown) {
    fabricRef.current?.fire("object:modified", { target });
  }

  function changeColor(hex: string) {
    const o = activeText();
    if (o) {
      o.set("fill", hex);
      fabricRef.current.renderAll();
      commitChange(o);
    }
  }

  function changeSize(delta: number) {
    const o = activeText();
    if (!o) return;
    const next = Math.max(12, Math.min(200, (o.get("fontSize") || 40) + delta));
    o.set("fontSize", next);
    fabricRef.current.renderAll();
    commitChange(o);
  }

  function toggleBold() {
    const o = activeText();
    if (!o) return;
    o.set("fontWeight", o.get("fontWeight") === "bold" ? "normal" : "bold");
    fabricRef.current.renderAll();
    commitChange(o);
  }

  async function changeFontFamily(id: string) {
    const o = activeText();
    if (!o) return;
    const def = fonts.find((f) => f.id === id);
    if (def) await loadFont(def);
    usedFontsRef.current.add(id);
    o.set("fontFamily", fontFamilyFor(id));
    // Re-measure with the new face so the object box and centering stay correct.
    o.initDimensions?.();
    o.setCoords?.();
    setActiveFontId(id);
    fabricRef.current.requestRenderAll();
    commitChange(o);
  }

  function setAlign(a: "right" | "center" | "left") {
    const o = activeText();
    if (!o) return;
    o.set("textAlign", a);
    o.initDimensions?.();
    fabricRef.current.renderAll();
    setActiveAlign(a);
    commitChange(o);
  }

  function changeLineHeight(delta: number) {
    const o = activeText();
    if (!o) return;
    const current = (o.get("lineHeight") as number) || 1.16;
    const next = Math.max(0.9, Math.min(2.4, Math.round((current + delta) * 100) / 100));
    o.set("lineHeight", next);
    fabricRef.current.renderAll();
    commitChange(o);
  }

  function deleteActive() {
    const canvas = fabricRef.current;
    const o = canvas?.getActiveObject();
    if (!o) return;
    canvas.remove(o);
    canvas.discardActiveObject();
    canvas.renderAll();
  }

  /** Scale the currently-selected object by a multiplier (clamped). */
  function scaleSelected(factor: number) {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj) return;
    const sx = Math.min(10, Math.max(0.05, (obj.scaleX ?? 1) * factor));
    const sy = Math.min(10, Math.max(0.05, (obj.scaleY ?? 1) * factor));
    obj.set({ scaleX: sx, scaleY: sy });
    obj.setCoords?.();
    canvas.requestRenderAll();
    commitChange(obj);
  }

  async function restoreSnapshot(targetIndex: number) {
    const h = historyRef.current;
    const canvas = fabricRef.current;
    if (!canvas || targetIndex < 0 || targetIndex >= h.stack.length) return;
    h.index = targetIndex;
    restoringRef.current = true;
    try {
      await canvas.loadFromJSON(JSON.parse(h.stack[targetIndex]));
      canvas.backgroundColor = sashHexBase(sashColor);
      canvas.discardActiveObject();
      canvas.renderAll();
    } finally {
      restoringRef.current = false;
    }
    setCanUndo(h.index > 0);
    setCanRedo(h.index < h.stack.length - 1);
  }

  function undo() {
    restoreSnapshot(historyRef.current.index - 1);
  }

  function redo() {
    restoreSnapshot(historyRef.current.index + 1);
  }

  function save() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    onSave(serializeHorizontalCanvas(canvas), Array.from(usedFontsRef.current));
  }

  if (!open) return null;

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col bg-cream"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 text-ink">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="hidden h-2 w-2 shrink-0 rounded-full bg-orange-ink sm:block"
            aria-hidden
          />
          <h2 id={titleId} className="font-display-ar truncate text-lg font-semibold text-ink">
            {sideLabel}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          {!whiteboardOpen && (
            <>
              <button
                type="button"
                onClick={undo}
                disabled={!canUndo}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink transition-colors hover:bg-surface-sink disabled:opacity-25"
                aria-label="تراجع"
                title="تراجع (Ctrl+Z)"
              >
                {IconUndo}
              </button>
              <button
                type="button"
                onClick={redo}
                disabled={!canRedo}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink transition-colors hover:bg-surface-sink disabled:opacity-25"
                aria-label="إعادة"
                title="إعادة (Ctrl+Shift+Z)"
              >
                {IconRedo}
              </button>
              <span className="mx-1 h-6 w-px bg-line" aria-hidden />
            </>
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink transition-colors hover:bg-surface-sink"
            aria-label="إغلاق"
          >
            {IconClose}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 sm:flex-row-reverse sm:gap-3">
        {!whiteboardOpen && (
          <main
            ref={mainRef}
            className="flex min-h-[min(48vh,320px)] flex-1 flex-col items-center justify-center gap-4 sm:min-h-0 sm:justify-start"
          >
            <p className="max-w-md px-1 text-center text-sm leading-relaxed text-ink-soft">
              اكتب وزخرِف عبر «إضافة نص»، ثم رتّب العناصر على لوحة الوشاح.
            </p>
            {/* Tailoring-table stage: the canvas rests inside a real sash of the
                chosen fabric color — selvedge, stitch line, weave + hem tail. */}
            <div className="flex w-full flex-col items-center rounded-2xl bg-[var(--shop-sink)] p-4 sm:p-6">
              <div
                className={`sash-stage ${canvasPopped ? "animate-edit-pop" : ""}`}
                style={
                  {
                    "--sash-fabric-light": sashFabric.light,
                    "--sash-fabric-base": sashFabric.base,
                    "--sash-fabric-dark": sashFabric.dark,
                  } as React.CSSProperties
                }
              >
                <div className="relative touch-none">
                  {!ready && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center">
                      <Spinner />
                    </div>
                  )}
                  <canvas
                    ref={canvasElRef}
                    aria-label={`لوحة تصميم — ${sideLabel}`}
                    className="mx-auto block"
                  />
                </div>
              </div>
              <p className="mt-3 text-center text-xs text-[var(--shop-muted)]">
                اسحب أي عنصر · الزوايا للتكبير والتدوير
              </p>
            </div>
          </main>
        )}

        {!whiteboardOpen && (
          <DesignerToolsAside
            open={toolsOpen}
            onToggle={() => setToolsOpen((v) => !v)}
            panelId="text-editor-tools"
          >
            <Button
              variant="primary"
              fullWidth
              onClick={() => setWhiteboardOpen(true)}
            >
              <span className="inline-flex items-center gap-2">
                {IconText} إضافة نص أو زخرفة
              </span>
            </Button>

            {/* Logo & extra images */}
            <details className="rounded-xl border border-line bg-beige p-3">
              <summary className="cursor-pointer select-none text-sm font-semibold text-ink">
                شعار وصور إضافية
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label
                  htmlFor={logoInputId}
                  className={`inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-[var(--shop-sink)] ${uploading ? "pointer-events-none opacity-50" : ""}`}
                >
                  {uploading ? <Spinner /> : <>{IconLogo} شعار</>}
                </label>
                <label
                  htmlFor={imageInputId}
                  className={`inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-[var(--shop-sink)] ${uploading ? "pointer-events-none opacity-50" : ""}`}
                >
                  {uploading ? <Spinner /> : <>{IconImage} صورة</>}
                </label>
              </div>
              {logoUrl && (
                <Button variant="ghost" fullWidth className="mt-2" onClick={() => addImage(logoUrl)}>
                  إعادة إضافة الشعار
                </Button>
              )}
              {extraImageUrl && (
                <Button
                  variant="ghost"
                  fullWidth
                  className="mt-2"
                  onClick={() => addImage(extraImageUrl)}
                >
                  إعادة إضافة الصورة
                </Button>
              )}
            </details>

            {/* Selected element — the instrument tray */}
            <div className="rounded-xl border border-line bg-beige p-4">
              <p className="mb-3 text-sm font-semibold text-ink">العنصر المحدد</p>

              {/* Font picker — change the selected text's face in place */}
              <p className="mb-2 text-xs font-medium text-[var(--shop-muted)]">الخط</p>
              <div className="mb-4 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                {fonts.length === 0 ? (
                  <span className="text-xs text-[var(--shop-muted)]">جاري التحميل…</span>
                ) : (
                  fonts.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => changeFontFamily(f.id)}
                      disabled={!activeIsText}
                      aria-pressed={activeFontId === f.id}
                      style={{ fontFamily: fontFamilyFor(f.id) }}
                      className={`shrink-0 min-h-11 rounded-lg border px-3 py-2 text-lg leading-none transition-colors disabled:opacity-30 ${
                        activeFontId === f.id
                          ? "border-orange-ink bg-orange-ink/8 ring-1 ring-orange-ink text-ink"
                          : "border-line bg-cream text-ink hover:border-neutral-dark"
                      }`}
                    >
                      {f.name_ar}
                    </button>
                  ))
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="inline-flex items-center rounded-full border border-line bg-cream"
                  role="group"
                  aria-label="حجم النص"
                >
                  <button
                    type="button"
                    onClick={() => changeSize(-6)}
                    disabled={!activeIsText}
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-[var(--shop-sink)] disabled:opacity-30"
                    aria-label="تصغير الحجم"
                  >
                    <Glyph>
                      <path d="M5 12h14" />
                    </Glyph>
                  </button>
                  <span className="px-1 text-xs font-medium text-[var(--shop-muted)]">
                    الحجم
                  </span>
                  <button
                    type="button"
                    onClick={() => changeSize(6)}
                    disabled={!activeIsText}
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-[var(--shop-sink)] disabled:opacity-30"
                    aria-label="تكبير الحجم"
                  >
                    <Glyph>
                      <path d="M12 5v14M5 12h14" />
                    </Glyph>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={toggleBold}
                  disabled={!activeIsText || !boldSupported(activeFontId)}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line bg-cream font-display text-base font-bold text-ink transition-colors hover:bg-[var(--shop-sink)] disabled:opacity-30"
                  aria-label="غامق"
                  title={
                    activeIsText && !boldSupported(activeFontId)
                      ? "هذا الخط لا يدعم الغامق"
                      : "غامق"
                  }
                >
                  B
                </button>
                <button
                  type="button"
                  onClick={deleteActive}
                  disabled={!hasSelection}
                  className="ms-auto inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm font-medium text-ink-soft transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:opacity-30"
                >
                  {IconTrash} حذف
                </button>
              </div>

              {/* Scale control — works for ALL object types (text, image,
                  decoration). Shown when anything is selected. */}
              <div
                className={`mt-3 flex items-center gap-2 transition-opacity ${hasSelection ? "opacity-100" : "pointer-events-none opacity-30"}`}
                dir="rtl"
              >
                <div
                  className="inline-flex items-center rounded-full border border-line bg-cream"
                  role="group"
                  aria-label="حجم العنصر"
                >
                  <button
                    type="button"
                    onClick={() => scaleSelected(0.9)}
                    disabled={!hasSelection}
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-[var(--shop-sink)] disabled:opacity-30"
                    aria-label="تصغير العنصر"
                    title="تصغير العنصر"
                  >
                    <Glyph>
                      <path d="M5 12h14" />
                    </Glyph>
                  </button>
                  <span className="px-1 text-xs font-medium text-[var(--shop-muted)]">الحجم الكلي</span>
                  <button
                    type="button"
                    onClick={() => scaleSelected(1.1)}
                    disabled={!hasSelection}
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-[var(--shop-sink)] disabled:opacity-30"
                    aria-label="تكبير العنصر"
                    title="تكبير العنصر"
                  >
                    <Glyph>
                      <path d="M12 5v14M5 12h14" />
                    </Glyph>
                  </button>
                </div>
              </div>

              {/* Alignment + line spacing — essential for multi-line Arabic */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div
                  className="inline-flex items-center rounded-full border border-line bg-cream"
                  role="group"
                  aria-label="محاذاة النص"
                >
                  {([
                    { a: "right", label: "محاذاة لليمين", d: "M4 6h16M4 12h10M4 18h13" },
                    { a: "center", label: "توسيط", d: "M4 6h16M7 12h10M5 18h14" },
                    { a: "left", label: "محاذاة لليسار", d: "M4 6h16M10 12h10M7 18h13" },
                  ] as const).map((it) => (
                    <button
                      key={it.a}
                      type="button"
                      onClick={() => setAlign(it.a)}
                      disabled={!activeIsText}
                      aria-pressed={activeAlign === it.a}
                      aria-label={it.label}
                      title={it.label}
                      className={`flex min-h-11 min-w-11 items-center justify-center rounded-full transition-colors disabled:opacity-30 ${
                        activeAlign === it.a ? "bg-surface-sink text-orange-ink" : "text-ink hover:bg-[var(--shop-sink)]"
                      }`}
                    >
                      <Glyph>
                        <path d={it.d} />
                      </Glyph>
                    </button>
                  ))}
                </div>
                <div
                  className="inline-flex items-center rounded-full border border-line bg-cream"
                  role="group"
                  aria-label="تباعد الأسطر"
                >
                  <button
                    type="button"
                    onClick={() => changeLineHeight(-0.1)}
                    disabled={!activeIsText}
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-[var(--shop-sink)] disabled:opacity-30"
                    aria-label="تقليل تباعد الأسطر"
                  >
                    <Glyph>
                      <path d="M5 12h14" />
                    </Glyph>
                  </button>
                  <span className="px-1 text-xs font-medium text-[var(--shop-muted)]">الأسطر</span>
                  <button
                    type="button"
                    onClick={() => changeLineHeight(0.1)}
                    disabled={!activeIsText}
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-[var(--shop-sink)] disabled:opacity-30"
                    aria-label="زيادة تباعد الأسطر"
                  >
                    <Glyph>
                      <path d="M12 5v14M5 12h14" />
                    </Glyph>
                  </button>
                </div>
              </div>

              <p className="mb-2 mt-4 text-xs font-medium text-[var(--shop-muted)]">
                لون النص
              </p>
              <div className="flex flex-wrap gap-2.5">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => changeColor(c.hex)}
                    disabled={!activeIsText}
                    className="h-11 w-11 rounded-full ring-1 ring-ink/15 transition-transform hover:scale-110 disabled:opacity-40 disabled:hover:scale-100"
                    style={{ background: c.hex }}
                    aria-label={c.label}
                    title={c.label}
                  />
                ))}
              </div>
            </div>
          </DesignerToolsAside>
        )}
      </div>

      <footer className="flex gap-2 border-t border-line bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button variant="ghost" fullWidth onClick={onClose}>
          إلغاء
        </Button>
        <Button variant="primary" fullWidth onClick={save} disabled={!ready || whiteboardOpen}>
          حفظ الجانب
        </Button>
      </footer>

      <input
        id={logoInputId}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="sr-only"
        onChange={(e) => pickUpload(e, "logo")}
      />
      <input
        id={imageInputId}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(e) => pickUpload(e, "image")}
      />

      {whiteboardOpen && (
        <Whiteboard
          key={side}
          side={side}
          sashColor={sashColor}
          fonts={fonts}
          onApply={applyWhiteboard}
          onClose={() => setWhiteboardOpen(false)}
        />
      )}
    </div>
  );
}
