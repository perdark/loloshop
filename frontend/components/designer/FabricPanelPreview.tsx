"use client";

import { useEffect, useRef } from "react";
import { getFabric } from "@/lib/fabric-loader";
import { loadPanelOntoCanvas } from "@/lib/render-sash-panel";

interface FabricPanelPreviewProps {
  json: unknown | null;
  sashColor: string;
  width: number;
  height: number;
  className?: string;
  fontsUsed?: string[];
  /** When true, render on a transparent canvas (no sash-color fill) */
  transparentBg?: boolean;
}

/** Static Fabric thumb with horizontal→vertical rotation for sash panels */
export function FabricPanelPreview({
  json,
  sashColor,
  width,
  height,
  className,
  fontsUsed,
  transparentBg = false,
}: FabricPanelPreviewProps) {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricRef = useRef<any>(null);
  const loadGenRef = useRef(0);

  useEffect(() => {
    return () => {
      try {
        fabricRef.current?.dispose();
      } catch {
        // ignore
      }
      fabricRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!canvasElRef.current) return;
    const gen = ++loadGenRef.current;

    (async () => {
      const fabric = await getFabric();
      if (gen !== loadGenRef.current || !canvasElRef.current) return;

      let canvas = fabricRef.current;
      if (!canvas) {
        canvas = new fabric.StaticCanvas(canvasElRef.current, {
          width,
          height,
        });
        fabricRef.current = canvas;
      } else {
        canvas.setDimensions({ width, height });
      }

      try {
        await loadPanelOntoCanvas(canvas, {
          json,
          sashColor,
          targetWidth: width,
          targetHeight: height,
          fontsUsed,
          transparentBg,
        });
      } catch (err) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[FabricPanelPreview] loadPanelOntoCanvas failed", err);
        }
      }
    })();
  }, [json, sashColor, width, height, transparentBg, fontsUsed]);

  return <canvas ref={canvasElRef} className={className ?? "block"} />;
}
