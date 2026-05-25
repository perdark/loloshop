"use client";

import { useEffect, useRef } from "react";
import { sashColorToHex } from "@/lib/sash-colors";

function ReadOnlyPanel({
  label,
  json,
  sashColor,
  width,
  height,
  zoom,
}: {
  label: string;
  json: unknown | null;
  sashColor: string | null;
  width: number;
  height: number;
  zoom: number;
}) {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricRef = useRef<any>(null);

  useEffect(() => {
    if (!canvasElRef.current) return;
    let disposed = false;

    (async () => {
      const fabric = await import("fabric");
      if (disposed || !canvasElRef.current) return;

      const canvas = new fabric.StaticCanvas(canvasElRef.current, {
        width,
        height,
        backgroundColor: sashColorToHex(sashColor),
      });
      fabricRef.current = canvas;

      if (json) {
        try {
          await canvas.loadFromJSON(json as Record<string, unknown>);
          canvas.setZoom(zoom);
          canvas.backgroundColor = sashColorToHex(sashColor);
          canvas.renderAll();
        } catch {
          // ignore corrupt JSON
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
  }, [json, sashColor, width, height, zoom]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="rounded-lg shadow-md ring-1 ring-ink/10">
        <canvas ref={canvasElRef} />
      </div>
      <span className="text-sm font-semibold text-ink">{label}</span>
    </div>
  );
}

interface DesignViewerProps {
  sashColor: string | null;
  leftCanvas: unknown | null;
  rightCanvas: unknown | null;
  compact?: boolean;
}

export function DesignViewer({
  sashColor,
  leftCanvas,
  rightCanvas,
  compact = false,
}: DesignViewerProps) {
  const w = compact ? 200 : 320;
  const h = compact ? 333 : 533;
  const zoom = w / 360;

  return (
    <div
      className="flex flex-col items-center justify-center gap-6 lg:flex-row lg:gap-10"
      aria-label="معاينة التصميم للطباعة"
    >
      <ReadOnlyPanel
        label="الجانب الأيمن (الجامعة)"
        json={rightCanvas}
        sashColor={sashColor}
        width={w}
        height={h}
        zoom={zoom}
      />
      <ReadOnlyPanel
        label="الجانب الأيسر (الاسم)"
        json={leftCanvas}
        sashColor={sashColor}
        width={w}
        height={h}
        zoom={zoom}
      />
    </div>
  );
}
