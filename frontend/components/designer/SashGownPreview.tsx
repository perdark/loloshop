"use client";

import { GownPanelImage } from "./GownPanelImage";
import { panelHasContent } from "@/lib/render-sash-panel";
import {
  GOWN_ASPECT_RATIO,
  GOWN_IMAGE_SRC,
  PREVIEW_PANEL_HEIGHT,
  PREVIEW_PANEL_WIDTH,
  SASH_CLIP_PATH,
  hotspotCssStyle,
} from "@/lib/gown-hotspots";

const SIDE_LABEL: Record<"left" | "right", string> = {
  left: "جانب الاسم",
  right: "جانب الجامعة",
};

const SIDE_CHIP: Record<"left" | "right", string> = {
  left: "جانب الاسم — اضغط للتصميم",
  right: "جانب الجامعة — اضغط للتصميم",
};

function GownSash({
  side,
  json,
  sashColor,
  fontsUsed,
  readOnly,
  onClick,
}: {
  side: "left" | "right";
  json: unknown | null;
  sashColor: string;
  fontsUsed?: string[];
  readOnly?: boolean;
  onClick?: (side: "left" | "right") => void;
}) {
  const showChip = !panelHasContent(json) && !readOnly;

  const inner = (
    <span
      className="sash-gown-panel relative block h-full w-full overflow-hidden"
      style={{ clipPath: SASH_CLIP_PATH }}
    >
      {panelHasContent(json) ? (
        <GownPanelImage
          key={
            json && typeof json === "object"
              ? JSON.stringify((json as { objects?: unknown[] }).objects ?? [])
              : "empty"
          }
          json={json}
          sashColor={sashColor}
          width={PREVIEW_PANEL_WIDTH}
          height={PREVIEW_PANEL_HEIGHT}
          fontsUsed={fontsUsed}
        />
      ) : null}
      {showChip ? (
        <span
          className="pointer-events-none absolute inset-x-0 bottom-[8%] z-10 mx-auto max-w-[95%] rounded-full bg-ink/75 px-2 py-1 text-center text-[10px] leading-tight font-medium text-cream shadow-sm"
          aria-hidden
        >
          {SIDE_CHIP[side]}
        </span>
      ) : null}
    </span>
  );

  const style = hotspotCssStyle(side);

  if (readOnly) {
    return <span style={style}>{inner}</span>;
  }

  return (
    <button
      type="button"
      onClick={() => onClick?.(side)}
      aria-label={SIDE_LABEL[side]}
      className="group min-h-11 min-w-11 cursor-pointer transition-transform hover:scale-[1.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange"
      style={style}
    >
      {inner}
    </button>
  );
}

interface SashGownPreviewProps {
  sashColor: string;
  leftJson: unknown | null;
  rightJson: unknown | null;
  fontsUsed?: string[];
  onClickSide?: (side: "left" | "right") => void;
  readOnly?: boolean;
}

export function SashGownPreview({
  sashColor,
  leftJson,
  rightJson,
  fontsUsed,
  onClickSide,
  readOnly = false,
}: SashGownPreviewProps) {
  return (
    <div
      className="relative mx-auto w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-sm"
      style={{ aspectRatio: GOWN_ASPECT_RATIO }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={GOWN_IMAGE_SRC}
        alt="روب وأوشحة التخرج"
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />
      <GownSash
        side="left"
        json={leftJson}
        sashColor={sashColor}
        fontsUsed={fontsUsed}
        readOnly={readOnly}
        onClick={onClickSide}
      />
      <GownSash
        side="right"
        json={rightJson}
        sashColor={sashColor}
        fontsUsed={fontsUsed}
        readOnly={readOnly}
        onClick={onClickSide}
      />
    </div>
  );
}
