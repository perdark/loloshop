import { api } from "./api";

// رف التجهيز — typed wrappers over /api/production/shelf.
// Shapes mirror backend/lib/shelf.js buildBoard() exactly. Retail-only scoping and every
// transition rule live server-side; this layer never re-derives them.

export type ShelfMode = "exclusive" | "shared";
export type PieceType = "robe" | "sash" | "cap" | "shawl";
/** Bin colour semantics: waiting-STATE, not occupancy. */
export type SlotState = "empty" | "ready" | "waiting" | "over" | "shared";
export type SetState = "ready" | "waiting";

export interface ShelfSection {
  id: number;
  shelf_code: string;
  piece_type: PieceType;
  label_ar: string;
  slot_count: number;
  max_per_slot: number | null;
  mode: ShelfMode;
  sort_order: number;
  slot_from: number;
  slot_to: number;
}

/** Every word the student typed on a piece (embroidery text + free-text option answers),
 *  flattened server-side for the search box. Never displayed — it is a search index. */
type Searchable = { search_text: string | null };

export interface ShelfSlotPiece extends Searchable {
  order_id: string;
  piece_type: PieceType;
  piece_label: string;
  /** Whose piece — carried on the PIECE because a communal خانة has no owner of its own.
   *  This is what lets one matched sash light up its student's robe and cap bins too. */
  student_id: string;
  student_name: string;
  placed_at: string | null;
}

export interface ShelfSlot {
  index: number;
  slot_code: string;
  section_id: number;
  piece_type: PieceType;
  piece_label: string;
  mode: ShelfMode;
  max: number | null;
  student_id: string | null;
  student_name: string | null;
  count: number;
  over: boolean;
  state: SlotState;
  waiting_for: string[];
  opened_at: string | null;
  pieces: ShelfSlotPiece[];
}

export interface Shelf {
  code: string;
  sections: ShelfSection[];
  slots: ShelfSlot[];
}

export interface ShelfSetPiece extends Searchable {
  order_id: string;
  piece_type: PieceType;
  piece_label: string;
  product_name: string | null;
  status: string;
  stage_ar: string;
  slot_code: string | null;
  placed_at: string | null;
}

export interface ShelfSet {
  set_key: string;
  student_id: string;
  student_name: string;
  university_name: string | null;
  department: string | null;
  state: SetState;
  waiting_for: string[];
  pieces: ShelfSetPiece[];
}

export interface ShelfSuggestion {
  shelf_code: string;
  slot_index: number;
  slot_code: string;
  over: boolean;
}

export interface ShelfInboxItem extends Searchable {
  order_id: string;
  student_id: string;
  student_name: string;
  piece_type: PieceType;
  piece_label: string;
  product_name: string | null;
  /** null = «بلا خانة» — the section is full. The piece is still packable. */
  suggestion: ShelfSuggestion | null;
}

/** A piece taken off the shelf. Collecting advances it to «جاهز», so it leaves every other list. */
export interface ShelfCollectedItem extends Searchable {
  order_id: string;
  set_key: string;
  student_id: string;
  student_name: string;
  piece_type: PieceType;
  piece_label: string;
  /** The خانة it came out of. */
  slot_code: string | null;
  collected_at: string;
  status: string;
  stage_ar: string;
  /** Undo is only offered before the piece is handed over (still at ready). */
  can_undo: boolean;
}

export interface ShelfBoard {
  sections: ShelfSection[];
  shelves: Shelf[];
  sets: ShelfSet[];
  inbox: ShelfInboxItem[];
  collected: ShelfCollectedItem[];
}

export interface PlaceResult {
  slot_code: string;
  shelf_code: string;
  slot_index: number;
  /** true = the piece went into the student's own bin past its max (allowed, flagged red). */
  over: boolean;
}

export async function getShelfBoard(): Promise<ShelfBoard> {
  const res = await api.get("/production/shelf");
  return res.data.data;
}

/** Omit `target` to accept the server's suggestion. */
export async function placePiece(
  orderId: string,
  target?: { shelf_code: string; slot_index: number },
): Promise<PlaceResult> {
  const res = await api.post("/production/shelf/place", {
    order_id: orderId,
    ...(target ? { shelf_code: target.shelf_code, slot_index: target.slot_index } : {}),
  });
  return res.data.data;
}

export async function collectPiece(
  orderId: string,
): Promise<{ advanced_ids: string[]; set_closed: boolean }> {
  const res = await api.post("/production/shelf/collect", { order_id: orderId });
  return res.data.data;
}

export async function closeSet(setKey: string): Promise<{ advanced_ids: string[] }> {
  const res = await api.post("/production/shelf/close-set", { set_key: setKey });
  return res.data.data;
}

export async function releasePlacement(orderId: string): Promise<{ released: boolean }> {
  const res = await api.delete(`/production/shelf/placement/${orderId}`);
  return res.data.data;
}

export async function updateShelfSection(
  id: number,
  patch: { slot_count?: number; max_per_slot?: number | null },
): Promise<{ id: number; slot_count: number; max_per_slot: number | null }> {
  const res = await api.patch(`/production/shelf/sections/${id}`, patch);
  return res.data.data;
}
