import type { DesignApprovalStatus, OrderStatus } from "./types";

export type StaffListFilter = "all" | "review" | "printing" | "done";

export interface StaffOrder {
  id: string;
  studentId: string;
  studentName: string;
  universityName: string | null;
  department: string | null;
  productName: string;
  status: OrderStatus;
  createdAt: string;
}

export interface StaffDesign {
  id: string;
  student_name: string;
  phone: string;
  university_name: string | null;
  department: string | null;
  sash_color: string | null;
  left_canvas: unknown | null;
  right_canvas: unknown | null;
  logo_url: string | null;
  extra_image_url: string | null;
  fonts_used: string[];
  notes: string | null;
  completed: boolean;
}

/** Raw row from GET /admin/orders (API.md) — student_id TODO on backend */
interface ApiOrderRow {
  id: string;
  student_id?: string;
  student_full_name: string;
  product_name: string;
  wholesaler_name?: string | null;
  price?: number;
  cost?: number | null;
  profit?: number;
  status: OrderStatus;
  created_at: string;
  university_name?: string | null;
  department?: string | null;
}

export function mapApiOrderRow(row: ApiOrderRow): StaffOrder {
  return {
    id: row.id,
    studentId: row.student_id || row.id,
    studentName: row.student_full_name,
    universityName: row.university_name ?? null,
    department: row.department ?? null,
    productName: row.product_name,
    status: row.status,
    createdAt: row.created_at,
  };
}

// ─── Production pipeline types ────────────────────────────────────────────────

/** Row from GET /production/queue */
export interface ProductionQueueItem {
  id: string;
  status: OrderStatus;
  created_at: string;
  design_id: string | null;
  student_name: string;
  university_name: string | null;
  department: string | null;
  /** صباحي/مسائي — surfaced on the station console for wholesaler students. */
  study_type?: "morning" | "evening" | null;
  product_name: string;
  product_type: string;
  /** Catalog product photo — same field the order detail exposes. Null when unset. */
  product_image_url?: string | null;
  batch_name: string | null;
  deadline: string | null;
  approval_status: DesignApprovalStatus | null;
  rejection_reason: string | null;
  /** Populated by backend: "retail" or "wholesaler". */
  source: "retail" | "wholesaler";
  /** Populated only when source === "wholesaler". */
  wholesaler_name: string | null;
  /**
   * SEARCH INDEX, not a display field — every word the student typed on this piece, joined
   * into one string. Mostly the التطريز text (what is stitched on the garment), plus
   * free-text option answers like colour. `lib/queue-search.ts` is its only reader; render
   * `zones[].text` instead, which is per-zone and carries the artwork with it.
   * Null when the student typed nothing.
   */
  search_text?: string | null;
  /** Non-null when this order belongs to a multi-item checkout bundle. */
  checkout_group_id: string | null;
  /**
   * MONEY — present ONLY for front-desk (preparer) + manager/admin; the backend deletes both
   * fields for every other station, so `undefined` means "not allowed to see", not "free".
   *
   * `price` is THIS piece's own price. ⚠️ In a طقم the whole price sits on one piece (usually
   * the sash) and the siblings are 0, so never render `price` alone for a bundled row —
   * `group_price` is the set total and is what «سعر الطلب» means to the admin. Null for a
   * piece bought on its own.
   */
  price?: number | string | null;
  group_price?: number | string | null;
  /** Staff presence — who is actively working on this order (admin monitor). */
  working_staff_id?: string | null;
  working_staff_name?: string | null;
  working_since?: string | null;
  /** Final rendered design image — null when not yet uploaded (drives the missing-design alert). */
  final_design_url?: string | null;
  /** Whether this piece carries embroidery work (drives the missing-design alert). */
  has_embroidery?: boolean;
  /** TRUE when any spec line carries an image (auto-attached calligraphy plate / photo). */
  has_design_images?: boolean;
  /** Grouping key for the station console («عرض بالطلب»). */
  student_id?: string;
  /**
   * Station mode, التجهيز stages only — every piece of this order's checkout bundle (this
   * one included) with the stage each is at, so the preparer can tell a complete set from
   * one whose robe has not arrived yet. Absent for a piece bought on its own.
   */
  set_pieces?: { id: string; status: OrderStatus; product_name: string }[];
  needs_pressing?: boolean;
  /**
   * ⚠️ «شال امريكي» sold to a REP student is a whole garment with no `orders` row of its own —
   * it is an add-on PRICE on the وشاح (backend/lib/fullSetOrder.js), so its production stage
   * lives in `sash_shawl_pieces` and the queue synthesises this row from it. Present only on
   * such a row; a retail شال is a real product and never carries it.
   *
   * The id IS usable everywhere an order id is — advance, revert, claim and the detail page
   * all fall back to the piece — which is why no console branches on this field to WORK. It
   * exists so a screen can EXPLAIN the row: there is no price and no design on it, and the
   * money lives on `carrier_order_id`.
   */
  piece_kind?: "shawl_addon";
  /** The وشاح this shawl was sold on. Only set alongside `piece_kind`. */
  carrier_order_id?: string | null;
  /** What the student asked for on this shawl, and their reference photo. */
  shawl_note?: string | null;
  shawl_image_url?: string | null;
  /**
   * Station console only (?station=1). The piece's embroidery zones with the stitch
   * content (text / plate image).
   * · التطريز rows — so the worker sees WHAT to embroider inline, and ticks each zone.
   * · التجهيز rows — READ-ONLY, so the preparer can verify the physical set against the
   *   order (sash front/back, cap top/side, both robe sleeves) without opening it.
   *   `done` is meaningless at this stage: the stitching is already finished.
   */
  zones?: StationZone[];
  /**
   * Station console only (?station=1), التجهيز rows (قيد التجهيز + جاهزة). The piece's spec —
   * لون/قماش/فصال الروب, الشكل, لون القبعة, plus free-text lines like «كسرة الكتف».
   * NOT the same data as `zones`: those are what is *stitched*, this is what the garment *is*.
   * The prep queue is ~64% robes, so for most pieces this is the only content on the card.
   */
  spec?: PieceSpecRow[];
  /** Station console only, التجهيز rows: robe measurements. Gated in SQL — null elsewhere. */
  measurements?: RobeMeasurements | null;
  /** Station console only, الكوي + التجهيز rows: backend-granted advance (never derived client-side). */
  can_advance?: boolean;
  next_status?: OrderStatus | null;
  advance_label?: string | null;
}

/**
 * Robe tailoring measurements (قياسات الروب), in cm. `chest_cm` and `tailor_notes` are newer
 * than the rest, so they are optional on legacy orders — and `chest_cm` is `0` on effectively
 * every live order, which is why every renderer must treat 0 as "not given" rather than print
 * «محيط الصدر: 0».
 *
 * Shared by the order detail and the التجهيز queue row. Extracted from an inline type on the
 * detail response so the two cannot drift apart.
 */
export interface RobeMeasurements {
  shoulder_cm: number;
  chest_cm?: number;
  robe_length_cm: number;
  sleeve_length_cm: number;
  tailor_notes?: string;
  /** صورة الوصل — optional receipt/bill photo URL (retail only). */
  receipt_image_url?: string;
}

/**
 * One spec row on a التجهيز queue row — «which garment do I pull off the shelf».
 * Either a chosen option (`label` = group, `value` = the choice) or a free-text instruction
 * the student typed (`label` = the line, `value` null, `text` set). Never both empty.
 */
export interface PieceSpecRow {
  label: string;
  value: string | null;
  text: string | null;
  image_url: string | null;
}

/** One embroidery zone on a station-console queue row. */
export interface StationZone {
  key: string;
  label: string;
  done: boolean;
  text: string | null;
  /** What to STITCH — the generated plate when there is one, else the student's own upload. */
  image_url: string | null;
  /**
   * The student's OWN photo, when a plate is what's being stitched. Migration 080 split the
   * two; before that a plate overwrote the photo, so text like «نفس الصوره» pointed at an
   * image nobody could see any more.
   */
  reference_image_url?: string | null;
}

/** One item in the `items[]` array on the production order detail */
export interface ProductionOrderItem {
  id: string;
  label_snapshot: string;
  price_snapshot: number;
  qty: number;
  /** What the STUDENT uploaded as reference. */
  customer_image_url: string | null;
  /** What the calligraphy generator produced for this line (migration 080). */
  plate_image_url: string | null;
  /** Student's typed embroidery instruction (cap/sleeve embroidery). */
  customer_text: string | null;
  group_id: string | null;
  option_id: string | null;
}

/** Sibling order in a package (cap/robe/sash bundle) */
export interface PackageOrderSibling {
  id: string;
  status: OrderStatus;
  price: number;
  product_name: string;
  product_type: string;
}

/**
 * Item in the `bundle` array on a production order detail.
 * Returned only when the order is part of a multi-item checkout group.
 * is_current=true marks the order currently being viewed.
 */
export interface BundleItem {
  id: string;
  status: OrderStatus;
  price: number;
  product_name: string;
  product_type: string;
  is_current: boolean;
}

/** Intake data attached to a full-set bundle order (delivery / phones / event / deposit).
 *  Shape varies by staff role — presser only gets { event_date }; embroiderer/manager/admin
 *  get the full shape including deposit. */
export interface OrderIntake {
  customer_name?: string;
  instagram_username?: string | null;
  phone_primary?: string;
  phone_secondary?: string | null;
  governorate?: string | null;
  area_details?: string | null;
  event_date: string | null;
  /** Only present for manager/embroiderer/admin. */
  deposit?: number;
  notes?: string | null;
}

/** Full detail from GET /production/orders/:id */
export interface ProductionOrderDetail {
  order: {
    id: string;
    status: OrderStatus;
    created_at: string;
    design_id: string | null;
    package_id: string | null;
    batch_id: string | null;
    student_id: string;
    student_name: string;
    student_phone: string;
    university_name: string | null;
    department: string | null;
    gender: string | null;
    /** Study schedule — "morning" (صباحي) or "evening" (مسائي). */
    study_type: "morning" | "evening" | null;
    /** Instagram handle (no leading @) — used by staff/admin to contact the student. */
    instagram_username: string | null;
    product_name: string;
    product_type: string;
    /** Catalog product photo — shown to ALL staff roles. Null when unset. */
    product_image_url?: string | null;
    batch_name: string | null;
    deadline: string | null;
    /** Order source — "retail" or "wholesaler". */
    source: "retail" | "wholesaler";
    /** Wholesaler display name; null for retail orders. */
    wholesaler_name: string | null;
    /** Routing flags (batch update). */
    has_embroidery?: boolean;
    needs_pressing?: boolean;
    /** Robe tailoring measurements (قياسات الروب). */
    measurements?: RobeMeasurements | null;
    /** Final design image uploaded by admin/designer (replaces PDF). */
    final_design_url?: string | null;
    /** Staff presence — who is actively working on this order. */
    working_staff_id?: string | null;
    working_staff_name?: string | null;
    working_since?: string | null;
    /** Total order price — returned ONLY for admin + embroiderer. */
    price?: number;
    /** Full-set bundle intake (delivery/contact/event/deposit). Null for non-bundle orders.
     *  Shape is role-gated: presser gets only { event_date }. */
    intake?: OrderIntake | null;
    /** Checkout group id this order belongs to (for sibling fetching). */
    checkout_group_id?: string | null;
    /** Delivery confirmation details — populated once status = 'delivered'. */
    delivered_at?: string | null;
    /** 'delivery' = توصيل بعنوان ورقم · 'pickup' = استلام من المحل. */
    delivery_method?: "delivery" | "pickup" | null;
    recipient_name?: string | null;
    delivery_address?: string | null;
    delivery_phone?: string | null;
    delivery_notes?: string | null;
    /** Name of the staff member who confirmed delivery. */
    delivered_by_name?: string | null;
    /** See ProductionQueueItem.piece_kind. On this payload the fields a shawl genuinely does
     *  not have — price, design, measurements, intake, contact — are simply absent. */
    piece_kind?: "shawl_addon";
    carrier_order_id?: string | null;
    status_label?: string;
  };
  design: {
    id: string;
    sash_color: string | null;
    approval_status: DesignApprovalStatus;
    rejection_reason: string | null;
    completed: boolean;
    /** Only present when can_see_design=true */
    left_canvas?: unknown | null;
    right_canvas?: unknown | null;
    logo_url?: string | null;
    extra_image_url?: string | null;
    fonts_used?: string[];
    notes?: string | null;
  } | null;
  items: ProductionOrderItem[];
  package_orders: PackageOrderSibling[] | null;
  /**
   * Full bundle context for the checkout group this order belongs to.
   * null when the order was not part of a multi-item bundle checkout.
   * Each entry has is_current=true for the order being viewed.
   * `package_orders` is a backward-compat alias — prefer `bundle`.
   */
  bundle: BundleItem[] | null;
  can_see_design: boolean;
  /**
   * Embroidery zones for the embroiderer's per-zone checklist.
   * Populated ONLY when order.status === 'embroidery'; otherwise [].
   * Each entry's `done` reflects whether that zone's stitching is finished.
   */
  embroidery_zones: { key: string; label: string; done: boolean }[];
  /**
   * «منو نقلها؟» — who moved this piece between stages, and when.
   *
   * Read back from `staff_activity_log`, which has recorded every advance/revert/approve
   * since the line was built but was never surfaced anywhere. Optional on the wire so an
   * older backend simply renders no card.
   *
   * ⚠️ A MISSING STAGE IS NOT A MISSING ROW. A piece legitimately skips الكوي when
   * `needs_pressing` is false, and a plain cap starts AT التجهيز — so «ما مر بالكوي» is
   * usually the routing rule, not a lost record. Read the gap, don't fill it.
   */
  stage_history?: {
    action: string;
    from_stage: string | null;
    to_stage: string;
    from_label: string | null;
    to_label: string;
    staff_name: string | null;
    at: string;
  }[];
  /** Actions the requesting user may perform on this order right now.
   *  Derived server-side from the same state machine used by POST handlers. */
  available_actions: {
    advance: { to: string; label: string } | null;
    revert: { to: string } | null;
    can_approve: boolean;
    can_reject: boolean;
    /** «إرجاع للطالب» — retail order at its first stage may be handed back to the student. */
    return_to_customer?: boolean;
    /** Matches the final-design upload route guard. */
    can_upload_final_design?: boolean;
    /** Permanent single-piece deletion is manager/admin-only. */
    can_delete?: boolean;
    /** Quick per-field edits (spec-line text, IG, phones) — manager/admin only. */
    can_edit?: boolean;
    /** Full طقم edit form — manager/admin, design-less rep/admin-created bundles only. */
    can_edit_full_set?: boolean;
  };
  /** Backend-driven render layout (single source of truth — the UI never re-derives
   *  role→visibility). 'tailor' = الفصال read-only · 'embroidery' = embroiderer minimal
   *  station · 'presser' = الكوي colour-only · 'full' = designer/digitizer/preparer/manager. */
  view?: { layout: "embroidery" | "tailor" | "presser" | "full" };
}

// ─── Monitor types ────────────────────────────────────────────────────────────

export interface MonitorData {
  wip: Partial<Record<OrderStatus, number>>;
  throughput: {
    actor_id: string;
    name: string;
    staff_type: string;
    actions: number;
    last_action: string | null;
  }[];
  overdue: {
    id: string;
    student_name: string;
    product_name: string;
    status: OrderStatus;
    batch_name: string | null;
    deadline: string;
  }[];
  stale: {
    id: string;
    student_name: string;
    status: OrderStatus;
    updated_at: string;
    hours_in_stage: number;
  }[];
  /**
   * «يعمل الآن» — orders claimed in the last 30 minutes.
   *
   * ⚠️ THESE FIELD NAMES ARE THE BACKEND'S, verified against
   * `productionController.monitor` (the `working` query). `/staff` used to declare its own
   * page-local guess — `staff_id` · `staff_name` · `order_id` · `since` — none of which the
   * API sends. TypeScript could not catch it because the guess was applied with `&` to an
   * `any`-shaped response, so the panel rendered a blank staff name and linked every row to
   * `/staff/orders/undefined`. Keep this interface as the single declaration.
   */
  working: {
    /** The ORDER id — the row is an order being worked on, not a staff member. */
    id: string;
    status: OrderStatus;
    student_name: string;
    product_name: string;
    working_staff_name: string;
    working_since: string;
  }[];
}
