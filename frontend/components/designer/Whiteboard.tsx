"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { getFabric } from "@/lib/fabric-loader";
import { fontFamilyFor, loadFont } from "@/lib/fonts-loader";
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
const TEXT_COLORS = ["#1a1a1a", "#ff8c00", "#7a1f2b", "#ffffff", "#c9a961", "#0b1e3f"];

const SIDE_HINT: Record<"left" | "right", string> = {
  left: "اكتب اسمك بخط مناسب للتطريز",
  right: "اكتب اسم الجامعة والقسم وسنة التخرج",
};

function defaultFontForSide(side: "left" | "right", fonts: FontDef[]): string {
  if (side === "right") {
    return fonts.find((f) => f.id === "amiri")?.id ?? "amiri";
  }
  return (
    fonts.find((f) => f.id === "aref-ruqaa")?.id ??
    fonts.find((f) => f.id === "lateef")?.id ??
    "aref-ruqaa"
  );
}

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
  const [fontSize, setFontSize] = useState(48);
  const [hasSelection, setHasSelection] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(true);

  useEffect(() => {
    if (!canvasElRef.current) return;
    let disposed = false;
    (async () => {
      const fabric = await getFabric();
      if (disposed || !canvasElRef.current) return;
      fabricLibRef.current = fabric;
      const canvas = new fabric.Canvas(canvasElRef.current, {
        width: BOARD.w,
        height: BOARD.h,
        backgroundColor: "#fffdf8",
        preserveObjectStacking: true,
      });
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
      editable: true,
    });
    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.renderAll();
    setText("");
  }

  function addGlyph(glyph: string, isTashkeel: boolean) {
    const canvas = fabricRef.current;
    const fabric = fabricLibRef.current;
    if (!canvas || !fabric) return;
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
    });
    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.renderAll();
  }

  function activeText() {
    const o = fabricRef.current?.getActiveObject();
    const t = o?.type ?? "";
    return o &&
      (t === "i-text" || t === "text" || t === "IText" || t === "Textbox")
      ? o
      : null;
  }

  async function changeFont(id: string) {
    setCurrentFont(id);
    const def = fonts.find((f) => f.id === id);
    if (def) await loadFont(def);
    const o = activeText();
    if (o) {
      o.set("fontFamily", fontFamilyFor(id));
      usedFontsRef.current.add(id);
      fabricRef.current.renderAll();
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
    const next = Math.max(12, Math.min(160, fontSize + delta));
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

  const sideLabel = side === "left" ? "اليسار" : "اليمين";

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-cream"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whiteboard-title"
    >
      <header className="flex items-center justify-between border-b border-ink/10 bg-ink px-4 py-3 text-cream">
        <h2 id="whiteboard-title" className="font-display text-lg">
          لوحة النص — {sideLabel}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-cream/10"
          aria-label="إغلاق"
        >
          ✕
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
            <p className="mt-2 text-center text-xs text-ink/50">
              اسحب أي عنصر لأي مكان • اسحب الزوايا للتكبير والتدوير
            </p>
          </div>
        </main>

        <DesignerToolsAside
          open={toolsOpen}
          onToggle={() => setToolsOpen((v) => !v)}
          panelId="whiteboard-tools"
          desktopWidthClass="sm:w-80"
        >
          <div className="rounded-xl border border-ink/10 bg-beige/60 p-3 shadow-sm">
            <p className="mb-2 text-sm font-semibold text-ink">أضف نصاً</p>
            <p className="mb-2 text-xs text-ink/60">{SIDE_HINT[side]}</p>
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

          <div className="rounded-xl border border-ink/10 bg-cream p-3 shadow-sm">
            <p className="mb-1 text-xs font-semibold text-ink/70">حركات — اضغط ثم اسحبها لأي مكان</p>
            <div className="flex flex-wrap gap-1.5">
              {TASHKEEL.map((t) => (
                <button
                  key={t.ch}
                  type="button"
                  title={t.tip}
                  aria-label={t.tip}
                  onClick={() => addGlyph(t.ch, true)}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-ink/15 bg-cream text-lg text-ink hover:border-orange hover:bg-orange/10"
                >
                  {"ـ" + t.ch}
                </button>
              ))}
            </div>
            <p className="mb-1 mt-3 text-xs font-semibold text-ink/70">زخرفة — اضغط ثم اسحبها لأي مكان</p>
            <div className="flex flex-wrap gap-1.5">
              {ORNAMENTS.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => addGlyph(o, false)}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-ink/15 bg-cream text-lg text-orange-ink hover:border-orange hover:bg-orange/10"
                >
                  {o}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-ink/10 bg-cream p-3 shadow-sm">
            <p className="mb-2 text-sm font-semibold text-ink">الخط والحجم</p>
            <select
              value={currentFont}
              onChange={(e) => changeFont(e.target.value)}
              disabled={!fonts.length}
              className="mb-2 w-full rounded border border-ink/20 bg-cream px-2 py-2 text-sm"
            >
              {fonts.length === 0 ? (
                <option value={currentFont}>جاري تحميل الخطوط…</option>
              ) : (
                fonts.map((f) => (
                  <option key={f.id} value={f.id} style={{ fontFamily: fontFamilyFor(f.id) }}>
                    {f.name_ar}
                  </option>
                ))
              )}
            </select>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => changeSize(-4)}>−</Button>
              <span className="min-w-10 text-center text-sm text-ink/70">{fontSize}</span>
              <Button variant="ghost" onClick={() => changeSize(4)}>+</Button>
              <Button variant="ghost" onClick={toggleBold} disabled={!hasSelection}>B</Button>
              <Button variant="danger" onClick={deleteActive} disabled={!hasSelection}>حذف</Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => changeColor(c)}
                  className={`h-11 w-11 rounded-full ring-1 ring-ink/20 ${textColor === c ? "ring-2 ring-orange" : ""}`}
                  style={{ background: c }}
                  aria-label={`لون ${c}`}
                />
              ))}
            </div>
          </div>
        </DesignerToolsAside>
      </div>

      <footer className="flex gap-2 border-t border-ink/10 bg-cream p-3">
        <Button variant="ghost" fullWidth onClick={onClose}>إلغاء</Button>
        <Button variant="primary" fullWidth onClick={apply} disabled={!ready}>
          تطبيق على الوشاح
        </Button>
      </footer>
    </div>
  );
}
