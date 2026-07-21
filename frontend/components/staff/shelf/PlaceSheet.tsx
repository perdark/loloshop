"use client";

// Shared «سكّن القطعة» sheet. Used in two places:
//   1. التجهيز inbox — shelving a cap/شال that never passed الكوي.
//   2. الكوي hand-off — right after «إنهاء الكوي، نقل للتجهيز».
// The server suggests a خانة; this only confirms it or lets the worker pick another (D3).
// Skipping is always allowed — the piece becomes «بلا خانة» and stays fully packable (D4).

import { useMemo, useState } from "react";
import type { ShelfBoard, ShelfSuggestion } from "@/lib/shelf";

interface PlaceSheetProps {
  open: boolean;
  /** What we're shelving — used for the title only. */
  pieceLabel: string;
  studentName: string;
  suggestion: ShelfSuggestion | null;
  board: ShelfBoard | null;
  pieceType: string;
  busy?: boolean;
  onConfirm: (target?: { shelf_code: string; slot_index: number }) => void;
  onSkip: () => void;
  onClose: () => void;
}

export function PlaceSheet({
  open,
  pieceLabel,
  studentName,
  suggestion,
  board,
  pieceType,
  busy = false,
  onConfirm,
  onSkip,
  onClose,
}: PlaceSheetProps) {
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<{ shelf_code: string; slot_index: number } | null>(null);

  // Only the section this piece type belongs to — a robe can never go on the cap shelf,
  // so offering the whole shelf would just invite a 400 from the server.
  const slots = useMemo(() => {
    if (!board) return [];
    const section = board.sections.find((s) => s.piece_type === pieceType);
    if (!section) return [];
    const shelf = board.shelves.find((s) => s.code === section.shelf_code);
    if (!shelf) return [];
    return shelf.slots.filter(
      (s) => s.index >= section.slot_from && s.index <= section.slot_to,
    );
  }, [board, pieceType]);

  if (!open) return null;

  const target = chosen ?? (suggestion ? { shelf_code: suggestion.shelf_code, slot_index: suggestion.slot_index } : null);
  const targetCode = chosen
    ? `${chosen.shelf_code}${String(chosen.slot_index).padStart(2, "0")}`
    : suggestion?.slot_code ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="تسكين القطعة"
    >
      <div
        className="w-full max-w-lg rounded-t-3xl bg-[#FFF8F0] p-5 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 text-center">
          <p className="text-sm text-[#6b6356]">{studentName}</p>
          <h2 className="mt-1 text-xl font-extrabold text-[#1A1A1A]">
            أين نضع {pieceLabel}؟
          </h2>
        </div>

        {targetCode ? (
          <button
            type="button"
            onClick={() => setPicking((p) => !p)}
            className="mx-auto flex w-full flex-col items-center gap-1 rounded-2xl border-2 border-[#F47B42] bg-white px-6 py-6 transition active:scale-[.98]"
          >
            <span className="text-xs font-bold text-[#6b6356]">ضعها في الخانة</span>
            <span className="font-mono text-5xl font-black tracking-wider text-[#F47B42]" dir="ltr">
              {targetCode}
            </span>
            {suggestion?.over && !chosen ? (
              <span className="mt-1 rounded-full bg-[#9f382d] px-3 py-1 text-xs font-bold text-white">
                الخانة تجاوزت الحد — لكنها خانة نفس الطالب
              </span>
            ) : null}
            <span className="mt-2 text-xs text-[#6b6356] underline">تغيير الخانة</span>
          </button>
        ) : (
          <div className="rounded-2xl border-2 border-dashed border-[#bdb3a3] bg-white px-6 py-6 text-center">
            <p className="text-lg font-extrabold text-[#1A1A1A]">الرف ممتلئ</p>
            <p className="mt-1 text-sm text-[#6b6356]">
              ستبقى القطعة «بلا خانة» — وتقدر تغلّفها عادي، بس ما راح يكون إلها عنوان على الرف.
            </p>
          </div>
        )}

        {picking ? (
          <div className="mt-4 max-h-56 overflow-y-auto rounded-2xl border border-[#ded6c8] bg-white p-2">
            <div className="grid grid-cols-5 gap-2" dir="ltr">
              {slots.map((s) => {
                const isChosen =
                  chosen?.shelf_code === s.slot_code[0] && chosen?.slot_index === s.index;
                // Someone else's exclusive bin — the server would refuse it, so don't offer it.
                const blocked = s.mode === "exclusive" && s.count > 0 && !isChosen;
                return (
                  <button
                    key={s.slot_code}
                    type="button"
                    disabled={blocked}
                    onClick={() => {
                      setChosen({ shelf_code: s.slot_code[0], slot_index: s.index });
                      setPicking(false);
                    }}
                    className={[
                      "min-h-11 rounded-lg border px-1 py-2 font-mono text-xs font-bold transition",
                      isChosen
                        ? "border-[#F47B42] bg-[#F47B42] text-white"
                        : blocked
                          ? "cursor-not-allowed border-[#ded6c8] bg-[#f2ede4] text-[#bdb3a3]"
                          : "border-[#ded6c8] bg-white text-[#1A1A1A] hover:border-[#F47B42]",
                    ].join(" ")}
                    title={blocked ? `مشغولة — ${s.student_name ?? ""}` : undefined}
                  >
                    {s.slot_code}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            disabled={busy || !target}
            onClick={() => onConfirm(target ?? undefined)}
            className="min-h-12 flex-1 rounded-full bg-[#F47B42] font-extrabold text-white transition active:scale-[.98] disabled:opacity-40"
          >
            {busy ? "..." : "تم — سكّنها"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSkip}
            className="min-h-12 rounded-full border border-[#ded6c8] bg-white px-5 font-bold text-[#6b6356] transition active:scale-[.98] disabled:opacity-40"
          >
            تخطّي
          </button>
        </div>
      </div>
    </div>
  );
}
