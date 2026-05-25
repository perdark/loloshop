"use client";

import { useEffect, useRef } from "react";
import type { Orientation } from "./OrientationModal";

const COLOR_HEX: Record<string, string> = {
  "أبيض": "#f8f8f6",
  "رمادي فاتح": "#c8c8c8",
  "أخضر داكن": "#1f4e3d",
  "أسود": "#111111",
  "كحلي": "#0b1e3f",
  "عنابي": "#7a1f2b",
};

function LargePanel({
  side,
  json,
  sashColor,
  orientation,
}: {
  side: "left" | "right";
  json: unknown | null;
  sashColor: string;
  orientation: Orientation;
}) {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricRef = useRef<any>(null);

  const isHorizontal = orientation === "horizontal";
  const w = isHorizontal ? 460 : 280;
  const h = isHorizontal ? 280 : 460;
  const sourceW = isHorizontal ? 600 : 360;

  useEffect(() => {
    if (!canvasElRef.current) return;
    let disposed = false;
    (async () => {
      const fabric = await import("fabric");
      if (disposed || !canvasElRef.current) return;
      const canvas = new fabric.StaticCanvas(canvasElRef.current, {
        width: w,
        height: h,
        backgroundColor: COLOR_HEX[sashColor] || "#f8f8f6",
      });
      fabricRef.current = canvas;
      if (json) {
        try {
          await canvas.loadFromJSON(json as Record<string, unknown>);
          canvas.setZoom(w / sourceW);
          canvas.backgroundColor = COLOR_HEX[sashColor] || "#f8f8f6";
          canvas.renderAll();
        } catch {
          // ignore
        }
      }
    })();
    return () => {
      disposed = true;
      try {
        fabricRef.current?.dispose();
      } catch {
        // ignore
      }
      fabricRef.current = null;
    };
  }, [json, sashColor, w, h, sourceW]);

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas
        ref={canvasElRef}
        className="rounded-md shadow-lg ring-2 ring-ink/10"
      />
      <span className="text-sm text-ink/70">
        {side === "left" ? "الأيسر" : "الأيمن"}
        <span className="text-ink/40"> • {isHorizontal ? "أفقي" : "عامودي"}</span>
      </span>
    </div>
  );
}

interface Props {
  sashColor: string;
  leftJson: unknown | null;
  rightJson: unknown | null;
  leftOrientation: Orientation;
  rightOrientation: Orientation;
}

export function DesignPreview({
  sashColor,
  leftJson,
  rightJson,
  leftOrientation,
  rightOrientation,
}: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 sm:flex-row sm:gap-12">
      <LargePanel
        side="right"
        json={rightJson}
        sashColor={sashColor}
        orientation={rightOrientation}
      />
      <LargePanel
        side="left"
        json={leftJson}
        sashColor={sashColor}
        orientation={leftOrientation}
      />
    </div>
  );
}
