"use client";

// Zone 3 — the shelf map. Deliberately NOT the hero: it answers «وين القطعة الفلانية؟»,
// which is the third-most-important question on this screen.
//
// Two decisions that make this different from a plain grid:
//  1. Colour encodes WAITING-STATE, not occupancy — a bin is green when that student's set
//     is finally complete, amber while it still waits on a piece upstream. That turns dead
//     storage into a live status board.
//  2. Pieces render as stacked spines rather than a digit, so depth is legible at a glance.

import type { Shelf, ShelfSlot } from "@/lib/shelf";

const STATE_STYLE: Record<string, { bin: string; label: string }> = {
  empty: { bin: "border-[#4e4941] bg-[#302d28]", label: "text-[#817a70]" },
  ready: { bin: "border-[#639a7b] bg-[#244a38]", label: "text-white" },
  waiting: { bin: "border-[#b8892f] bg-[#463619]", label: "text-white" },
  over: { bin: "border-[#d4674f] bg-[#5a2a1f]", label: "text-white" },
  shared: { bin: "border-[#7d7bb5] bg-[#2f2d4a]", label: "text-white" },
};

function Spines({ count, max }: { count: number; max: number | null }) {
  // Cap the drawn spines so a 40-deep shared bin doesn't explode the layout.
  const drawn = Math.min(count, 12);
  const over = max != null && count > max;
  return (
    <div className="flex items-end gap-[2px]" aria-hidden="true">
      {Array.from({ length: drawn }, (_, i) => (
        <span
          key={i}
          className={[
            "w-[3px] rounded-sm",
            over ? "bg-[#ff9f70]" : "bg-[#d7cfc4]",
          ].join(" ")}
          style={{ height: `${10 + ((i * 7) % 9)}px` }}
        />
      ))}
      {count > drawn ? (
        <span className="ms-1 text-[9px] font-bold text-[#c8c0b6]">+{count - drawn}</span>
      ) : null}
    </div>
  );
}

interface ShelfMapProps {
  shelves: Shelf[];
  search: string;
  onSlotClick: (slot: ShelfSlot) => void;
}

export function ShelfMap({ shelves, search, onSlotClick }: ShelfMapProps) {
  const q = search.trim();

  return (
    <div className="rounded-2xl bg-[#211f1b] p-3 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-extrabold text-white">الرف</h3>
          <p className="mt-0.5 text-[11px] text-[#bdb6aa]">
            اضغط أي خانة لتشوف شنو بيها
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-[10px] text-[#bdb6aa]">
          {[
            ["ready", "الطقم كامل"],
            ["waiting", "ينتظر قطعة"],
            ["over", "فوق الحد"],
            ["shared", "خانة مشتركة"],
            ["empty", "فارغة"],
          ].map(([k, label]) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <i className={`h-2.5 w-2.5 rounded-sm border ${STATE_STYLE[k].bin}`} />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {shelves.map((shelf) => (
          <div key={shelf.code} className="flex gap-2">
            <div className="flex w-9 flex-none flex-col items-center justify-center rounded-lg border border-[#4e4941] bg-[#292621] py-2">
              <span className="text-lg font-black text-[#d7cfc4]">{shelf.code}</span>
              <span className="mt-0.5 text-[8px] text-[#8f887d]">
                {shelf.sections.map((s) => s.label_ar).join(" · ")}
              </span>
            </div>

            <div
              className="grid flex-1 gap-1.5"
              dir="ltr"
              style={{
                gridTemplateColumns: `repeat(${Math.min(shelf.slots.length, 15)}, minmax(0, 1fr))`,
              }}
            >
              {shelf.slots.map((slot) => {
                const style = STATE_STYLE[slot.state] ?? STATE_STYLE.empty;
                const hit =
                  q.length > 0 &&
                  slot.pieces.some((p) => p.student_name.includes(q));
                const dimmed = q.length > 0 && !hit;
                return (
                  <button
                    key={slot.slot_code}
                    type="button"
                    onClick={() => onSlotClick(slot)}
                    className={[
                      "flex min-h-[74px] flex-col justify-between rounded-lg border p-1.5 text-start transition",
                      style.bin,
                      hit ? "ring-2 ring-[#FFB100]" : "",
                      dimmed ? "opacity-30" : "",
                      "hover:-translate-y-0.5 hover:border-[#9b9285]",
                    ].join(" ")}
                    aria-label={
                      slot.count > 0
                        ? `الخانة ${slot.slot_code}: ${slot.count} قطعة، ${slot.student_name ?? "مشتركة"}`
                        : `الخانة ${slot.slot_code} فارغة`
                    }
                  >
                    <span className="font-mono text-[10px] font-black text-[#ded7cd]">
                      {slot.slot_code}
                    </span>
                    {slot.count > 0 ? (
                      <>
                        <Spines count={slot.count} max={slot.max} />
                        <span
                          className={`truncate text-[9px] font-bold ${style.label}`}
                          dir="rtl"
                        >
                          {slot.mode === "shared"
                            ? `${slot.count} شال`
                            : slot.student_name}
                        </span>
                      </>
                    ) : (
                      <span className="self-center text-lg font-light text-[#817a70]">+</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
