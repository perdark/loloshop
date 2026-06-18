"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { getFabric } from "@/lib/fabric-loader";
import { boldSupported, fontFamilyFor, loadFont } from "@/lib/fonts-loader";
import { ORNAMENT_CATEGORIES, ornamentDataUrl } from "@/lib/ornaments";
import type { FontDef } from "@/lib/types";
import { DesignerToolsAside } from "./DesignerToolsAside";

const BOARD = { w: 600, h: 360 };

const TASHKEEL: { ch: string; tip: string }[] = [
  { ch: "َ", tip: "فتحة" },
  { ch: "ُ", tip: "ضمة" },
  { ch: "ِ", tip: "كسرة" },
  { ch: "ْ", tip: "سكون" },
  { ch: "ّ", tip: "شدة" },
  { ch: "ً", tip: "تنوين فتح" },
  { ch: "ٌ", tip: "تنوين ضم" },
  { ch: "ٍ", tip: "تنوين كسر" },
];
const ORNAMENTS = ["۞", "❁", "✦", "★", "♦", "◈", "﴾", "﴿", "✿", "❖"];
// Brand palette only — navy (#0b1e3f) and gold (#c9a961) removed; dark orange
// corrected to brand token #f47b42 (was off-brand #ff8c00).
const TEXT_COLORS = ["#1a1a1a", "#f47b42", "#7a1f2b", "#ffffff"];

const SIDE_HINT: Record<"left" | "right", string> = {
  left: "اكتب اسمك بخط مناسب للتطريز",
  right: "اكتب اسم الجامعة والقسم وسنة التخرج",
};

function defaultFontForSide(side: "left" | "right", fonts: FontDef[]): string {
  // Both sides default to Amiri — a legible classical naskh that renders cleanly
  // at small sizes. Aref Ruqaa stays available in the picker for a calligraphic
  // name, but is too heavy to be a safe default.
  void side;
  return fonts.find((f) => f.id === "amiri")?.id ?? "amiri";
}

const isTextType = (t?: string) =>
  t === "i-text" || t === "text" || t === "IText" || t === "Textbox";

interface Props {
  side: "left" | "right";
  sashColor: string;
  fonts: FontDef[];
  onApply: (json: unknown, fontsUsed: string[]) => void;
  onClose: () => void;
}

export function Whiteboard({ side, fonts, onApply, onClose }: Props) {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricLibRef = useRef<any>(null);
  const usedFontsRef = useRef<Set<string>>(new Set());
  const placeCountRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [currentFont, setCurrentFont] = useState(() => defaultFontForSide(side, fonts));
  const [textColor, setTextColor] = useState("#1a1a1a");
  const [fontSize, setFontSize] = useState(36);
  const [hasSelection, setHasSelection] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [ornCat, setOrnCat] = useState(ORNAMENT_CATEGORIES[0].id);

  useEffect(() => {
    if (!canvasElRef.current) return;
    let disposed = false;
    (async () => {
      const fabric = await getFabric();
      if (disposed || !canvasElRef.current) return;
      fabricLibRef.current = fabric;
      const isTouch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
      const canvas = new fabric.Canvas(canvasElRef.current, {
        width: BOARD.w,
        height: BOARD.h,
        backgroundColor: "#fffdf8",
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
      canvas.on("selection:created", () => setHasSelection(true));
      canvas.on("selection:updated", () => setHasSelection(true));
      canvas.on("selection:cleared", () => setHasSelection(false));
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
  }, []);

  useEffect(() => {
    if (!ready) return;
    const fit = () => {
      const canvas = fabricRef.current;
      const main = mainRef.current;
      if (!canvas || !main) return;
      const avail = Math.max(220, main.clientWidth - 16);
      const scale = Math.min(1, avail / BOARD.w);
      canvas.setDimensions({ width: BOARD.w * scale, height: BOARD.h * scale });
      canvas.setZoom(scale);
      canvas.requestRenderAll();
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (mainRef.current) ro.observe(mainRef.current);
    return () => ro.disconnect();
  }, [ready, toolsOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Preload every catalog font in parallel so the picker can preview each name
  // in its own face. Sequential loading was slow for large catalogs (8+ fonts).
  useEffect(() => {
    let cancelled = false;
    Promise.all(fonts.map((f) => loadFont(f).catch(() => {}))).then(() => {
      if (!cancelled) {
        // Trigger a re-render so the font picker buttons repaint with loaded faces.
        fabricRef.current?.requestRenderAll?.();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fonts]);

  async function addText() {
    const canvas = fabricRef.current;
    const fabric = fabricLibRef.current;
    if (!canvas || !fabric) return;
    const value = text.trim();
    if (!value) {
      toast.error("اكتب النص أولاً");
      return;
    }
    const def = fonts.find((f) => f.id === currentFont);
    if (def) await loadFont(def);
    usedFontsRef.current.add(currentFont);
    const obj = new fabric.IText(value, {
      left: BOARD.w / 2,
      top: BOARD.h / 2,
      originX: "center",
      originY: "center",
      fontFamily: fontFamilyFor(currentFont),
      fontSize,
      fill: textColor,
      direction: "rtl",
      textAlign: "center",
      lineHeight: 1.25,
      editable: true,
    });
    canvas.add(obj);
    canvas.setActiveObject(obj);
    // Re-measure once the webfont is truly ready so the glyph metrics (and the
    // centered origin) are correct instead of the fallback font's.
    await reflowAfterFont(obj);
    canvas.requestRenderAll();
    setText("");
  }

  // Re-measure a text object after its font is loaded (Fabric v6 measures
  // synchronously at creation, so without this it keeps the fallback metrics).
  async function reflowAfterFont(obj: { initDimensions?: () => void; setCoords?: () => void }) {
    if (typeof document !== "undefined" && document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch {
        // ignore
      }
    }
    obj.initDimensions?.();
    obj.setCoords?.();
    fabricRef.current?.requestRenderAll();
  }

  function addGlyph(glyph: string, isTashkeel: boolean) {
    const canvas = fabricRef.current;
    const fabric = fabricLibRef.current;
    if (!canvas || !fabric) return;
    // Register the current font so onApply emits a complete fontsUsed list.
    usedFontsRef.current.add(currentFont);
    const display = isTashkeel ? "ـ" + glyph : glyph;
    const n = placeCountRef.current++;
    const offset = (n % 6) * 22 - 55;
    const obj = new fabric.IText(display, {
      left: BOARD.w / 2 + offset,
      top: BOARD.h / 2 + ((n % 3) - 1) * 30,
      originX: "center",
      originY: "center",
      fontFamily: fontFamilyFor(currentFont),
      fontSize: isTashkeel ? fontSize : Math.round(fontSize * 0.9),
      fill: textColor,
      direction: "rtl",
      editable: false,
      // Decorations are scale-only — mark and lock movement + rotation.
      isDecoration: true,
      lockMovementX: true,
      lockMovementY: true,
      lockRotation: true,
    });
    // Hide rotation handle; keep scale corners.
    obj.setControlsVisibility?.({ mtr: false });
    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.renderAll();
  }

  /**
   * Add a vector ornament (زخرفة) as a self-contained SVG image in the chosen
   * thread color. It serializes as a normal Fabric image, so it round-trips
   * through the editor, customer preview, staff viewer and print export with no
   * special handling. Left freely movable/rotatable/scalable like an image.
   */
  async function addOrnament(svg: string) {
    const canvas = fabricRef.current;
    const fabric = fabricLibRef.current;
    if (!canvas || !fabric) return;
    const ImageClass = fabric.FabricImage ?? fabric.Image;
    if (!ImageClass?.fromURL) {
      toast.error("تعذر إضافة الزخرفة");
      return;
    }
    const n = placeCountRef.current++;
    try {
      const image = await ImageClass.fromURL(ornamentDataUrl(svg, textColor));
      image.scaleToWidth(110);
      image.set({
        left: BOARD.w / 2 + ((n % 5) - 2) * 16,
        top: BOARD.h / 2 + ((n % 3) - 1) * 16,
        originX: "center",
        originY: "center",
      });
      canvas.add(image);
      canvas.setActiveObject(image);
      canvas.requestRenderAll?.() ?? canvas.renderAll();
    } catch {
      toast.error("تعذر إضافة الزخرفة");
    }
  }

  function activeText() {
    const o = fabricRef.current?.getActiveObject();
    return o && isTextType(o?.type) ? o : null;
  }

  async function changeFont(id: string) {
    setCurrentFont(id);
    const def = fonts.find((f) => f.id === id);
    if (def) await loadFont(def);
    const o = activeText();
    if (o) {
      o.set("fontFamily", fontFamilyFor(id));
      usedFontsRef.current.add(id);
      await reflowAfterFont(o);
    }
  }

  function changeColor(c: string) {
    setTextColor(c);
    const o = activeText();
    if (o) {
      o.set("fill", c);
      fabricRef.current.renderAll();
    }
  }

  function changeSize(delta: number) {
    const next = Math.max(10, Math.min(120, fontSize + delta));
    setFontSize(next);
    const o = activeText();
    if (o) {
      o.set("fontSize", next);
      fabricRef.current.renderAll();
    }
  }

  function toggleBold() {
    const o = activeText();
    if (!o) return;
    o.set("fontWeight", o.get("fontWeight") === "bold" ? "normal" : "bold");
    fabricRef.current.renderAll();
  }

  function deleteActive() {
    const canvas = fabricRef.current;
    const o = canvas?.getActiveObject();
    if (!o) return;
    canvas.remove(o);
    canvas.discardActiveObject();
    canvas.renderAll();
  }

  function apply() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (!canvas.getObjects().length) {
      toast.error("أضف نصاً أو زخرفة أولاً");
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = canvas.toJSON() as any;
    json.orientation = "horizontal";
    json.sourceWidth = BOARD.w;
    json.sourceHeight = BOARD.h;
    onApply(json, Array.from(usedFontsRef.current));
  }

  /** Scale the currently-selected object by a multiplier (clamped). */
  function scaleSelected(factor: number) {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj) return;
    const sx = (obj.scaleX ?? 1) * factor;
    const sy = (obj.scaleY ?? 1) * factor;
    const clamped = Math.min(10, Math.max(0.05, sx));
    const clampedY = Math.min(10, Math.max(0.05, sy));
    obj.set({ scaleX: clamped, scaleY: clampedY });
    obj.setCoords?.();
    canvas.requestRenderAll();
  }

  const sideLabel = side === "left" ? "اليسار" : "اليمين";
  const activeOrnaments =
    ORNAMENT_CATEGORIES.find((c) => c.id === ornCat)?.items ?? ORNAMENT_CATEGORIES[0].items;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-cream"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whiteboard-title"
    >
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <h2 id="whiteboard-title" className="font-display-ar text-lg font-semibold text-ink">
          لوحة النص — {sideLabel}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink transition-colors hover:bg-surface-sink"
          aria-label="إغلاق"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 sm:flex-row-reverse sm:gap-3">
        <main
          ref={mainRef}
          className="flex min-h-[min(48vh,320px)] flex-1 items-center justify-center overflow-hidden sm:min-h-0 sm:items-start sm:justify-center"
        >
          <div className="relative touch-none">
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner />
              </div>
            )}
            <canvas ref={canvasElRef} className="rounded-md shadow-lg ring-1 ring-ink/10" />
            {/* On-screen scale control — visible when an object is selected,
                useful on mobile where corner handles are small. */}
            <div
              className={`mt-2 flex items-center justify-center gap-2 transition-opacity ${hasSelection ? "opacity-100" : "pointer-events-none opacity-0"}`}
              aria-hidden={!hasSelection}
              dir="rtl"
            >
              <button
                type="button"
                onClick={() => scaleSelected(0.9)}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line bg-surface text-xl font-bold text-ink shadow-sm transition-colors hover:bg-surface-sink active:scale-95"
                aria-label="تصغير العنصر"
                title="تصغير"
              >
                −
              </button>
              <span className="text-xs text-[var(--shop-muted)]">الحجم</span>
              <button
                type="button"
                onClick={() => scaleSelected(1.1)}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line bg-surface text-xl font-bold text-ink shadow-sm transition-colors hover:bg-surface-sink active:scale-95"
                aria-label="تكبير العنصر"
                title="تكبير"
              >
                +
              </button>
            </div>
            <p className="mt-1 text-center text-xs text-[var(--shop-muted)]">
              الزوايا للتكبير والتدوير
            </p>
          </div>
        </main>

        <DesignerToolsAside
          open={toolsOpen}
          onToggle={() => setToolsOpen((v) => !v)}
          panelId="whiteboard-tools"
          desktopWidthClass="sm:w-80"
        >
          <div className="rounded-xl border border-line bg-beige/60 p-3">
            <p className="mb-2 text-sm font-semibold text-ink">أضف نصاً</p>
            <p className="mb-2 text-xs text-ink-soft">{SIDE_HINT[side]}</p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              dir="rtl"
              rows={2}
              placeholder={SIDE_HINT[side]}
              style={{ fontFamily: fontFamilyFor(currentFont), color: textColor }}
              className="w-full rounded-lg border border-ink/20 bg-cream p-3 text-2xl leading-relaxed"
            />
            <Button variant="primary" fullWidth className="mt-2" onClick={addText} disabled={!ready}>
              أضف النص للوحة
            </Button>
          </div>

          <div className="rounded-xl border border-line bg-cream p-3">
            <p className="mb-1 text-xs font-semibold text-muted">حركات — اضغط ثم اسحبها لأي مكان</p>
            <div className="flex flex-wrap gap-1.5">
              {TASHKEEL.map((t) => (
                <button
                  key={t.ch}
                  type="button"
                  title={t.tip}
                  aria-label={t.tip}
                  onClick={() => addGlyph(t.ch, true)}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-cream text-lg text-ink transition-colors hover:border-neutral-dark hover:bg-surface-sink"
                >
                  {"ـ" + t.ch}
                </button>
              ))}
            </div>
            <p className="mb-1 mt-3 text-xs font-semibold text-muted">رموز — اضغط ثم اسحبها لأي مكان</p>
            <div className="flex flex-wrap gap-1.5">
              {ORNAMENTS.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => addGlyph(o, false)}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-cream text-lg text-ink-soft transition-colors hover:border-neutral-dark hover:bg-surface-sink"
                >
                  {o}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-line bg-cream p-3">
            <p className="mb-1 text-sm font-semibold text-ink">زخارف</p>
            <p className="mb-2 text-xs text-ink-soft">
              اختر زخرفة لإضافتها بلون النص الحالي — ثم اسحبها وكبّرها وأدِرها على الوشاح
            </p>
            <div
              className="mb-2.5 flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1"
              role="tablist"
              aria-label="أقسام الزخارف"
            >
              {ORNAMENT_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={ornCat === c.id}
                  onClick={() => setOrnCat(c.id)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    ornCat === c.id
                      ? "border-orange-ink bg-orange-ink/8 text-ink ring-1 ring-orange-ink"
                      : "border-line bg-cream text-ink-soft hover:border-neutral-dark"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {activeOrnaments.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  title={o.label}
                  aria-label={o.label}
                  onClick={() => addOrnament(o.svg)}
                  className="flex aspect-square items-center justify-center rounded-lg border border-line bg-cream p-1.5 text-ink transition-colors hover:border-orange-ink hover:bg-surface-sink active:scale-95"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ornamentDataUrl(o.svg, "#1a1a1a")}
                    alt=""
                    aria-hidden
                    draggable={false}
                    className="h-full w-full object-contain"
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-line bg-cream p-3">
            <p className="mb-2 text-sm font-semibold text-ink">الخط</p>
            {fonts.length === 0 ? (
              <p className="mb-2 text-sm text-[var(--shop-muted)]">جاري تحميل الخطوط…</p>
            ) : (
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                {fonts.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => changeFont(f.id)}
                    aria-pressed={currentFont === f.id}
                    style={{ fontFamily: fontFamilyFor(f.id) }}
                    className={`shrink-0 min-h-11 rounded-lg border px-3 py-2 text-lg leading-none transition-colors ${
                      currentFont === f.id
                        ? "border-orange-ink bg-orange-ink/8 ring-1 ring-orange-ink text-ink"
                        : "border-line bg-cream text-ink hover:border-neutral-dark"
                    }`}
                  >
                    {f.name_ar}
                  </button>
                ))}
              </div>
            )}
            <p className="mb-2 text-sm font-semibold text-ink">الحجم</p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => changeSize(-2)}>−</Button>
              <span className="min-w-10 text-center text-sm text-ink-soft">{fontSize}</span>
              <Button variant="ghost" onClick={() => changeSize(2)}>+</Button>
              <Button
                variant="ghost"
                onClick={toggleBold}
                disabled={!hasSelection || !boldSupported(currentFont)}
                title={!boldSupported(currentFont) ? "هذا الخط لا يدعم الغامق" : "غامق"}
              >
                B
              </Button>
              <Button variant="danger" onClick={deleteActive} disabled={!hasSelection}>حذف</Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => changeColor(c)}
                  className={`h-11 w-11 rounded-full transition-transform hover:scale-110 ${textColor === c ? "ring-2 ring-offset-2 ring-orange-ink scale-110" : "ring-1 ring-ink/20"}`}
                  style={{ background: c }}
                  aria-label={`لون ${c}`}
                />
              ))}
            </div>
          </div>
        </DesignerToolsAside>
      </div>

      <footer className="flex gap-2 border-t border-line bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button variant="ghost" fullWidth onClick={onClose}>إلغاء</Button>
        <Button variant="primary" fullWidth onClick={apply} disabled={!ready}>
          تطبيق على الوشاح
        </Button>
      </footer>
    </div>
  );
}
