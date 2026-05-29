"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { getFabric } from "@/lib/fabric-loader";
import { loadPanelOntoCanvas } from "@/lib/render-sash-panel";

const SashGownPreview = dynamic(
  () =>
    import("@/components/designer/SashGownPreview").then((m) => m.SashGownPreview),
  { ssr: false, loading: () => <Spinner /> }
);

function ReadOnlyPanel({
  label,
  json,
  sashColor,
  width,
  height,
  fontsUsed,
}: {
  label: string;
  json: unknown | null;
  sashColor: string | null;
  width: number;
  height: number;
  fontsUsed?: string[];
}) {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricRef = useRef<any>(null);

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
    let disposed = false;

    (async () => {
      const fabric = await getFabric();
      if (disposed || !canvasElRef.current) return;

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
        });
      } catch {
        // ignore corrupt JSON
      }
    })();

    return () => {
      disposed = true;
    };
  }, [json, sashColor, width, height, fontsUsed]);

  return (
    <div className="flex flex-col items-center gap-2.5">
      <div className="overflow-hidden rounded-2xl bg-cream p-1.5 shadow-[var(--shadow-card)] ring-1 ring-ink/10">
        <div className="overflow-hidden rounded-xl">
          <canvas ref={canvasElRef} />
        </div>
      </div>
      <span className="text-sm font-semibold text-ink">{label}</span>
    </div>
  );
}

type ViewMode = "gown" | "panels";

interface DesignViewerProps {
  sashColor: string | null;
  leftCanvas: unknown | null;
  rightCanvas: unknown | null;
  fontsUsed?: string[];
  compact?: boolean;
}

export function DesignViewer({
  sashColor,
  leftCanvas,
  rightCanvas,
  fontsUsed,
  compact = false,
}: DesignViewerProps) {
  const [view, setView] = useState<ViewMode>("gown");
  const w = compact ? 200 : 320;
  const h = compact ? 333 : 533;
  const color = sashColor ?? "أبيض";

  return (
    <div className="space-y-4" aria-label="معاينة التصميم">
      <div className="flex justify-center">
        <div className="inline-flex gap-1 rounded-full border border-ink/10 bg-beige/60 p-1">
          <Button
            size="sm"
            variant={view === "gown" ? "primary" : "ghost"}
            onClick={() => setView("gown")}
          >
            على الروب
          </Button>
          <Button
            size="sm"
            variant={view === "panels" ? "primary" : "ghost"}
            onClick={() => setView("panels")}
          >
            لوحات مسطحة
          </Button>
        </div>
      </div>

      {view === "gown" ? (
        <SashGownPreview
          sashColor={color}
          leftJson={leftCanvas}
          rightJson={rightCanvas}
          fontsUsed={fontsUsed}
          readOnly
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-6 lg:flex-row lg:gap-10">
          <ReadOnlyPanel
            label="الجانب الأيمن (الجامعة)"
            json={rightCanvas}
            sashColor={sashColor}
            width={w}
            height={h}
            fontsUsed={fontsUsed}
          />
          <ReadOnlyPanel
            label="الجانب الأيسر (الاسم)"
            json={leftCanvas}
            sashColor={sashColor}
            width={w}
            height={h}
            fontsUsed={fontsUsed}
          />
        </div>
      )}
    </div>
  );
}
