"use client";

// مواصفات القطعة — what the preparer needs to pull the right garment off the shelf.
//
// ⚠️ WHY THIS EXISTS. The التجهيز console shipped showing embroidery zones, and on the real
// queue that meant showing nothing: measured 2026-08-05, the 483 preparing+ready orders are
// 310 robes · 105 caps · 65 shawls · 3 sashes, and zones are a sash/cap concept. 325 of 326
// student cards correctly read «لا تطريز على هذه القطعة» and the screen was useless.
//
// The answer was never to loosen the zone detector — a robe genuinely has no embroidery. It
// was that the preparer is asking a DIFFERENT question. «ما هو التطريز؟» is the embroiderer's.
// «أي روب أرفعه من الرف؟» is theirs, and لون/قماش/فصال الروب answer it. Both sets of rows
// live in `order_items`; the spec ones were invisible only because they carry no text and no
// image, so every existing filter skipped them. Backend: buildPieceSpec.
//
// Coverage after this: 95.7% of a 400-order sample renders at least one spec row (median 1,
// max 5), against ~0.3% before.
//
// Kept deliberately dense — «التجهيز يحتاج ان يكون سريع جدا» (owner). Definition list, no
// cards, no icons: the worker scans it standing at a shelf with a garment in one hand.

import type { PieceSpecRow, RobeMeasurements } from "@/lib/staff-types";
import { resolveUploadUrl } from "@/components/staff/station/types";
import { ZoneThumb } from "@/components/staff/ZoneThumb";

/** `chest_cm` is 0 on effectively every live order — 0 means "not measured", not "0 cm". */
function cm(n: number | undefined | null): string | null {
  return typeof n === "number" && n > 0 ? `${n} سم` : null;
}

export function PieceSpec({
  spec,
  measurements,
  onOpenImage,
}: {
  spec: PieceSpecRow[] | null;
  measurements: RobeMeasurements | null;
  onOpenImage: (url: string, label: string) => void;
}) {
  const rows = spec ?? [];
  const notes = measurements?.tailor_notes?.trim() || null;
  const receipt = resolveUploadUrl(measurements?.receipt_image_url || null);
  // Same wording as the order detail page, so the preparer reads one vocabulary everywhere.
  const sizes: [string, string][] = measurements
    ? ([
        ["عرض الكتف", cm(measurements.shoulder_cm)],
        ["طول الروب", cm(measurements.robe_length_cm)],
        ["طول الردن", cm(measurements.sleeve_length_cm)],
        ["محيط الصدر", cm(measurements.chest_cm)],
      ] as [string, string | null][]).filter((p): p is [string, string] => p[1] !== null)
    : [];

  if (!rows.length && !sizes.length && !notes && !receipt) return null;

  return (
    <div className="border-t border-line/70 px-4 py-3">
      {rows.length > 0 && (
        // Flex rows, NOT a subgrid: this renders on whatever WebView the workshop's Android
        // phones ship with, and `grid-template-columns: subgrid` is too new to bet a
        // production station on. A fixed-basis label column gives the same aligned look.
        <dl className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.label} className="flex items-baseline gap-3">
              <dt className="w-[5.5rem] shrink-0 text-xs text-ink-soft">{r.label}</dt>
              <dd className="min-w-0 flex-1 text-[13.5px] font-bold text-ink">
                {r.value ?? ""}
                {/* The student's own words, kept verbatim and wrapped — these are
                    instructions («كسرة الكتف: كسرتين من فوك»), the most common line in the
                    whole queue, and truncating one would drop half a sentence. */}
                {r.text && (
                  <span className="block whitespace-pre-wrap font-semibold text-orange-ink">
                    {r.text}
                  </span>
                )}
                {r.image_url && (
                  <span className="mt-1 block">
                    <ZoneThumb
                      url={resolveUploadUrl(r.image_url) ?? r.image_url}
                      label={r.label}
                      size={40}
                      onOpen={onOpenImage}
                    />
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {sizes.length > 0 && (
        <div className={rows.length > 0 ? "mt-3 border-t border-line/50 pt-2.5" : ""}>
          <p className="mb-1 text-xs font-bold text-ink">قياسات الروب</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {sizes.map(([label, value]) => (
              <li key={label} className="text-xs text-ink-soft">
                {label}{" "}
                {/* Numerals + the unit read left-to-right inside the RTL line. */}
                <span dir="ltr" className="font-bold text-ink">
                  {value}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(notes || receipt) && (
        <div className="mt-2.5 flex items-start gap-2.5">
          {notes && (
            <p className="min-w-0 flex-1 whitespace-pre-wrap rounded-lg bg-beige px-2.5 py-2 text-xs text-ink">
              <span className="font-bold">ملاحظات الفصال: </span>
              {notes}
            </p>
          )}
          {receipt && (
            <ZoneThumb url={receipt} label="صورة الوصل" size={44} onOpen={onOpenImage} />
          )}
        </div>
      )}
    </div>
  );
}
