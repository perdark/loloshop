"use client";

import { useEffect, useRef } from "react";
import type { Orientation } from "./OrientationModal";

const COLOR_HEX: Record<string, { base: string; light: string; dark: string }> = {
  "أبيض": { base: "#f8f8f6", light: "#ffffff", dark: "#e6e6e0" },
  "رمادي فاتح": { base: "#c8c8c8", light: "#dcdcdc", dark: "#a8a8a8" },
  "أخضر داكن": { base: "#1f4e3d", light: "#2d6a52", dark: "#143528" },
  "أسود": { base: "#111111", light: "#2a2a2a", dark: "#000000" },
  "كحلي": { base: "#0b1e3f", light: "#162e57", dark: "#050f23" },
  "عنابي": { base: "#7a1f2b", light: "#9a2b3a", dark: "#561218" },
};

const SIDE_LABEL: Record<"left" | "right", string> = {
  left: "الأيسر",
  right: "الأيمن",
};

interface ThumbProps {
  json: unknown | null;
  sashColor: string;
  orientation: Orientation;
}

function Thumb({ json, sashColor, orientation }: ThumbProps) {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricRef = useRef<any>(null);

  const isHorizontal = orientation === "horizontal";
  const w = isHorizontal ? 220 : 120;
  const h = isHorizontal ? 120 : 220;
  const sourceW = isHorizontal ? 600 : 360;

  useEffect(() => {
    if (!canvasElRef.current) return;
    let disposed = false;

    (async () => {
      const fabric = await import("fabric");
      if (disposed || !canvasElRef.current) return;
      const bg = COLOR_HEX[sashColor]?.base || "#f8f8f6";
      const canvas = new fabric.StaticCanvas(canvasElRef.current, {
        width: w,
        height: h,
        backgroundColor: bg,
      });
      fabricRef.current = canvas;
      if (json) {
        try {
          await canvas.loadFromJSON(json as Record<string, unknown>);
          canvas.setZoom(w / sourceW);
          canvas.backgroundColor = bg;
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
    <canvas
      ref={canvasElRef}
      className="rounded-md shadow-md ring-1 ring-ink/10"
    />
  );
}

interface SashFlatProps {
  sashColor: string;
  leftJson: unknown | null;
  rightJson: unknown | null;
  leftOrientation: Orientation;
  rightOrientation: Orientation;
  onClickSide: (side: "left" | "right") => void;
}

export function SashFlat({
  sashColor,
  leftJson,
  rightJson,
  leftOrientation,
  rightOrientation,
  onClickSide,
}: SashFlatProps) {
  const colors = COLOR_HEX[sashColor] || COLOR_HEX["أبيض"];

  return (
    <div className="flex flex-col items-center gap-6">
      {/* V-shaped sash visual */}
      <div className="relative w-full max-w-[420px]">
        <svg
          viewBox="0 0 420 540"
          className="block w-full drop-shadow-xl"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="rightGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={colors.dark} />
              <stop offset="40%" stopColor={colors.base} />
              <stop offset="70%" stopColor={colors.light} />
              <stop offset="100%" stopColor={colors.dark} />
            </linearGradient>
            <linearGradient id="leftGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={colors.dark} />
              <stop offset="30%" stopColor={colors.light} />
              <stop offset="60%" stopColor={colors.base} />
              <stop offset="100%" stopColor={colors.dark} />
            </linearGradient>
            <linearGradient id="brandTrimGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#FF8C00" />
              <stop offset="100%" stopColor="#FFA07A" />
            </linearGradient>
            <filter id="sheen">
              <feGaussianBlur stdDeviation="0.5" />
            </filter>
          </defs>

          {/* Right strip (right shoulder, drapes down to right) */}
          <g
            onClick={() => onClickSide("right")}
            style={{ cursor: "pointer" }}
            className="transition-transform hover:scale-[1.02]"
          >
            <path
              d="M 205 50 L 230 50 L 345 500 L 305 500 Z"
              fill="url(#rightGrad)"
              stroke="#000"
              strokeOpacity="0.15"
              strokeWidth="0.5"
              filter="url(#sheen)"
            />
            {/* Gold inner trim */}
            <path
              d="M 210 60 L 224 60 L 332 488 L 314 488 Z"
              fill="none"
              stroke="url(#brandTrimGrad)"
              strokeWidth="1.2"
              strokeOpacity="0.6"
            />
            {/* Tassel hint at bottom */}
            <g stroke="url(#brandTrimGrad)" strokeWidth="1.5" strokeLinecap="round">
              <line x1="312" y1="500" x2="308" y2="525" />
              <line x1="322" y1="500" x2="322" y2="528" />
              <line x1="332" y1="500" x2="336" y2="525" />
            </g>
          </g>

          {/* Left strip (left shoulder, drapes down to left) */}
          <g
            onClick={() => onClickSide("left")}
            style={{ cursor: "pointer" }}
            className="transition-transform hover:scale-[1.02]"
          >
            <path
              d="M 190 50 L 215 50 L 115 500 L 75 500 Z"
              fill="url(#leftGrad)"
              stroke="#000"
              strokeOpacity="0.15"
              strokeWidth="0.5"
              filter="url(#sheen)"
            />
            <path
              d="M 196 60 L 209 60 L 106 488 L 88 488 Z"
              fill="none"
              stroke="url(#brandTrimGrad)"
              strokeWidth="1.2"
              strokeOpacity="0.6"
            />
            <g stroke="url(#brandTrimGrad)" strokeWidth="1.5" strokeLinecap="round">
              <line x1="88" y1="500" x2="84" y2="525" />
              <line x1="98" y1="500" x2="98" y2="528" />
              <line x1="108" y1="500" x2="112" y2="525" />
            </g>
          </g>

          {/* Gold knot at neck (top center) — drawn last to overlap strips */}
          <g>
            <ellipse
              cx="210"
              cy="50"
              rx="32"
              ry="14"
              fill="url(#brandTrimGrad)"
              stroke="#7a5a20"
              strokeWidth="0.8"
            />
            <ellipse
              cx="210"
              cy="46"
              rx="20"
              ry="6"
              fill="#f4d896"
              opacity="0.6"
            />
            <path
              d="M 195 55 Q 210 70 225 55"
              stroke="#7a5a20"
              strokeWidth="1"
              fill="none"
            />
          </g>

          {/* Hover badges */}
          <g pointerEvents="none">
            <text
              x="100"
              y="280"
              textAnchor="middle"
              fontSize="14"
              fill={sashColor === "أبيض" || sashColor === "رمادي فاتح" ? "#0b1e3f" : "#faf7f0"}
              fontFamily="serif"
              fontWeight="600"
              opacity="0.85"
              transform="rotate(75 100 280)"
            >
              {leftJson ? "" : "اضغط للتصميم"}
            </text>
            <text
              x="320"
              y="280"
              textAnchor="middle"
              fontSize="14"
              fill={sashColor === "أبيض" || sashColor === "رمادي فاتح" ? "#0b1e3f" : "#faf7f0"}
              fontFamily="serif"
              fontWeight="600"
              opacity="0.85"
              transform="rotate(-75 320 280)"
            >
              {rightJson ? "" : "اضغط للتصميم"}
            </text>
          </g>
        </svg>
      </div>

      {/* Thumbnails — show what's been designed on each side */}
      <div className="flex w-full max-w-[420px] items-start justify-center gap-6">
        <button
          type="button"
          onClick={() => onClickSide("right")}
          className="group flex flex-col items-center gap-2"
        >
          <Thumb
            json={rightJson}
            sashColor={sashColor}
            orientation={rightOrientation}
          />
          <span className="text-xs font-semibold text-ink">
            {SIDE_LABEL.right}
            <span className="text-ink/50"> • {rightOrientation === "horizontal" ? "أفقي" : "عامودي"}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => onClickSide("left")}
          className="group flex flex-col items-center gap-2"
        >
          <Thumb
            json={leftJson}
            sashColor={sashColor}
            orientation={leftOrientation}
          />
          <span className="text-xs font-semibold text-ink">
            {SIDE_LABEL.left}
            <span className="text-ink/50"> • {leftOrientation === "horizontal" ? "أفقي" : "عامودي"}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
