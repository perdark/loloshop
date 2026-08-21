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
  /**
   * Whose piece this is. NOT cosmetic — it is what lets the picker tell a bin it must refuse
   * (a stranger's) from the one bin a second piece is SUPPOSED to go into (this student's
   * own). Without it the picker blocks every occupied خانة and the worker can never place
   * more than one piece in a bin by hand.
   */
  studentId: string | null;
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
  studentId,
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
  const section = useMemo(
    () => board?.sections.find((s) => s.piece_type === pieceType) ?? null,
    [board, pieceType],
  );
  const slots = useMemo(() => {
    if (!board || !section) return [];
    const shelf = board.shelves.find((s) => s.code === section.shelf_code);
    if (!shelf) return [];
    return shelf.slots.filter(
      (s) => s.index >= section.slot_from && s.index <= section.slot_to,
    );
  }, [board, section]);
  // A communal section (شال, and وشاح since 2026-08-21) has no per-student bins, so every
  // message about «خانة نفس الطالب» is nonsense there and the useful fact is fullness.
  const communal = section?.mode === "shared";

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
                {communal
                  ? "كل الخانات وصلت حدها — حطها بأي وحدة وخبّر الإدارة"
                  : "الخانة تجاوزت الحد — لكنها خانة نفس الطالب"}
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
                // THIS student's own bin. A bin belongs to one student (D2), and D4 says a
                // second piece of theirs goes in beside the first — past the max is allowed
                // and merely flagged. placePiece() implements exactly that: it only 409s when
                // the open bin belongs to somebody ELSE.
                const ownBin =
                  s.mode === "exclusive" && studentId != null && s.student_id === studentId;
                // Someone else's exclusive bin — the server would refuse it, so don't offer it.
                // ⚠️ This used to be `s.count > 0` with no owner check, which also greyed out
                // the student's OWN خانة — so «تغيير الخانة» could never place a second piece
                // anywhere, even though the server accepts it. That was the whole «ما يقبل
                // أكثر من قطعة» bug: the guard is about WHOSE bin it is, never how full it is.
                const blocked = s.mode === "exclusive" && s.count > 0 && !ownBin && !isChosen;
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
                          : ownBin
                            // Own bin: pickable, and marked — so an occupied-looking خانة
                            // reads as «this is the one to add to», not as a mistake.
                            ? "border-[#639a7b] bg-[#e5f0e9] text-[#256347] hover:border-[#F47B42]"
                            : "border-[#ded6c8] bg-white text-[#1A1A1A] hover:border-[#F47B42]",
                    ].join(" ")}
                    title={
                      blocked
                        ? `مشغولة — ${s.student_name ?? ""}`
                        : s.mode === "shared"
                          ? `خانة مشتركة — فيها ${s.count} ${s.piece_label}`
                          : ownBin
                            ? `خانة ${s.student_name ?? studentName} — فيها ${s.count} قطعة`
                            : undefined
                    }
                  >
                    <span className="block">{s.slot_code}</span>
                    {/* Communal bins are the ones a worker CHOOSES between, so they carry the
                        only number that helps: how full each one already is. Exclusive bins
                        are decided by ownership, where a count would say nothing. */}
                    {s.mode === "shared" && s.max != null ? (
                      <span className="mt-0.5 block text-[9px] font-normal opacity-70">
                        {s.count}/{s.max}
                      </span>
                    ) : null}
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
