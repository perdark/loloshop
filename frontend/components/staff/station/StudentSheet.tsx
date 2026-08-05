"use client";

// «عرض بالطلب» — the full-screen sheet for ONE student: his pending pieces with
// inline zone checkboxes (التطريز) or a single complete button (الفصال/الكوي),
// plus the pieces that advanced during this session as ✓ rows so the worker sees
// what just moved on. Rendered via portal (stacking-context safety — same fix as
// the calligraphy preview).

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { AdvancedGhost, StationKind, StationPiece } from "./types";
import { resolveUploadUrl } from "./types";
import { Lightbox } from "./Lightbox";
import { ZoneThumb } from "@/components/staff/ZoneThumb";
import { Button } from "@/components/ui/Button";

interface StudentSheetProps {
  kind: StationKind;
  studentName: string;
  batchName: string | null;
  /** جامعة · قسم · صباحي/مسائي for wholesaler students (null for retail / الفصال). */
  info?: string | null;
  pieces: StationPiece[];
  ghosts: AdvancedGhost[];
  /** Busy keys: piece id (complete) or `${id}:${zone}` (zone tick). */
  busyKeys: Set<string>;
  fromPath: string;
  /** Optional sticky footer — التجهيز puts «إنهاء كل القطع» here. Rendered only when
   *  supplied, so التطريز/الفصال/الكوي are untouched. */
  footer?: ReactNode;
  /** Shown in place of the complete button when the backend grants no advance. The
   *  default is a dead end by nature, so a caller that KNOWS where the action lives
   *  should say — التجهيز's «جاهزة» tab points at التفاصيل, where تأكيد التسليم collects
   *  the delivery method. Only that caller can tell the two cases apart: `kind` is the
   *  same for both of its tabs, and a piece still at التجهيز must not be told to
   *  confirm a delivery that has not happened. */
  noActionHint?: string;
  onClose: () => void;
  onTickZone: (piece: StationPiece, zoneKey: string, done: boolean) => void;
  onComplete: (piece: StationPiece) => void;
}

export function StudentSheet({
  kind,
  studentName,
  batchName,
  info,
  pieces,
  ghosts,
  busyKeys,
  fromPath,
  footer,
  noActionHint = "لا يمكن إكمال هذه القطعة من هنا حالياً.",
  onClose,
  onTickZone,
  onComplete,
}: StudentSheetProps) {
  const [lightbox, setLightbox] = useState<{ url: string; title: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (lightbox) setLightbox(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, onClose]);

  if (typeof document === "undefined") return null;

  const allDone = pieces.length === 0 && ghosts.length > 0;

  return createPortal(
    <div
      dir="rtl"
      lang="ar"
      className="fixed inset-0 z-[120] flex items-end justify-center bg-ink/45 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`قطع ${studentName}`}
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-surface shadow-2xl sm:max-w-lg sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3.5">
          <div className="min-w-0">
            <p className="truncate font-display-ar text-lg font-bold text-ink">{studentName}</p>
            <p className="mt-0.5 truncate text-xs text-ink-soft">
              {batchName ? `دفعة: ${batchName}` : "طلب تجزئة"}
              {" · "}
              {pieces.length > 0 ? `${pieces.length} قطعة بانتظار العمل` : "لا قطع متبقية"}
            </p>
            {info && <p className="mt-0.5 truncate text-xs text-ink-soft">{info}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-sink text-xl leading-none text-ink-soft transition-colors hover:text-ink"
          >
            ✕
          </button>
        </div>

        {/* Pieces */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {allDone && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-5 text-center">
              <p className="text-base font-bold text-emerald-700">أحسنت! اكتملت كل قطع هذا الطالب ✓</p>
            </div>
          )}

          {pieces.map((piece) => (
            <PieceCard
              key={piece.id}
              kind={kind}
              piece={piece}
              busyKeys={busyKeys}
              fromPath={fromPath}
              noActionHint={noActionHint}
              onTickZone={onTickZone}
              onComplete={onComplete}
              onOpenImage={(url, title) => setLightbox({ url, title })}
            />
          ))}

          {ghosts.map(({ piece, label }) => (
            <div
              key={piece.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3"
            >
              <p className="min-w-0 truncate text-sm font-semibold text-emerald-800">{piece.productName}</p>
              <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                {label} ✓
              </span>
            </div>
          ))}

          {pieces.length === 0 && ghosts.length === 0 && (
            <p className="py-8 text-center text-sm text-ink-soft">لا قطع لهذا الطالب حالياً.</p>
          )}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-line bg-surface px-4 py-3">{footer}</div>
        )}
      </div>

      {/* Zone-image lightbox */}
      {lightbox && (
        <Lightbox url={lightbox.url} title={lightbox.title} onClose={() => setLightbox(null)} />
      )}
    </div>,
    document.body
  );
}

function PieceCard({
  kind,
  piece,
  busyKeys,
  fromPath,
  noActionHint,
  onTickZone,
  onComplete,
  onOpenImage,
}: {
  kind: StationKind;
  piece: StationPiece;
  busyKeys: Set<string>;
  fromPath: string;
  noActionHint: string;
  onTickZone: (piece: StationPiece, zoneKey: string, done: boolean) => void;
  onComplete: (piece: StationPiece) => void;
  onOpenImage: (url: string, title: string) => void;
}) {
  // التطريز ticks its zones; التجهيز only READS them to verify the physical set.
  // `piece.zones` is already `StationZone[] | null` and that null is meaningful — it says
  // the backend never computed zones for this row, which is NOT the same as computing them
  // and finding none. Only the latter may claim «لا تطريز على هذه القطعة»; flattening with
  // `?? []` here would turn silence into a false claim on a piece that IS embroidered.
  const zones = kind === "embroidery" || kind === "preparing" ? piece.zones : null;
  const zonesReadOnly = kind === "preparing";
  const completeBusy = busyKeys.has(piece.id);
  const productPhoto = resolveUploadUrl(piece.productImageUrl);
  // التطريز auto-advances server-side when the last zone is ticked, so it shows a manual
  // complete ONLY when no zones were detected. التجهيز can never advance implicitly — its
  // zones are read-only — so it always needs its own button.
  const showComplete = zonesReadOnly || (zones !== null && zones.length === 0);

  return (
    <div className="rounded-2xl border border-line bg-surface shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
        {/* Catalog photo — «which item is this». Kept small and beside the name so it adds
            recognition without pushing the zone artwork (the real content) down the card. */}
        {productPhoto && (
          <ZoneThumb
            url={productPhoto}
            label={piece.productName}
            size={44}
            onOpen={onOpenImage}
          />
        )}
        <p className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink">{piece.productName}</p>
        <Link
          href={`/staff/orders/${piece.id}?from=${encodeURIComponent(fromPath)}`}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-line bg-beige px-5 text-sm font-bold text-ink transition-colors hover:border-orange/40 hover:text-orange-ink"
        >
          التفاصيل
        </Link>
      </div>

      {/* Zone list — a tickable checklist for التطريز, the same rows read-only for التجهيز */}
      {zones && zones.length > 0 && (
        <ul className="mt-2 divide-y divide-line/70 border-t border-line/70">
          {zones.map((z) => {
            const busy = busyKeys.has(`${piece.id}:${z.key}`);
            const img = resolveUploadUrl(z.image_url);
            return (
              <li key={z.key} className="flex items-center gap-3 px-4 py-2.5">
                {!zonesReadOnly && (
                  <button
                    type="button"
                    onClick={() => onTickZone(piece, z.key, !z.done)}
                    disabled={busy}
                    role="checkbox"
                    aria-checked={z.done}
                    aria-label={z.label}
                    className="flex min-h-11 min-w-11 items-center justify-center disabled:opacity-50"
                  >
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-lg border-2 text-base transition-colors ${
                        z.done ? "border-emerald-600 bg-emerald-600 text-white" : "border-ink/30"
                      }`}
                      aria-hidden
                    >
                      {busy ? "…" : z.done ? "✓" : ""}
                    </span>
                  </button>
                )}

                {zonesReadOnly ? (
                  // No tick target: التجهيز verifies, it does not stitch. The text is shown
                  // BESIDE the artwork on purpose — a zone can carry both, and the stitch
                  // text is exactly what the preparer compares against the piece in hand.
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{z.label}</p>
                    {z.text && (
                      <p className="mt-0.5 truncate text-xs text-ink-soft" title={z.text}>
                        {z.text}
                      </p>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onTickZone(piece, z.key, !z.done)}
                    disabled={busy}
                    className="min-w-0 flex-1 text-start disabled:opacity-60"
                  >
                    <p className={`text-sm font-semibold ${z.done ? "text-ink-soft line-through" : "text-ink"}`}>
                      {z.label}
                    </p>
                    {z.text && (
                      <p className="mt-0.5 truncate text-xs text-ink-soft" title={z.text}>
                        {z.text}
                      </p>
                    )}
                  </button>
                )}

                {img && (
                  <ZoneThumb url={img} label={z.label} size={44} onOpen={onOpenImage} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* No zones detected — the reason differs per station, so the copy does too. */}
      {zones && zones.length === 0 && (
        <p className="border-t border-line/70 px-4 pt-3 text-xs text-ink-soft">
          {zonesReadOnly
            ? "لا تطريز على هذه القطعة."
            : "لا مناطق محددة لهذه القطعة (تصميم على الكانفس) — أكملها يدوياً بعد التطريز."}
        </p>
      )}

      {/* One complete action per piece: الفصال/الكوي always, التجهيز always, التطريز only
          when it has no zones to auto-advance it. */}
      {(showComplete || !zones) && (
        <div className="px-4 py-3">
          {piece.canComplete ? (
            <Button size="sm" onClick={() => onComplete(piece)} loading={completeBusy} className="w-full">
              {piece.completeLabel}
            </Button>
          ) : (
            <p className="text-center text-xs text-ink-soft">{noActionHint}</p>
          )}
        </div>
      )}
    </div>
  );
}
