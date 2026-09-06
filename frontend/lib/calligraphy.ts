import { api } from "@/lib/api";

export type CalSource = "typed" | "wholesaler" | "retail";
export type CalVariant = "front" | "back" | "cap" | "cap_side";

export const VARIANT_LABEL: Record<CalVariant, string> = {
  front: "أمامي",
  back: "خلفي",
  cap: "قبعة — أعلى",
  cap_side: "قبعة — جانب",
};

export interface CalPlate {
  id: string;
  /**
   * Which generation batch this plate came from. The grid holds the CURRENT job's plates plus
   * the 60 newest done plates shop-wide (`getRecentPlates`, so the page survives a refresh),
   * so this is the only thing that tells «my batch» from «somebody else's earlier batch».
   * Without it «تنزيل إلى مجلد…» saved both and the designer got other reps' students.
   */
  job_id?: string | null;
  render_text: string;
  status: "pending" | "done" | "failed";
  plate_path: string | null;
  sheet_path: string | null;
  student_id: string | null;
  order_item_id: string | null;
  linked: boolean;
  cost_usd: number;
  error: string | null;
  variant: CalVariant;
  element_text: string | null;
  /** Style id from the closed list, or null for the shop default (migration 083). */
  style?: string | null;
  /** Paid regenerations already spent on this plate. The server refuses past CAL_REROLL_LIMIT. */
  reroll_count?: number;
  /**
   * `render_text` reads as a message to the shop, not a name («نفس الصوره»). Classified
   * server-side so this screen and the queue can never disagree. Rerolling one of these
   * without correcting the text just buys another picture of the same wrong words.
   */
  text_is_instruction?: boolean;
  /** Order context (attached server-side when the plate belongs to an order line). */
  order_id?: string | null;
  order_status?: string | null;
  zone_label?: string | null;
  student_name?: string | null;
  product_name?: string | null;
  product_type?: string | null;
  wholesaler_id?: string | null;
  wholesaler_name?: string | null;
}

export interface CalJob {
  job_id: string;
  total: number;
  done: number;
  failed: number;
  pending: number;
  job_cost: number;
  /** Names the server refused to generate — junk, or a message written to the shop. */
  dropped?: string[];
  /**
   * Retail only: text that reads as an instruction but was generated anyway, because a
   * designer typed it on the review board and that review is the authority («تجزئة = review
   * first, then generate»). Worth showing so a slip is still visible.
   */
  warned?: string[];
  plates: CalPlate[];
}

export interface CalProcess {
  processed: number;
  total: number;
  done: number;
  failed: number;
  pending: number;
  remaining: number;
  job_cost: number;
  review?: boolean;
  /** How many generation attempts this batch took (1 = clean first try). */
  attempts?: number;
  plates: CalPlate[];
}

export interface CalWholesaler {
  id: string;
  name: string;
  student_count: number;
}

export interface CalGrabRow {
  student_id: string;
  student_name: string;
  order_item_id: string;
  render_text: string;
  plate_id: string | null;
  plate_status: string | null;
  plate_path: string | null;
  linked: boolean;
  variant: CalVariant;
  /**
   * This row's text is a message to the shop, not a name — classified server-side. The grab
   * list is raw `customer_text`, so «لصق أسماء» was the route these strings took into the
   * paid generator.
   */
  text_is_instruction?: boolean;
  /**
   * The student's OWN uploaded reference (never the generated plate — migration 080).
   * 85% of the lines that read as instructions are talking about this image, and the designer
   * used to have to open the order to see it.
   */
  customer_image_url?: string | null;
}

/** One entry of the CLOSED style list — served by the API so this file never holds a
 *  second copy of `backend/lib/calligraphyStyles.js` to drift from. */
export interface CalStyle {
  id: string;
  label: string;
  hint: string;
}

/** What the reading layer proposes for one line. Nothing is generated until a designer
 *  presses «استخدم» — a suggestion is a draft, never an instruction to spend. */
export interface CalSuggestion {
  order_item_id: string;
  /** The text to embroider, or null when the line genuinely holds no name. */
  text: string | null;
  element: string | null;
  style: string | null;
  /**
   * What the line IS, which decides what the designer can do with it:
   * `name` there is text · `letter` the student points at a letter/shape («ميم مثل الصورة» —
   * never offered as text, it would be stitched as a three-letter word) · `photo` the attached
   * image is the design (the embroidery station already falls back to it) · `unclear` someone
   * has to ask the student.
   */
  kind: "name" | "letter" | "photo" | "unclear";
  note: string;
  original_text: string;
}

export interface CreateJobItem {
  render_text: string;
  student_id?: string | null;
  order_item_id?: string | null;
  variant?: CalVariant;
  element_text?: string | null;
  /** Style id from the closed list (`getCalStyles`). Plates are batched by (zone, style), so a
   *  styled name still rides a shared sheet — it does not buy a private image. */
  style?: string | null;
  /**
   * «A designer read THIS line and typed this text.» Per-line twin of the job-level
   * `reviewed` below — set on the ممثل lines the designer corrected in the grab list, so
   * the instruction guard lets them through without also waving through the untouched
   * lines riding in the same batch.
   */
  reviewed?: boolean;
}

export interface CreateJobBody {
  source: CalSource;
  model?: "standard" | "premium";
  wholesaler_id?: string | null;
  variant?: CalVariant;
  items: CreateJobItem[];
  /**
   * «A human has read these exact strings and wants them generated.» Downgrades the
   * instruction guard from blocking to warning — the same treatment `source: "retail"` gets
   * for free, because that board IS a review step.
   *
   * The escape hatch exists because no word list is perfect: a sash verse containing «أريد»
   * (﴿إن أريد إلا الإصلاح﴾) reads exactly like a request. Without this, a wrong guess would
   * silently strand real work in «موقوف» — which is the very failure mode bug 6 describes.
   * Never set it for a bulk generate the designer has not looked at line by line.
   */
  reviewed?: boolean;
}

/** Below this, the UI warns (a sheet costs the same whether it holds 1 or 10 names). */
export const MIN_BATCH = 10;

// Mirrors the backend `isRealName`: a real embroiderable name has ≥2 Arabic letters,
// so pure numbers / Latin / emoji / single chars are flagged and never generated.
const ARABIC_LETTER = /[ء-يٱ-ۓۺ-ۼ]/g;
export function isRealName(text: string): boolean {
  const m = (text || "").match(ARABIC_LETTER);
  return !!m && m.length >= 2;
}

const API_BASE =
  (process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:4000");

/** Guard for relative plate paths — stored paths are absolute public URLs already. */
export function absUrl(p: string | null): string {
  if (!p) return "";
  return p.startsWith("http") ? p : `${API_BASE}${p}`;
}

export async function getCalWholesalers(): Promise<CalWholesaler[]> {
  const { data } = await api.get<{ data: CalWholesaler[] }>("/calligraphy/wholesalers");
  return data.data;
}

export async function getCalNames(id: string): Promise<CalGrabRow[]> {
  const { data } = await api.get<{ data: CalGrabRow[] }>(
    `/calligraphy/wholesalers/${id}/names`
  );
  return data.data;
}

export async function getCalStyles(): Promise<CalStyle[]> {
  const { data } = await api.get<{ data: CalStyle[] }>("/calligraphy/styles");
  return data.data;
}

/**
 * Ask the reading layer what these lines mean. Costs ~$0.00006 a line (text, not an image) and
 * generates nothing. Only ids travel — the server reads the text from the order line itself, so
 * this can never be used to put arbitrary text in front of the model on the shop's bill.
 */
export async function suggestCalText(
  orderItemIds: string[]
): Promise<{ items: CalSuggestion[]; cost_usd: number; unchanged: number }> {
  const { data } = await api.post<{
    data: { items: CalSuggestion[]; cost_usd: number; unchanged: number };
  }>("/calligraphy/suggest", { order_item_ids: orderItemIds });
  return data.data;
}

export async function createCalJob(body: CreateJobBody): Promise<CalJob> {
  const { data } = await api.post<{ data: CalJob }>("/calligraphy/jobs", body);
  return data.data;
}

export async function processCalJob(jobId: string): Promise<CalProcess> {
  const { data } = await api.post<{ data: CalProcess }>(
    `/calligraphy/jobs/${jobId}/process`
  );
  return data.data;
}

export async function getCalJob(jobId: string): Promise<CalJob> {
  const { data } = await api.get<{ data: CalJob }>(`/calligraphy/jobs/${jobId}`);
  return data.data;
}

/**
 * Server-side cap on paid regenerations per plate — mirrors REROLL_LIMIT in
 * backend/controllers/calligraphyController.js. Past it the endpoint 429s.
 */
export const CAL_REROLL_LIMIT = 10;

/**
 * Regenerate one plate. `overrides` is how a designer corrects a line whose stored
 * `render_text` is an instruction rather than a name («نفس الصوره») — rerolling without it
 * just buys another picture of the same wrong words. The corrected text is saved onto the
 * plate, so the queue and the artwork stop disagreeing.
 */
export async function rerollPlate(
  id: string,
  overrides?: { render_text?: string; element_text?: string | null; variant?: CalVariant }
): Promise<CalPlate> {
  const { data } = await api.post<{ data: CalPlate }>(
    `/calligraphy/plates/${id}/reroll`,
    overrides ?? {}
  );
  return data.data;
}

// ─── Order send («تحويل للتطريز») + zone status ─────────────────────────────
// «ربط بالطلب» is gone — plates auto-attach on generation. The only manual action
// is pushing the whole ORDER out of بانتظار التصميم; label comes from the backend.

export interface CalZone {
  key: string;
  label: string;
  /** Artwork of any kind is attached — plate OR the student's photo. Drives the send gate. */
  has_image: boolean;
  /** A generated plate is attached (migration 080). */
  has_plate?: boolean;
  /** The student uploaded a reference photo for this zone (migration 080). */
  has_photo?: boolean;
}

export interface CalOrderZones {
  order_id: string;
  order_status: string;
  zones: CalZone[];
  can_send: boolean;
  next_stage: string | null;
  send_label: string | null;
  /**
   * Why this order may NOT be pushed out of التصميم — «بانتظار موافقة الممثل» or
   * «مُرجَع للطالب». The workbench has no approval filter of its own, so before this the
   * button was offered, the send succeeded, and the order landed at التطريز where no
   * station queue could show it. Now the server refuses AND says so here.
   */
  blocked_reason?: string | null;
}

export async function getOrdersZones(ids: string[]): Promise<CalOrderZones[]> {
  if (!ids.length) return [];
  const out: CalOrderZones[] = [];
  // Backend caps 100 ids per call — chunk defensively.
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data } = await api.get<{ data: CalOrderZones[] }>(
      `/calligraphy/orders-zones?ids=${chunk.join(",")}`
    );
    out.push(...data.data);
  }
  return out;
}

export async function sendCalOrder(
  orderId: string
): Promise<{ ok: boolean; order_id: string; status: string }> {
  const { data } = await api.post<{ data: { ok: boolean; order_id: string; status: string } }>(
    `/calligraphy/orders/${orderId}/send`
  );
  return data.data;
}

/** ZIP fallback for browsers without the File System Access folder picker. */
export async function platesZipBlob(ids: string[]): Promise<Blob> {
  const { data } = await api.post(`/calligraphy/plates/zip`, { ids }, { responseType: "blob" });
  return data as Blob;
}

/**
 * The whole job as a ZIP. Fetched through axios — NOT linked to.
 *
 * ⚠️ This used to be `calDownloadUrl()`, handed to `window.location.href`. Every
 * `/calligraphy/*` route is behind `authRequired`, which reads the Bearer header only,
 * and a browser navigation sends no headers: the designer got `401 غير مصرح` rendered as
 * a blank page WHERE THE WORKBENCH USED TO BE. Keep the token on the request — see
 * `lib/download.ts` for the rest of that story.
 */
export async function calJobZipBlob(jobId: string, sheets = false): Promise<Blob> {
  const { data } = await api.get(`/calligraphy/jobs/${jobId}/download`, {
    params: sheets ? { sheets: 1 } : undefined,
    responseType: "blob",
  });
  return data as Blob;
}

// ─── Queue ───────────────────────────────────────────────────────────────────

export interface CalQueueItem {
  order_item_id: string;
  student_id: string;
  student_name: string;
  render_text: string;
  variant: CalVariant;
}

/** A line the generator refused, with the reason, so an unexpectedly small «توليد» is explained. */
export interface CalQueueHeldItem extends CalQueueItem {
  order_id: string;
  reason: "nonempty" | "junk" | "instruction";
  hint: string;
}

/** A line that already carries a done plate — the population «يخصّني الآن» could see and the
 *  queue could not, because the queue's whole definition of work is "has no done plate". */
export interface CalQueuePlatedItem extends CalQueueItem {
  order_id: string;
  plate_id: string;
  plate_path: string | null;
}

export interface CalQueueZone {
  pending: number;
  items: CalQueueItem[];
  held: { count: number; items: CalQueueHeldItem[] };
  plated: { count: number; items: CalQueuePlatedItem[] };
}

export interface CalQueue {
  front: CalQueueZone;
  back: CalQueueZone;
  cap: CalQueueZone;
  cap_side: CalQueueZone;
}

export async function getCalQueue(wholesalerId?: string | null): Promise<CalQueue> {
  const qs = wholesalerId ? `?wholesaler_id=${wholesalerId}` : "";
  const { data } = await api.get<{ data: CalQueue }>(`/calligraphy/queue${qs}`);
  return data.data;
}

export async function generateFromQueue(
  variant: CalVariant,
  mode: "full" | "all",
  wholesalerId?: string | null
): Promise<CalJob> {
  const { data } = await api.post<{ data: CalJob }>("/calligraphy/queue/generate", {
    variant,
    mode,
    wholesaler_id: wholesalerId || null,
  });
  return data.data;
}

// ─── Retail («تجزئة») review board ───────────────────────────────────────────
// Rep students are generated in bulk and reviewed after; retail students are reviewed
// BEFORE generation, because their customer_text is free-form instruction rather than a
// clean name. The designer rewrites it into the text to actually render — that cleaned
// text lives only on the plate and never touches the order.

export interface CalRetailZone {
  order_item_id: string;
  zone_key: string;
  zone_label: string;
  label_snapshot: string;
  raw_text: string;
  /** What the STUDENT uploaded for this zone. */
  customer_image_url: string | null;
  /** The plate already generated for this zone, if any (migration 080). */
  plate_image_url: string | null;
  has_plate: boolean;
  /** The raw text reads as a message to the shop, not a name — retype before generating. */
  text_is_instruction: boolean;
}

export interface CalRetailOrder {
  order_id: string;
  order_status: string;
  created_at: string;
  notes: string | null;
  final_design_url: string | null;
  student_id: string;
  student_name: string;
  instagram_username: string | null;
  university_name: string | null;
  department: string | null;
  product_name: string;
  product_type: string;
  zones: CalRetailZone[];
  images: string[];
}

export interface CalRetailQueue {
  orders: CalRetailOrder[];
  pending_orders: number;
  pending_zones: number;
}

export async function getCalRetailQueue(search?: string): Promise<CalRetailQueue> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  const { data } = await api.get<{ data: CalRetailQueue }>(`/calligraphy/retail-queue${qs}`);
  return data.data;
}

export async function getRecentPlates(limit = 60): Promise<CalPlate[]> {
  const { data } = await api.get<{ data: { plates: CalPlate[] } }>(`/calligraphy/recent?limit=${limit}`);
  return data.data.plates;
}

export async function composePlate(id: string, image: Blob): Promise<CalPlate> {
  const fd = new FormData();
  fd.append("image", image, "plate.png");
  const { data } = await api.post<{ data: CalPlate }>(`/calligraphy/plates/${id}/compose`, fd);
  return data.data;
}

export async function generateElement(word: string): Promise<{ url: string; cost: number }> {
  const { data } = await api.post<{ data: { url: string; cost: number } }>(`/calligraphy/element`, { word });
  return data.data;
}
