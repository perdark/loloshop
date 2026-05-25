import { api } from "./api";
import type {
  CatalogProduct,
  ConfigureOrderResult,
  OrderBreakdownDetail,
  OrderBreakdownLine,
  PriceRole,
} from "./types";
import type { OptionSelection } from "./pricing";

export function buildConfigureSelections(
  product: CatalogProduct,
  selection: OptionSelection
): { group_id: string; option_id: string; qty?: number }[] {
  const out: { group_id: string; option_id: string; qty?: number }[] = [];

  for (const group of product.optionGroups) {
    const sel = selection[group.id];
    if (sel == null || sel === false) continue;

    if (group.inputType === "single_select" && typeof sel === "string") {
      out.push({ group_id: group.id, option_id: sel });
    } else if (group.inputType === "toggle" && sel === true) {
      const opt = group.options.find((o) => o.active) ?? group.options[0];
      if (opt) out.push({ group_id: group.id, option_id: opt.id });
    } else if (group.inputType === "counter" && typeof sel === "number" && sel > 0) {
      const opt = group.options.find((o) => o.active) ?? group.options[0];
      if (opt) out.push({ group_id: group.id, option_id: opt.id, qty: sel });
    }
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
  };
}

export async function configureOrder(payload: {
  productId: string;
  designId?: string;
  batchId?: string;
  selections: { group_id: string; option_id: string; qty?: number }[];
}): Promise<ConfigureOrderResult> {
  const { data } = await api.post<{ data: Record<string, unknown> }>(
    "/orders/configure",
    {
      product_id: payload.productId,
      design_id: payload.designId,
      batch_id: payload.batchId,
      selections: payload.selections,
    }
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
    })),
  };
}
