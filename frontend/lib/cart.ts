import { api } from "./api";
import { resolveCatalogMediaUrl } from "./catalog";

export interface CartItem {
  id: string;
  productId: string;
  productName: string;
  productType: string;
  imageUrl: string | null;
  selections: { group_id: string; option_id: string; qty?: number; customer_image_url?: string }[];
  priceSnapshot: number;
  qty: number;
  customizable: boolean;
  designId: string | null;
}

export interface Cart {
  id: string;
  items: CartItem[];
  total: number;
}

function mapCartItem(raw: Record<string, unknown>): CartItem {
  return {
    id: String(raw.id),
    productId: String(raw.product_id ?? raw.productId),
    productName: String(raw.product_name ?? raw.productName ?? ""),
    productType: String(raw.product_type ?? raw.productType ?? ""),
    imageUrl: resolveCatalogMediaUrl(raw.image_url as string | null),
    selections: (raw.selections as CartItem["selections"]) ?? [],
    priceSnapshot: Number(raw.price_snapshot ?? raw.priceSnapshot ?? 0),
    qty: Number(raw.qty ?? 1),
    customizable: Boolean(raw.customizable),
    designId: raw.design_id != null ? String(raw.design_id) : null,
  };
}

function mapCart(raw: Record<string, unknown>): Cart {
  const items = (raw.items as Record<string, unknown>[] | undefined) ?? [];
  return {
    id: String(raw.id ?? ""),
    items: items.map(mapCartItem),
    total: Number(raw.total ?? 0),
  };
}

export async function getCart(): Promise<Cart> {
  const { data } = await api.get<{ data: Record<string, unknown> }>("/cart");
  return mapCart(data.data);
}

export async function addToCart(
  productId: string,
  selections: { group_id: string; option_id: string; qty?: number; customer_image_url?: string }[],
  opts?: { qty?: number; designId?: string }
): Promise<{ id: string; priceSnapshot: number; qty: number }> {
  const body: Record<string, unknown> = {
    product_id: productId,
    selections,
  };
  if (opts?.qty != null) body.qty = opts.qty;
  if (opts?.designId != null) body.design_id = opts.designId;
  const { data } = await api.post<{
    data: Record<string, unknown>;
  }>("/cart/items", body);
  const raw = data.data;
  return {
    id: String(raw.id),
    priceSnapshot: Number(raw.price_snapshot ?? raw.priceSnapshot ?? 0),
    qty: Number(raw.qty ?? 1),
  };
}

export async function updateCartItem(
  id: string,
  qty: number
): Promise<{ id: string; qty: number }> {
  const { data } = await api.patch<{ data: Record<string, unknown> }>(
    `/cart/items/${id}`,
    { qty }
  );
  const raw = data.data;
  return { id: String(raw.id), qty: Number(raw.qty ?? qty) };
}

export async function removeCartItem(id: string): Promise<{ id: string }> {
  const { data } = await api.delete<{ data: Record<string, unknown> }>(
    `/cart/items/${id}`
  );
  return { id: String(data.data.id ?? id) };
}

export async function checkout(): Promise<{
  orders: string[];
  count: number;
  hasCustomizable: boolean;
}> {
  const { data } = await api.post<{
    data: { orders: string[]; count: number };
  }>("/cart/checkout");
  const orders = data.data.orders ?? [];
  return {
    orders,
    count: data.data.count ?? orders.length,
    hasCustomizable: false, // server doesn't return this; caller checks items before checkout
  };
}
