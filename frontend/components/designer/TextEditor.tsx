"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { getFabric } from "@/lib/fabric-loader";
import { getApiErrorMessage } from "@/lib/api";
import { listFonts, resolveDesignMediaUrl } from "@/lib/designer";
import { sashHexBase } from "@/lib/designer-colors";
import {
  ensureDesignFontsLoaded,
  fontIdsFromCanvasJson,
  serializeHorizontalCanvas,
} from "@/lib/render-sash-panel";
import type { FontDef } from "@/lib/types";
import { DesignerToolsAside } from "./DesignerToolsAside";

const Whiteboard = dynamic(
  () => import("./Whiteboard").then((m) => m.Whiteboard),
  { ssr: false }
);

const CANVAS = { w: 600, h: 360 };

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
  enlivened.forEach((o) => canvas.add(o));
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

const TEXT_COLORS: { hex: string; label: string }[] = [
  { hex: "#1a1a1a", label: "أسود" },
  { hex: "#ff8c00", label: "برتقالي" },
  { hex: "#7a1f2b", label: "عنابي" },
  { hex: "#ffffff", label: "أبيض" },
  { hex: "#c9a961", label: "ذهبي" },
  { hex: "#0b1e3f", label: "كحلي" },
];

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
  const [uploading, setUploading] = useState(false);
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const usedFontsRef = useRef<Set<string>>(new Set());
  const autoOpenedRef = useRef(false);
  // Undo/redo: snapshots of canvas JSON. restoringRef suppresses recording
  // while we programmatically reload a snapshot.
  const historyRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  const restoringRef = useRef(false);

  const sideLabel =
    side === "left" ? "جانب الاسم (اليسار)" : "جانب الجامعة (اليمين)";

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

    (async () => {
      const fabric = await getFabric();
      if (disposed || !canvasElRef.current) return;
      fabricLibRef.current = fabric;

      const canvas = new fabric.Canvas(canvasElRef.current, {
        width: CANVAS.w,
        height: CANVAS.h,
        backgroundColor: sashHexBase(sashColor),
        preserveObjectStacking: true,
      });
      fabricRef.current = canvas;

      const onSel = (e: { selected?: { type?: string }[] }) => {
        const obj = e.selected?.[0];
        const t = obj?.type ?? "";
        setHasSelection(!!obj);
        setActiveIsText(
          t === "i-text" || t === "text" || t === "IText" || t === "Textbox"
        );
      };
      canvas.on("selection:created", onSel);
      canvas.on("selection:updated", onSel);
      canvas.on("selection:cleared", () => {
        setHasSelection(false);
        setActiveIsText(false);
      });

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
      canvas.on("object:added", snapshot);
      canvas.on("object:modified", snapshot);
      canvas.on("object:removed", snapshot);

      restoringRef.current = true;
      if (initialJson) {
        try {
          await ensureDesignFontsLoaded(fontIdsFromCanvasJson(initialJson), []);
          await canvas.loadFromJSON(initialJson as Record<string, unknown>);
          canvas.backgroundColor = sashHexBase(sashColor);
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

  useEffect(() => {
    if (!ready || whiteboardOpen) return;
    const fit = () => {
      const canvas = fabricRef.current;
      const el = canvasElRef.current;
      const main = mainRef.current;
      if (!canvas || !el || !main || main.clientWidth < 80) return;
      const avail = Math.max(220, main.clientWidth - 16);
      const scale = Math.min(1, avail / CANVAS.w);
      // Scale both Fabric dimensions AND zoom so touch coordinates map correctly on mobile
      canvas.setDimensions({ width: CANVAS.w * scale, height: CANVAS.h * scale });
      canvas.setZoom(scale);
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

  async function addImage(url: string) {
    const canvas = fabricRef.current;
    const fabric = fabricLibRef.current;
    // Fabric v6: FabricImage.fromURL(url, options) → Promise (no callback)
    const ImageClass = fabric?.FabricImage ?? fabric?.Image;
    if (!canvas || !ImageClass?.fromURL) {
      toast.error("تعذر إضافة الصورة");
      return;
    }
    const src = resolveDesignMediaUrl(url);
    try {
      const image = await ImageClass.fromURL(src, {
        crossOrigin: "anonymous",
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
    const maxMB = kind === "logo" ? 5 : 10;
    if (file.size > maxMB * 1024 * 1024) {
      toast.error(`الملف أكبر من ${maxMB} ميجا`);
      return;
    }
    setUploading(true);
    try {
      const url = await (kind === "logo" ? uploadLogo(file) : uploadImage(file));
      if (kind === "logo") onLogoChange(url);
      else onImageChange(url);
      await addImage(url);
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

  function deleteActive() {
    const canvas = fabricRef.current;
    const o = canvas?.getActiveObject();
    if (!o) return;
    canvas.remove(o);
    canvas.discardActiveObject();
    canvas.renderAll();
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
      <header className="flex items-center justify-between border-b border-ink/10 bg-ink px-4 py-3 text-cream">
        <h2 id={titleId} className="font-display text-lg">
          تصميم {sideLabel}
        </h2>
        <div className="flex items-center gap-1">
          {!whiteboardOpen && (
            <>
              <button
                type="button"
                onClick={undo}
                disabled={!canUndo}
                className="flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-cream/10 disabled:opacity-30"
                aria-label="تراجع"
                title="تراجع (Ctrl+Z)"
              >
                ↶
              </button>
              <button
                type="button"
                onClick={redo}
                disabled={!canRedo}
                className="flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-cream/10 disabled:opacity-30"
                aria-label="إعادة"
                title="إعادة (Ctrl+Shift+Z)"
              >
                ↷
              </button>
            </>
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-cream/10"
            aria-label="إغلاق"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 sm:flex-row-reverse sm:gap-3">
        {!whiteboardOpen && (
          <main
            ref={mainRef}
            className="flex min-h-[min(44vh,280px)] flex-1 flex-col gap-2 sm:min-h-0"
          >
            <div className="relative w-full touch-none">
              {!ready && (
                <div className="absolute inset-0 z-10 flex items-center justify-center">
                  <Spinner />
                </div>
              )}
              <canvas
                ref={canvasElRef}
                aria-label={`لوحة تصميم — ${sideLabel}`}
                className="mx-auto rounded-md shadow-lg ring-1 ring-ink/10"
              />
              <p className="mt-1 text-center text-xs text-ink/50">
                اسحب أي عنصر • الزوايا للتكبير والتدوير
              </p>
            </div>

            {hasSelection && (
              <div className="rounded-xl border border-orange/20 bg-cream p-2 shadow-sm">
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => changeSize(-6)}
                    disabled={!activeIsText}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-ink/20 text-lg font-bold text-ink disabled:opacity-30"
                    aria-label="تصغير الخط"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => changeSize(6)}
                    disabled={!activeIsText}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-ink/20 text-lg font-bold text-ink disabled:opacity-30"
                    aria-label="تكبير الخط"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={toggleBold}
                    disabled={!activeIsText}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-ink/20 font-bold text-ink disabled:opacity-30"
                    aria-label="عريض"
                  >
                    B
                  </button>
                  <button
                    type="button"
                    onClick={deleteActive}
                    className="flex h-10 items-center justify-center rounded-lg bg-red-100 px-3 text-sm font-semibold text-red-700"
                    aria-label="حذف العنصر"
                  >
                    حذف
                  </button>
                </div>
                {activeIsText && (
                  <div className="mt-2 flex justify-center gap-2">
                    {TEXT_COLORS.map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        onClick={() => changeColor(c.hex)}
                        className="h-9 w-9 rounded-full ring-1 ring-ink/20"
                        style={{ background: c.hex }}
                        aria-label={c.label}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
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
              ✎ إضافة / تحرير نص
            </Button>

            <details className="rounded-xl border border-ink/10 bg-cream p-3">
              <summary className="cursor-pointer text-sm font-semibold text-ink">
                شعار وصور إضافية
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label
                  htmlFor={logoInputId}
                  className={`inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg border border-ink/20 bg-transparent px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-ink/5 ${uploading ? "pointer-events-none opacity-50" : ""}`}
                >
                  {uploading ? <Spinner /> : "+ شعار"}
                </label>
                <label
                  htmlFor={imageInputId}
                  className={`inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg border border-ink/20 bg-transparent px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-ink/5 ${uploading ? "pointer-events-none opacity-50" : ""}`}
                >
                  {uploading ? <Spinner /> : "+ صورة"}
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
          </DesignerToolsAside>
        )}
      </div>

      <footer className="flex gap-2 border-t border-ink/10 bg-cream p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
          key={`${side}-${fonts.length}`}
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
