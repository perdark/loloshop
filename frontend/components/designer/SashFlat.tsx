"use client";

import { FabricPanelPreview } from "./FabricPanelPreview";
import { SASH_COLOR_HEX } from "@/lib/designer-colors";

const PANEL_W = 150;
const PANEL_H = 250;

const SIDE_LABEL: Record<"left" | "right", string> = {
  left: "اليسار (على الشاشة)",
  right: "اليمين (على الشاشة)",
};

const EMPTY_CTA: Record<"left" | "right", string> = {
  left: "اضغط لتصميم اليسار",
  right: "اضغط لتصميم اليمين",
};

function SashPanel({
  side,
  json,
  tilt,
  sashColor,
  readOnly,
  onClick,
}: {
  side: "left" | "right";
  json: unknown | null;
  tilt: number;
  sashColor: string;
  readOnly?: boolean;
  onClick?: (side: "left" | "right") => void;
}) {
  const colors = SASH_COLOR_HEX[sashColor] || SASH_COLOR_HEX["أبيض"];
  const inner = (
    <div
      className={`relative overflow-hidden border-2 shadow-md ${
        readOnly ? "" : "transition-all group-hover:-translate-y-0.5 group-hover:shadow-lg"
      }`}
      style={{
        width: PANEL_W,
        height: PANEL_H,
        clipPath: "polygon(0 0, 100% 0, 100% 88%, 50% 100%, 0 88%)",
        borderColor: colors.dark,
        background: json
          ? colors.base
          : `linear-gradient(150deg, ${colors.light}, ${colors.base} 55%, ${colors.dark})`,
      }}
    >
      {json ? <FabricPanelPreview json={json} sashColor={sashColor} width={PANEL_W} height={PANEL_H} /> : null}
      {!json && !readOnly && (
        <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center text-sm font-semibold text-ink/80">
          {EMPTY_CTA[side]}
        </span>
      )}
      <span
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.18) 48%, transparent 60%)",
        }}
      />
      {!readOnly && (
        <span className="pointer-events-none absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-orange/90 text-base text-white shadow group-hover:scale-110">
          ✎
        </span>
      )}
    </div>
  );

  if (readOnly) {
    return (
      <div className="flex flex-col items-center gap-1" style={{ transform: `rotate(${tilt}deg)`, transformOrigin: "top center" }}>
        {inner}
        <span className="text-xs text-ink/60">{SIDE_LABEL[side]}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onClick?.(side)}
      aria-label={SIDE_LABEL[side]}
      className="group min-h-11 min-w-11"
      style={{ transform: `rotate(${tilt}deg)`, transformOrigin: "top center" }}
    >
      {inner}
    </button>
  );
}

interface SashFlatProps {
  sashColor: string;
  leftJson: unknown | null;
  rightJson: unknown | null;
  onClickSide?: (side: "left" | "right") => void;
  readOnly?: boolean;
}

export function SashFlat({
  sashColor,
  leftJson,
  rightJson,
  onClickSide,
  readOnly = false,
}: SashFlatProps) {
  const colors = SASH_COLOR_HEX[sashColor] || SASH_COLOR_HEX["أبيض"];

  return (
    <div className="mx-auto flex max-w-md flex-col items-center">
      <svg viewBox="0 0 300 96" className="h-20 w-64" style={{ marginBottom: -10 }} aria-hidden>
        <defs>
          <linearGradient id="yokeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={colors.light} />
            <stop offset="1" stopColor={colors.base} />
          </linearGradient>
        </defs>
        <g transform="rotate(-30 150 18)">
          <rect x="132" y="10" width="36" height="92" rx="14" fill="url(#yokeFill)" stroke={colors.dark} strokeWidth="1.5" />
          <rect x="138" y="14" width="6" height="84" rx="3" fill="#ffffff" fillOpacity="0.22" />
        </g>
        <g transform="rotate(30 150 18)">
          <rect x="132" y="10" width="36" height="92" rx="14" fill="url(#yokeFill)" stroke={colors.dark} strokeWidth="1.5" />
          <rect x="138" y="14" width="6" height="84" rx="3" fill="#ffffff" fillOpacity="0.22" />
        </g>
        <ellipse cx="150" cy="20" rx="26" ry="14" fill={colors.dark} />
        <ellipse cx="150" cy="18" rx="22" ry="11" fill="url(#yokeFill)" stroke={colors.dark} strokeWidth="1" />
      </svg>

      <div className="flex flex-col items-center justify-center gap-6 sm:flex-row sm:items-start sm:gap-3">
        <SashPanel
          side="left"
          json={leftJson}
          tilt={-4}
          sashColor={sashColor}
          readOnly={readOnly}
          onClick={onClickSide}
        />
        <SashPanel
          side="right"
          json={rightJson}
          tilt={4}
          sashColor={sashColor}
          readOnly={readOnly}
          onClick={onClickSide}
        />
      </div>
    </div>
  );
}
