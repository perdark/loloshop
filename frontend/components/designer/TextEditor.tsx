"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { listFonts } from "@/lib/designer";
import { fontFamilyFor, loadFont } from "@/lib/fonts-loader";
import type { FontDef } from "@/lib/types";
import type { Orientation } from "./OrientationModal";

interface Props {
  open: boolean;
  side: "left" | "right";
  orientation: Orientation;
  initialJson: unknown | null;
  initialImageUrl?: string | null;
  sashColor: string;
  onSave: (json: unknown, fontsUsed: string[]) => void;
  onClose: () => void;
}

const CANVAS_VERTICAL = { w: 360, h: 600 };
const CANVAS_HORIZONTAL = { w: 600, h: 360 };

const SIDE_LABEL: Record<"left" | "right", string> = {
  left: "الجانب الأيسر — اسم الطالب",
  right: "الجانب الأيمن — الجامعة والقسم",
};

const COLOR_HEX: Record<string, string> = {
  "أبيض": "#f8f8f6",
  "رمادي فاتح": "#c8c8c8",
  "أخضر داكن": "#1f4e3d",
  "أسود": "#111111",
  "كحلي": "#0b1e3f",
  "عنابي": "#7a1f2b",
};

export function TextEditor({
  open,
  side,
  orientation,
  initialJson,
  initialImageUrl,
  sashColor,
  onSave,
  onClose,
}: Props) {
  const CANVAS_WIDTH =
    orientation === "horizontal" ? CANVAS_HORIZONTAL.w : CANVAS_VERTICAL.w;
  const CANVAS_HEIGHT =
    orientation === "horizontal" ? CANVAS_HORIZONTAL.h : CANVAS_VERTICAL.h;
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  // Fabric canvas instance — typed as `any` because Fabric.js v6 lacks
  // first-class React types and we load it dynamically.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricLibRef = useRef<any>(null);

  const [ready, setReady] = useState(false);
  const [fonts, setFonts] = useState<FontDef[]>([]);
  const [currentFont, setCurrentFont] = useState<string>("amiri");
  const [textColor, setTextColor] = useState<string>("#0b1e3f");
  const [activeIsText, setActiveIsText] = useState(false);
  const usedFontsRef = useRef<Set<string>>(new Set());

  // mount: init Fabric canvas
  useEffect(() => {
    if (!open || !canvasElRef.current) return;
    let disposed = false;

    (async () => {
      const fabric = await import("fabric");
      if (disposed) return;
      fabricLibRef.current = fabric;

      const canvas = new fabric.Canvas(canvasElRef.current!, {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        backgroundColor: COLOR_HEX[sashColor] || "#f8f8f6",
        preserveObjectStacking: true,
      });
      fabricRef.current = canvas;

      canvas.on("selection:created", (e) => {
        const obj = e.selected?.[0];
        setActiveIsText(obj?.type === "i-text" || obj?.type === "text");
      });
      canvas.on("selection:updated", (e) => {
        const obj = e.selected?.[0];
        setActiveIsText(obj?.type === "i-text" || obj?.type === "text");
      });
      canvas.on("selection:cleared", () => setActiveIsText(false));

      if (initialJson) {
        try {
          await canvas.loadFromJSON(
            initialJson as Record<string, unknown>,
            () => canvas.renderAll()
          );
          canvas.backgroundColor = COLOR_HEX[sashColor] || "#f8f8f6";
          canvas.renderAll();
        } catch {
          // ignore bad json
        }
      }

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
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, side]);

  // load fonts list
  useEffect(() => {
    if (!open) return;
    listFonts()
      .then(setFonts)
      .catch(() => toast.error("تعذر تحميل الخطوط"));
  }, [open]);

  async function addText() {
    const canvas = fabricRef.current;
    const fabric = fabricLibRef.current;
    if (!canvas || !fabric) return;

    const fontDef = fonts.find((f) => f.id === currentFont);
    if (fontDef) await loadFont(fontDef);
    usedFontsRef.current.add(currentFont);

    const text = new fabric.IText(side === "left" ? "اسم الطالب" : "الجامعة", {
      left: CANVAS_WIDTH / 2,
      top: CANVAS_HEIGHT / 2,
      originX: "center",
      originY: "center",
      fontFamily: fontFamilyFor(currentFont),
      fontSize: 32,
      fill: textColor,
      direction: "rtl",
      textAlign: "center",
      editable: true,
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
  }

  async function changeFont(id: string) {
    setCurrentFont(id);
    const fontDef = fonts.find((f) => f.id === id);
    if (fontDef) await loadFont(fontDef);
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (active && (active.type === "i-text" || active.type === "text")) {
      active.set("fontFamily", fontFamilyFor(id));
      usedFontsRef.current.add(id);
      canvas.renderAll();
    }
  }

  function changeTextColor(c: string) {
    setTextColor(c);
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (active && (active.type === "i-text" || active.type === "text")) {
      active.set("fill", c);
      canvas.renderAll();
    }
  }

  function changeFontSize(delta: number) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active || !(active.type === "i-text" || active.type === "text"))
      return;
    const cur = (active.get("fontSize") as number) || 32;
    active.set("fontSize", Math.max(10, Math.min(120, cur + delta)));
    canvas.renderAll();
  }

  function toggleBold() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active || !(active.type === "i-text" || active.type === "text"))
      return;
    const cur = active.get("fontWeight");
    active.set("fontWeight", cur === "bold" ? "normal" : "bold");
    canvas.renderAll();
  }

  function deleteActive() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    canvas.remove(active);
    canvas.discardActiveObject();
    canvas.renderAll();
  }

  async function addImage(url: string) {
    const canvas = fabricRef.current;
    const fabric = fabricLibRef.current;
    if (!canvas || !fabric) return;
    try {
      const img = await fabric.FabricImage.fromURL(url, {
        crossOrigin: "anonymous",
      });
      img.scaleToWidth(120);
      img.set({
        left: CANVAS_WIDTH / 2,
        top: CANVAS_HEIGHT / 2,
        originX: "center",
        originY: "center",
      });
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.renderAll();
    } catch {
      toast.error("تعذر إضافة الصورة");
    }
  }

  function save() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const json = canvas.toJSON();
    // embed orientation + source canvas dimensions for previews/exports
    json.orientation = orientation;
    json.sourceWidth = CANVAS_WIDTH;
    json.sourceHeight = CANVAS_HEIGHT;
    onSave(json, Array.from(usedFontsRef.current));
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-cream">
      <header className="flex items-center justify-between border-b border-ink/10 bg-ink px-4 py-3 text-cream">
        <h2 className="font-display text-lg">{SIDE_LABEL[side]}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 hover:bg-cream/10"
          aria-label="إغلاق"
        >
          ✕
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3 sm:flex-row">
        <aside className="flex flex-row gap-2 overflow-x-auto sm:flex-col sm:w-64 sm:gap-3 sm:overflow-y-auto">
          <div className="min-w-[10rem] rounded-lg border border-ink/10 bg-cream p-3 shadow-sm">
            <p className="mb-2 text-sm font-semibold text-ink">إضافة</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={addText}>
                + نص
              </Button>
              {initialImageUrl && (
                <Button
                  variant="ghost"
                  onClick={() => addImage(initialImageUrl)}
                >
                  + شعار
                </Button>
              )}
            </div>
          </div>

          <div className="min-w-[12rem] rounded-lg border border-ink/10 bg-cream p-3 shadow-sm">
            <p className="mb-2 text-sm font-semibold text-ink">الخط</p>
            <select
              value={currentFont}
              onChange={(e) => changeFont(e.target.value)}
              className="w-full rounded border border-ink/20 bg-cream px-2 py-2 text-sm"
            >
              {fonts.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name_ar}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[10rem] rounded-lg border border-ink/10 bg-cream p-3 shadow-sm">
            <p className="mb-2 text-sm font-semibold text-ink">حجم النص</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => changeFontSize(-4)}>
                −
              </Button>
              <Button variant="ghost" onClick={() => changeFontSize(4)}>
                +
              </Button>
              <Button
                variant="ghost"
                onClick={toggleBold}
                disabled={!activeIsText}
              >
                B
              </Button>
            </div>
          </div>

          <div className="min-w-[10rem] rounded-lg border border-ink/10 bg-cream p-3 shadow-sm">
            <p className="mb-2 text-sm font-semibold text-ink">لون النص</p>
            <div className="flex flex-wrap gap-2">
              {["#0b1e3f", "#c9a961", "#7a1f2b", "#111111", "#f8f8f6"].map(
                (c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => changeTextColor(c)}
                    className={`h-8 w-8 rounded-full ring-1 ring-ink/20 ${
                      textColor === c ? "ring-2 ring-orange" : ""
                    }`}
                    style={{ background: c }}
                    aria-label={c}
                  />
                )
              )}
            </div>
          </div>

          <div className="min-w-[8rem] rounded-lg border border-ink/10 bg-cream p-3 shadow-sm">
            <Button variant="danger" onClick={deleteActive} fullWidth>
              حذف المحدد
            </Button>
          </div>
        </aside>

        <main className="flex flex-1 items-start justify-center overflow-auto">
          <div className="relative">
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner />
              </div>
            )}
            <canvas
              ref={canvasElRef}
              className="rounded-md shadow-lg ring-1 ring-ink/10"
            />
          </div>
        </main>
      </div>

      <footer className="flex gap-2 border-t border-ink/10 bg-cream p-3">
        <Button variant="ghost" fullWidth onClick={onClose}>
          إلغاء
        </Button>
        <Button variant="primary" fullWidth onClick={save} disabled={!ready}>
          تم
        </Button>
      </footer>
    </div>
  );
}
