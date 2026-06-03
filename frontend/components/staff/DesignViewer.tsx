"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { renderPanelToDataUrl } from "@/lib/render-sash-panel";
import { SASH_COLOR_HEX } from "@/lib/designer-colors";

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
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Resolve the fabric color vars so the .sash-stage wrapper reads as real fabric
  const fabricColors =
    SASH_COLOR_HEX[sashColor ?? "أبيض"] ?? SASH_COLOR_HEX["أبيض"];

  // Render via the SAME proven rasterizer used by the staff PNG/board export
  // (transparent background so the .sash-stage fabric texture shows through).
  const fontsKey = (fontsUsed ?? []).join("|");
  useEffect(() => {
    let alive = true;
    setLoading(true);
    renderPanelToDataUrl({
      json,
      sashColor,
      targetWidth: width * 2,
      targetHeight: height * 2,
      fontsUsed,
      transparentBg: true,
    })
      .then((u) => { if (alive) setUrl(u); })
      .catch(() => { if (alive) setUrl(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // fontsKey stands in for the fontsUsed array identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, sashColor, width, height, fontsKey]);

  return (
    <div className="flex flex-col items-center gap-3">
      {/* .sash-stage gives the panel real fabric texture: selvedge gradient,
          stitch line, woven-overlay and pointed hem — parity with TextEditor */}
      <div
        className="sash-stage"
        style={
          {
            "--sash-fabric-light": fabricColors.light,
            "--sash-fabric-base": fabricColors.base,
            "--sash-fabric-dark": fabricColors.dark,
          } as React.CSSProperties
        }
      >
        <div
          className="relative flex items-center justify-center overflow-hidden rounded-xl"
          style={{ width, height }}
        >
          {loading ? (
            <Spinner />
          ) : url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={label}
              width={width}
              height={height}
              className="block h-full w-full object-contain"
            />
          ) : (
            <span className="px-3 text-center text-xs text-ink-soft">
              لا يوجد تصميم لهذا الجانب
            </span>
          )}
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
        <div className="inline-flex gap-1 rounded-full border border-line bg-surface-sink p-1">
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
