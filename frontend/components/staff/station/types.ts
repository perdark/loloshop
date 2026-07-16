import type { StationZone } from "@/lib/staff-types";

/** Which production station the console is serving. */
export type StationKind = "embroidery" | "tailor" | "pressing";

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
