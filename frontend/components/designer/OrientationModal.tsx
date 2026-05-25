"use client";

import { Button } from "@/components/ui/Button";

export type Orientation = "vertical" | "horizontal";

interface Props {
  open: boolean;
  side: "left" | "right";
  current?: Orientation;
  onSelect: (o: Orientation) => void;
  onClose: () => void;
}

export function OrientationModal({
  open,
  side,
  current = "vertical",
  onSelect,
  onClose,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-cream p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-xl text-ink">
          {side === "left" ? "الجانب الأيسر" : "الجانب الأيمن"} — اتجاه التصميم
        </h3>
        <p className="mt-1 text-sm text-ink/70">
          اختر اتجاه الكتابة على الوشاح
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onSelect("vertical")}
            className={`flex flex-col items-center gap-3 rounded-xl border-2 p-4 transition-all ${
              current === "vertical"
                ? "border-orange bg-orange/10"
                : "border-ink/10 hover:border-ink/30"
            }`}
          >
            {/* Vertical icon: tall rectangle */}
            <svg viewBox="0 0 60 90" className="h-20 w-14">
              <rect
                x="10"
                y="5"
                width="40"
                height="80"
                rx="4"
                fill="#0b1e3f"
                fillOpacity="0.08"
                stroke="#0b1e3f"
                strokeWidth="1.5"
              />
              <text
                x="30"
                y="50"
                textAnchor="middle"
                fontSize="10"
                fill="#0b1e3f"
                fontFamily="serif"
                writingMode="tb"
                style={{ writingMode: "vertical-rl" }}
              >
                نص
              </text>
            </svg>
            <span className="text-sm font-semibold text-ink">عامودي</span>
            <span className="text-xs text-ink/60">
              يطول مع الوشاح
            </span>
          </button>

          <button
            type="button"
            onClick={() => onSelect("horizontal")}
            className={`flex flex-col items-center gap-3 rounded-xl border-2 p-4 transition-all ${
              current === "horizontal"
                ? "border-orange bg-orange/10"
                : "border-ink/10 hover:border-ink/30"
            }`}
          >
            {/* Horizontal icon: wide rectangle */}
            <svg viewBox="0 0 90 60" className="h-14 w-20">
              <rect
                x="5"
                y="20"
                width="80"
                height="20"
                rx="4"
                fill="#0b1e3f"
                fillOpacity="0.08"
                stroke="#0b1e3f"
                strokeWidth="1.5"
              />
              <text
                x="45"
                y="35"
                textAnchor="middle"
                fontSize="11"
                fill="#0b1e3f"
                fontFamily="serif"
              >
                نص أفقي
              </text>
            </svg>
            <span className="text-sm font-semibold text-ink">أفقي</span>
            <span className="text-xs text-ink/60">عرضاً على الوشاح</span>
          </button>
        </div>

        <div className="mt-5">
          <Button variant="ghost" fullWidth onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </div>
    </div>
  );
}
