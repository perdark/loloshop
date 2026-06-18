import { api, apiUploadFile } from "./api";
import type {
  CatalogProduct,
  ConfigureOrderResult,
  OrderBreakdownDetail,
  OrderBreakdownLine,
  OrderStatus,
  PriceRole,
  ProductType,
  RobeMeasurements,
} from "./types";
import type { OptionSelection } from "./pricing";
import { selectionKey } from "./customerImage";

export interface ConfigureSelectionPayload {
  group_id: string;
  option_id: string;
  qty?: number;
  customer_image_url?: string;
  customer_text?: string;
}

export function buildConfigureSelections(
  product: CatalogProduct,
  selection: OptionSelection,
  customerImages: Record<string, string> = {},
  customerTexts: Record<string, string> = {}
): ConfigureSelectionPayload[] {
  const out: ConfigureSelectionPayload[] = [];

  for (const group of product.optionGroups) {
    const sel = selection[group.id];
    if (sel == null || sel === false) continue;

    let optionId: string | null = null;
    let qty: number | undefined;

    if (group.inputType === "single_select" && typeof sel === "string") {
      optionId = sel;
    } else if (group.inputType === "toggle" && sel === true) {
      const opt = group.options.find((o) => o.active) ?? group.options[0];
      if (opt) optionId = opt.id;
    } else if (group.inputType === "counter" && typeof sel === "number" && sel > 0) {
      const opt = group.options.find((o) => o.active) ?? group.options[0];
      if (opt) {
        optionId = opt.id;
        qty = sel;
      }
    }

    if (!optionId) continue;

    const row: ConfigureSelectionPayload = {
      group_id: group.id,
      option_id: optionId,
    };
    if (qty != null) row.qty = qty;

    const url = customerImages[selectionKey(group.id, optionId)];
    if (url) row.customer_image_url = url;

    const text = customerTexts[selectionKey(group.id, optionId)];
    if (text?.trim()) row.customer_text = text.trim();

    out.push(row);
  }

  return out;
}

function mapBreakdownLine(raw: Record<string, unknown>): OrderBreakdownLine {
  return {
    label: String(raw.label ?? raw.label_snapshot),
    price: Number(raw.price ?? raw.price_snapshot ?? 0),
    groupId: (raw.group_id as string | null) ?? null,
    optionId: (raw.option_id as string | null) ?? null,
    qty: Number(raw.qty ?? 1),
    customerImageUrl:
      (raw.customer_image_url as string | null) ??
      (raw.customerImageUrl as string | null) ??
      null,
  };
}

export async function configureOrder(payload: {
  productId: string;
  designId?: string;
  batchId?: string;
  selections: ConfigureSelectionPayload[];
  measurements?: RobeMeasurements;
}): Promise<ConfigureOrderResult> {
  const body: Record<string, unknown> = {
    product_id: payload.productId,
    design_id: payload.designId,
    batch_id: payload.batchId,
    selections: payload.selections,
  };
  if (payload.measurements) body.measurements = payload.measurements;
  const { data } = await api.post<{ data: Record<string, unknown> }>(
    "/orders/configure",
    body
  );
  const raw = data.data;
  const breakdown = (raw.breakdown as Record<string, unknown>[]) || [];
  return {
    orderId: String(raw.order_id),
    priceRole: raw.price_role as PriceRole,
    total: Number(raw.total),
    breakdown: breakdown.map(mapBreakdownLine),
  };
}

// ─── Full-Set Wizard types ────────────────────────────────────────────────────

export interface FullSetSelectionPayload {
  group_id: string;
  option_id: string;
  qty?: number;
  customer_text?: string;
  customer_image_url?: string;
}

export interface FullSetSashZones {
  right_text: string;
  left_mode: "logo_year" | "text" | "plain";
  left_text?: string;
  left_logo_url?: string;
  back_text?: string;
}

export interface FullSetMeasurements {
  shoulder_cm: number;
  robe_length_cm: number;
  sleeve_length_cm: number;
}

export interface FullSetDelivery {
  customer_name: string;
  instagram_username?: string;
  phone_primary: string;
  phone_secondary?: string;
  governorate: string;
  area_details?: string;
}

export interface ConfigureFullSetPayload {
  package_id: string;
  robe: {
    selections: FullSetSelectionPayload[];
    measurements: FullSetMeasurements;
  };
  cap: {
    selections: FullSetSelectionPayload[];
  };
  sash: {
    selections: FullSetSelectionPayload[];
    zones: FullSetSashZones;
  };
  delivery: FullSetDelivery;
  event_date?: string;
  notes?: string;
}

export interface FullSetOrderItem {
  type: "sash" | "robe" | "cap";
  order_id: string;
  price: number;
}

export interface ConfigureFullSetResult {
  checkout_group_id: string;
  package_id: string;
  package_name: string;
  total: number;
  items: FullSetOrderItem[];
  orders: {
    sash: string;
    robe: string;
    cap: string;
  };
}

export async function configureFullSet(
  payload: ConfigureFullSetPayload
): Promise<ConfigureFullSetResult> {
  const { data } = await api.post<{ data: ConfigureFullSetResult }>(
    "/orders/configure-full-set",
    payload
  );
  return data.data;
}

export async function uploadSashLogo(file: File): Promise<string> {
  const result = (await apiUploadFile("/designs/uploads/logo", file)) as {
    data: { url: string };
  };
  const url: string = result.data.url;
  const base =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
    "http://localhost:4000";
  if (url.startsWith("http")) return url;
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

// ─── Order breakdown ──────────────────────────────────────────────────────────

export async function getOrderBreakdown(
  orderId: string
): Promise<OrderBreakdownDetail> {
  const { data } = await api.get<{ data: Record<string, unknown> }>(
    `/orders/${orderId}/breakdown`
  );
  const raw = data.data;
  const lines = (raw.breakdown as Record<string, unknown>[]) || [];
  return {
    id: String(raw.id),
    productName: String(raw.product_name),
    studentName: String(raw.student_name),
    total: Number(raw.total),
    status: raw.status as OrderBreakdownDetail["status"],
    createdAt: String(raw.created_at),
    breakdown: lines.map((l) => ({
      label: String(l.label_snapshot),
      price: Number(l.price_snapshot),
      qty: Number(l.qty ?? 1),
      customerImageUrl:
        (l.customer_image_url as string | null) ?? null,
    })),
  };
}

// ─── Student order tracking ────────────────────────────────────────────────
export interface StudentOrder {
  id: string;
  productName: string;
  productType: ProductType;
  status: OrderStatus;
  createdAt: string;
  deliveredAt: string | null;
  deliveryMethod: "delivery" | "pickup" | null;
  /** Designer verdict on the linked sash design (drives the "needs edit" note). */
  designApprovalStatus: "pending" | "approved" | "rejected" | null;
  rejectionReason: string | null;
}

/** GET /orders/mine — the signed-in student's own orders, newest first. */
export async function getMyOrders(): Promise<StudentOrder[]> {
  const { data } = await api.get<{ data: Record<string, unknown>[] }>("/orders/mine");
  return (data.data ?? []).map((r) => ({
    id: String(r.id),
    productName: String(r.product_name ?? ""),
    productType: r.product_type as ProductType,
    status: r.status as OrderStatus,
    createdAt: String(r.created_at ?? ""),
    deliveredAt: (r.delivered_at as string | null) ?? null,
    deliveryMethod: (r.delivery_method as "delivery" | "pickup" | null) ?? null,
    designApprovalStatus:
      (r.design_approval_status as "pending" | "approved" | "rejected" | null) ?? null,
    rejectionReason: (r.rejection_reason as string | null) ?? null,
  }));
}
