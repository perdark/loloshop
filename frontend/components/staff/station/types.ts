import type { PieceSpecRow, RobeMeasurements, StationZone } from "@/lib/staff-types";
import type { OrderStatus } from "@/lib/types";

/** Which production station the console is serving.
 *  'preparing' (التجهيز) reuses this station shell deliberately (owner 2026-08-05:
 *  «خلي عامل التجهيز مثله مثل واجهة عامل التطريز») — same students list, same sheet.
 *  Its ONE difference is that zones are read-only: the stitching is already done by
 *  the time a piece reaches التجهيز, and the backend exposes no zone-tick endpoint
 *  for it, so the preparer READS the artwork to verify the set and never ticks it. */
export type StationKind = "embroidery" | "tailor" | "pressing" | "preparing";

/** One piece of a student's checkout bundle, as the set view needs it. */
export interface SetPiece {
  id: string;
  status: OrderStatus;
  product_name: string;
}

/**
 * One work piece (an order) normalized for the station console, whatever the
 * backend source (production queue rows for التطريز/الكوي, tailor-queue rows
 * for الفصال).
 */
export interface StationPiece {
  id: string;
  studentId: string;
  studentName: string;
  productName: string;
  productType: string;
  /** Catalog product photo — «which item am I holding», shown beside the zone artwork. */
  productImageUrl: string | null;
  batchName: string | null;
  wholesalerName: string | null;
  universityName: string | null;
  department: string | null;
  studyType: string | null;
  source: "retail" | "wholesaler";
  deadline: string | null;
  createdAt: string;
  /** التطريز only — the piece's zone checklist (null for الفصال/الكوي). */
  zones: StationZone[] | null;
  /**
   * التجهيز only — what the garment IS (colour, fabric, cut, shape) plus the student's own
   * free-text lines. `null` for every other station, which never asks the question.
   * Deliberately separate from `zones`: those describe stitching, this describes the piece,
   * and on a queue that is 64% robes the second is usually the only thing there is to show.
   */
  spec: PieceSpecRow[] | null;
  /** التجهيز only — robe measurements, when the order carries them. */
  measurements: RobeMeasurements | null;
  /**
   * التجهيز only — every piece of the student's checkout bundle, this one included, with the
   * stage each is at. The preparer bags a SET; the queue is one row per piece, so without
   * this a set whose robe is still at التطريز looks exactly like a set of two (bug 8, part 4).
   * `null` at every other station, which packs nothing, and for a piece bought on its own.
   */
  setPieces: SetPiece[] | null;
  /** Backend-granted single-piece complete (الكوي uses can_advance; الفصال pending rows are always completable). */
  canComplete: boolean;
  /** Arabic label for the piece's complete action (backend edge label when available). */
  completeLabel: string;
}

/** A piece that advanced/completed during this session — kept visible in the open sheet as a ✓ row. */
export interface AdvancedGhost {
  piece: StationPiece;
  label: string;
}

/** Same resolution rule as DesignGallery: uploads are served by the API origin. */
export function resolveUploadUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  const base =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:4000";
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function isPieceOverdue(deadline: string | null): boolean {
  if (!deadline) return false;
  return new Date(deadline).getTime() < Date.now();
}

/** Arabic label for "this piece moved on" after an advance, keyed on the new status. */
export function advancedLabelFor(status: string): string {
  if (status === "pressing") return "انتقلت إلى الكوي";
  if (status === "preparing") return "انتقلت إلى التجهيز";
  if (status === "ready") return "أصبحت جاهزة";
  return "اكتملت";
}
