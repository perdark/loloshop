"use client";

/**
 * PlateCompositor — full-screen modal to overlay a draggable/resizable/rotatable
 * layer (uploaded photo, library ornament, or AI-generated element) on top of a
 * calligraphy plate, then save the merged PNG back to the plate via
 * POST /calligraphy/plates/:id/compose.
 *
 * Taint-safety contract:
 *   • Plate + AI element → crossOrigin:"anonymous" (server sends CORS headers).
 *   • Uploaded photo + library ornaments → local data: / blob: URLs — no taint.
 *   • canvas.toDataURL() should therefore never throw; we catch it and toast if it
 *     does (e.g. unexpected redirect that strips CORS headers).
 */

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ORNAMENT_CATEGORIES, ornamentDataUrl } from "@/lib/ornaments";
import { absUrl, composePlate, generateElement, type CalPlate } from "@/lib/calligraphy";
import { Button } from "@/components/ui/Button";
import { getApiErrorMessage } from "@/lib/api";
import { getFabric } from "@/lib/fabric-loader";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max display width of the canvas inside the modal. */
const MAX_DISPLAY_W = 640;

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  plate: CalPlate;
  onSaved: (p: CalPlate) => void;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PlateCompositor({ plate, onSaved, onClose }: Props) {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricRef = useRef<any>(null);
  /** Natural (unscaled) pixel width of the plate image — used for export multiplier. */
  const naturalWidthRef = useRef<number>(MAX_DISPLAY_W);

  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [genWord, setGenWord] = useState("");
  const [showLibrary, setShowLibrary] = useState(false);
  const [libCat, setLibCat] = useState(ORNAMENT_CATEGORIES[0].id);

  const uploadRef = useRef<HTMLInputElement>(null);

  // ── Esc to close ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  // ── Init Fabric canvas + load plate as background ───────────────────────────
  useEffect(() => {
    if (!canvasElRef.current) return;
    let disposed = false;

    (async () => {
      const fabric = await getFabric();
      if (disposed || !canvasElRef.current) return;

      // Determine display size: fit within viewport width and max constant.
      const vw = typeof window !== "undefined" ? window.innerWidth : 800;
      const displayW = Math.min(MAX_DISPLAY_W, vw - 32);

      const canvas = new fabric.Canvas(canvasElRef.current, {
        width: displayW,
        height: displayW, // placeholder; resized after the image loads
        backgroundColor: "#ffffff",
        preserveObjectStacking: true,
        selection: true,
      });

      // Brand control handle colours (mirrors Whiteboard.tsx)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cv = canvas as any;
      cv.cornerSize = 14;
      cv.cornerStyle = "circle";
      cv.transparentCorners = false;
      cv.cornerColor = "#f47b42";
      cv.borderColor = "#f47b42";

      fabricRef.current = canvas;

      // Load the plate as a fixed background layer.
      const plateUrl = absUrl(plate.plate_path);
      try {
        const ImageClass =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (fabric as any).FabricImage ?? fabric.Image;

        const img = await ImageClass.fromURL(plateUrl, { crossOrigin: "anonymous" });

        // Store natural width for the export multiplier.
        const natW: number = img.width ?? displayW;
        const natH: number = img.height ?? displayW;
        naturalWidthRef.current = natW;

        // Resize canvas to match the plate aspect ratio.
        const displayH = Math.round((displayW / natW) * natH);
        canvas.setDimensions({ width: displayW, height: displayH });

        // Scale the image to fill the display canvas exactly.
        const scale = displayW / natW;
        img.set({
          left: 0,
          top: 0,
          // Fabric 7 changed the default origin to center; this layer is positioned from
          // its top-left corner and must keep the v6 geometry.
          originX: "left",
          originY: "top",
          scaleX: scale,
          scaleY: scale,
          selectable: false,
          evented: false,
          hasBorders: false,
          hasControls: false,
        });

        canvas.add(img);
        canvas.sendObjectToBack(img);
        canvas.renderAll();
      } catch {
        toast.error("تعذّر تحميل اللوحة");
      }

      if (!disposed) setReady(true);
    })();

    return () => {
      disposed = true;
      try {
        fabricRef.current?.dispose();
      } catch {
        // ignore
      }
      fabricRef.current = null;
      setReady(false);
    };
  // plate.id + plate_path are stable for the lifetime of this modal instance.
  }, [plate.id, plate.plate_path]);

  // ── Helper: add a selectable overlay layer ───────────────────────────────────
  async function addLayer(
    url: string,
    opts: { crossOrigin?: "anonymous" } = {}
  ) {
    const fabric = await getFabric();
    const canvas = fabricRef.current;
    if (!canvas) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ImageClass = (fabric as any).FabricImage ?? fabric.Image;
    const crossOrigin = opts.crossOrigin ?? undefined;

    const img = await ImageClass.fromURL(url, crossOrigin ? { crossOrigin } : {});

    const canvasW: number = canvas.getWidth();
    // Target ≈35% of the canvas width so new layers are visible but not overwhelming.
    const targetW = canvasW * 0.35;
    const natW: number = img.width ?? targetW;
    const natH: number = img.height ?? targetW;
    const scale = targetW / natW;

    img.set({
      scaleX: scale,
      scaleY: scale,
      left: (canvasW - natW * scale) / 2,
      top: (canvas.getHeight() - natH * scale) / 2,
      originX: "left",
      originY: "top",
      selectable: true,
      evented: true,
    });

    canvas.add(img);
    canvas.setActiveObject(img);
    canvas.renderAll();
  }

  // ── Upload photo ─────────────────────────────────────────────────────────────
  function handleUploadChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;
      // Local data URL — no crossOrigin needed (canvas not tainted).
      await addLayer(dataUrl);
    };
    reader.readAsDataURL(file);
    // Reset input so the same file can be re-selected.
    e.target.value = "";
  }

  // ── Library ornament ─────────────────────────────────────────────────────────
  async function handleOrnamentPick(svg: string) {
    // ornamentDataUrl returns a data: URL — local, no taint.
    const dataUrl = ornamentDataUrl(svg, "#1A1A1A");
    await addLayer(dataUrl);
    setShowLibrary(false);
  }

  // ── AI element ───────────────────────────────────────────────────────────────
  async function handleGenerate() {
    const word = genWord.trim();
    if (!word) {
      toast.error("أدخل كلمة أو وصفًا للعنصر");
      return;
    }
    setGenLoading(true);
    try {
      const { url } = await generateElement(word);
      // AI element URL is server-absolute; needs crossOrigin.
      await addLayer(absUrl(url), { crossOrigin: "anonymous" });
      setGenWord("");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذّر توليد العنصر"));
    } finally {
      setGenLoading(false);
    }
  }

  // ── Delete active overlay ─────────────────────────────────────────────────────
  function handleDelete() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    // Guard: never remove the non-selectable background plate.
    if (obj && obj.selectable) {
      canvas.remove(obj);
      canvas.renderAll();
    }
  }

  // ── Save (merge + upload) ─────────────────────────────────────────────────────
  async function handleSave() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    setSaving(true);
    try {
      const displayW: number = canvas.getWidth();
      const natW = naturalWidthRef.current;
      const multiplier = natW / displayW;

      let dataUrl: string;
      try {
        dataUrl = canvas.toDataURL({ format: "png", multiplier });
      } catch {
        toast.error("تعذّر حفظ الصورة — حدث خطأ في الصورة");
        return;
      }

      const blob = await (await fetch(dataUrl)).blob();
      const updated = await composePlate(plate.id, blob);
      toast.success("تم حفظ اللوحة");
      onSaved(updated);
      onClose();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذّر رفع اللوحة"));
    } finally {
      setSaving(false);
    }
  }

  // ── Shared pill button style (mirrors the page's tab buttons) ────────────────
  const pillCls =
    "min-h-11 rounded-full border border-line bg-beige px-4 py-2 text-xs font-semibold text-ink transition-all duration-200 hover:border-orange/40 hover:text-orange-ink disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 inline-flex items-center justify-center gap-1.5";

  const activePillCls =
    "min-h-11 rounded-full px-4 py-2 text-xs font-semibold transition-all duration-200 bg-orange-ink text-white shadow-sm inline-flex items-center justify-center gap-1.5";

  // ── Ornament category items ───────────────────────────────────────────────────
  const activeCategory =
    ORNAMENT_CATEGORIES.find((c) => c.id === libCat) ?? ORNAMENT_CATEGORIES[0];

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      dir="rtl"
      lang="ar"
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-ink/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`تحرير لوحة: ${plate.render_text}`}
    >
      {/* Modal card */}
      <div
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-cream shadow-[var(--shadow-pop)] ring-1 ring-line"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-line bg-surface-sink px-5 py-4">
          <h2 className="font-display text-lg font-bold text-ink">
            تحرير اللوحة — {plate.render_text}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-beige text-ink-soft transition hover:bg-orange-ink hover:text-white"
            aria-label="إغلاق"
          >
            ✕
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto">
          {/* Toolbar */}
          <div className="flex flex-wrap gap-2 border-b border-line bg-white px-4 py-3">
            {/* Upload photo */}
            <button
              type="button"
              className={pillCls}
              disabled={!ready || saving}
              onClick={() => uploadRef.current?.click()}
            >
              رفع صورة
            </button>
            <input
              ref={uploadRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleUploadChange}
            />

            {/* Library toggle */}
            <button
              type="button"
              className={showLibrary ? activePillCls : pillCls}
              disabled={!ready || saving}
              onClick={() => setShowLibrary((v) => !v)}
            >
              من المكتبة
            </button>

            {/* Delete active layer */}
            <button
              type="button"
              className={`${pillCls} text-danger border-danger/35 hover:border-danger/60 hover:text-danger`}
              disabled={!ready || saving}
              onClick={handleDelete}
            >
              حذف العنصر
            </button>
          </div>

          {/* Ornament library panel */}
          {showLibrary && (
            <div className="border-b border-line bg-beige px-4 py-3 space-y-3">
              {/* Category chips */}
              <div className="flex flex-wrap gap-1.5">
                {ORNAMENT_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setLibCat(cat.id)}
                    className={libCat === cat.id ? activePillCls : pillCls}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
              {/* Ornament grid */}
              <div className="grid grid-cols-5 gap-2 sm:grid-cols-8">
                {activeCategory.items.map((item) => {
                  const thumbUrl = ornamentDataUrl(item.svg, "#1A1A1A");
                  return (
                    <button
                      key={item.id}
                      type="button"
                      title={item.label}
                      aria-label={item.label}
                      onClick={() => handleOrnamentPick(item.svg)}
                      className="flex h-10 w-full items-center justify-center rounded-xl border border-line bg-white transition hover:border-orange/40 hover:bg-orange/5 focus-visible:outline-2"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbUrl}
                        alt={item.label}
                        className="h-7 w-7 object-contain"
                        loading="lazy"
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* AI element row */}
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-3">
            <span className="text-xs font-semibold text-ink-soft shrink-0">
              عنصر بالذكاء (~$0.10):
            </span>
            <input
              type="text"
              dir="rtl"
              value={genWord}
              onChange={(e) => setGenWord(e.target.value)}
              placeholder="مثال: وردة، نجمة، هلال…"
              disabled={genLoading || saving || !ready}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleGenerate();
              }}
              className="min-h-9 flex-1 min-w-[120px] rounded-full border border-line bg-beige px-3 py-1.5 text-xs text-ink placeholder:text-ink/30 focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15 disabled:opacity-60"
            />
            <button
              type="button"
              disabled={genLoading || saving || !ready || !genWord.trim()}
              onClick={handleGenerate}
              className={`${pillCls} shrink-0`}
            >
              {genLoading && (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              )}
              توليد
            </button>
          </div>

          {/* Canvas area */}
          <div className="flex items-center justify-center bg-gray-100 p-4">
            {!ready && (
              <div className="absolute flex items-center gap-2 text-sm text-ink-soft">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-orange border-t-transparent" />
                جارٍ التحميل…
              </div>
            )}
            <canvas
              ref={canvasElRef}
              className="block max-w-full rounded-xl shadow-md"
              style={{ direction: "ltr" }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 gap-2 border-t border-line px-5 py-4">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={saving}
            className="flex-1"
          >
            إلغاء
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            loading={saving}
            disabled={!ready || saving}
            className="flex-1"
          >
            حفظ
          </Button>
        </div>
      </div>
    </div>
  );
}
