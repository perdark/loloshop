import { api } from "./api";
import type {
  CatalogOption,
  CatalogOptionGroup,
  CatalogProduct,
  CatalogProductSummary,
  PriceRole,
  ProductImage,
  ShopFeed,
  ShopPackageCard,
  ShopProductCard,
} from "./types";

const baseURL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "http://localhost:4000";

export function resolveCatalogMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `${baseURL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function mapOption(raw: Record<string, unknown>): CatalogOption {
  return {
    id: String(raw.id),
    groupId: String(raw.group_id ?? raw.groupId),
    labelAr: String(raw.label_ar ?? raw.labelAr),
    priceDelta: Number(raw.price_delta ?? raw.priceDelta ?? 0),
    imageUrl: resolveCatalogMediaUrl(raw.image_url as string | null),
    sort: Number(raw.sort ?? 0),
    active: raw.active !== false,
    requiresCustomerImage: Boolean(
      raw.requires_customer_image ?? raw.requiresCustomerImage
    ),
  };
}

function mapGroup(
  raw: Record<string, unknown>,
  productId: string
): CatalogOptionGroup {
  const opts = (raw.options as Record<string, unknown>[] | undefined) || [];
  return {
    id: String(raw.id),
    productId,
    nameAr: String(raw.name_ar ?? raw.nameAr),
    inputType: (raw.input_type ?? raw.inputType) as CatalogOptionGroup["inputType"],
    sort: Number(raw.sort ?? 0),
    required: Boolean(raw.required),
    hasImage: Boolean(raw.has_image ?? raw.hasImage),
    hintAr: (raw.hint_ar as string | null) ?? null,
    imageUrl: resolveCatalogMediaUrl(raw.image_url as string | null),
    maxSelect: raw.max_select != null ? Number(raw.max_select) : null,
    genderRestriction:
      (raw.gender_restriction as CatalogOptionGroup["genderRestriction"]) ?? null,
    requiresCustomerImage: Boolean(
      raw.requires_customer_image ?? raw.requiresCustomerImage
    ),
    inherited: Boolean((raw as Record<string, unknown>)._inherited ?? (raw as Record<string, unknown>).inherited ?? false),
    options: opts.map(mapOption),
  };
}

function mapProductImage(raw: Record<string, unknown>): ProductImage {
  return {
    id: String(raw.id),
    url: resolveCatalogMediaUrl(String(raw.url)) || "",
    sort: Number(raw.sort ?? 0),
  };
}

function mapShopProduct(raw: Record<string, unknown>): ShopProductCard {
  return {
    id: String(raw.id),
    type: raw.type as ShopProductCard["type"],
    nameAr: String(raw.name_ar ?? raw.nameAr),
    description: (raw.description as string | null) ?? null,
    basePrice: Number(raw.base_price ?? raw.basePrice ?? 0),
    imageUrl: resolveCatalogMediaUrl(raw.image_url as string | null),
    featured: Boolean(raw.featured),
    customizable: Boolean(raw.customizable),
    genderRestriction:
      (raw.gender_restriction as ShopProductCard["genderRestriction"]) ?? null,
  };
}

function mapShopPackage(raw: Record<string, unknown>): ShopPackageCard {
  return {
    id: String(raw.id),
    nameAr: String(raw.name_ar ?? raw.nameAr),
    price: Number(raw.price ?? 0),
    imageUrl: resolveCatalogMediaUrl(raw.image_url as string | null),
    sort: Number(raw.sort ?? 0),
  };
}

function mapProductFull(raw: Record<string, unknown>): CatalogProduct {
  const id = String(raw.id);
  const groups =
    (raw.groups as Record<string, unknown>[] | undefined) ||
    (raw.option_groups as Record<string, unknown>[] | undefined) ||
    [];
  const gallery =
    (raw.images as Record<string, unknown>[] | undefined) || [];
  return {
    id,
    type: raw.type as CatalogProduct["type"],
    nameAr: String(raw.name_ar ?? raw.nameAr),
    description: (raw.description as string | null) ?? null,
    basePrice: Number(raw.base_price ?? raw.basePrice ?? 0),
    genderRestriction:
      (raw.gender_restriction as CatalogProduct["genderRestriction"]) ?? null,
    customizable: Boolean(raw.customizable),
    active: raw.active !== false,
    featured: Boolean(raw.featured),
    sort: Number(raw.sort ?? 0),
    imageUrl: resolveCatalogMediaUrl(raw.image_url as string | null),
    images: gallery.map(mapProductImage),
    priceRole: (raw.price_role as PriceRole) ?? undefined,
    optionGroups: groups.map((g) => mapGroup(g, id)),
    parentId: (raw.parent_id as string | null) ?? null,
    parentNameAr: (raw.parent_name_ar as string | null) ?? null,
  };
}

function mapProductSummary(raw: Record<string, unknown>): CatalogProductSummary {
  return {
    id: String(raw.id),
    type: raw.type as CatalogProductSummary["type"],
    nameAr: String(raw.name_ar ?? raw.nameAr),
    description: (raw.description as string | null) ?? null,
    basePrice: Number(raw.base_price ?? raw.basePrice ?? 0),
    customizable: Boolean(raw.customizable),
    genderRestriction:
      (raw.gender_restriction as CatalogProductSummary["genderRestriction"]) ??
      null,
    active: raw.active !== false,
    featured: Boolean(raw.featured),
    sort: Number(raw.sort ?? 0),
    imageUrl: resolveCatalogMediaUrl(raw.image_url as string | null),
    groupCount: Number(raw.group_count ?? raw.groupCount ?? 0),
    imageCount: Number(raw.image_count ?? raw.imageCount ?? 0),
    parentId: (raw.parent_id as string | null) ?? null,
    parentNameAr: (raw.parent_name as string | null) ?? null,
  };
}

/** Student shop feed: packages + products by type. */
export async function getShopFeed(): Promise<ShopFeed> {
  const { data } = await api.get<{ data: Record<string, unknown> }>(
    "/catalog/shop"
  );
  const raw = data.data;
  const byTypeRaw = (raw.by_type as Record<string, Record<string, unknown>[]>) || {};
  const byType: ShopFeed["byType"] = {};
  for (const [type, list] of Object.entries(byTypeRaw)) {
    byType[type as keyof ShopFeed["byType"]] = (list || []).map(mapShopProduct);
  }
  const packages = ((raw.packages as Record<string, unknown>[]) || []).map(
    mapShopPackage
  );
  return {
    priceRole: (raw.price_role as PriceRole) || "retail",
    packages,
    byType,
  };
}

export async function listCatalogProductsAdmin(): Promise<
  CatalogProductSummary[]
> {
  const { data } = await api.get<{ data: Record<string, unknown>[] }>(
    "/catalog/products"
  );
  return (data.data || []).map(mapProductSummary);
}

export async function getProductFull(
  id: string,
  role?: PriceRole
): Promise<CatalogProduct> {
  const { data } = await api.get<{ data: Record<string, unknown> }>(
    `/catalog/products/${id}/full`,
    { params: role ? { role } : undefined }
  );
  return mapProductFull(data.data);
}

export async function createCatalogProduct(body: {
  type: string;
  name_ar: string;
  description?: string | null;
  base_price: number;
  customizable?: boolean;
  gender_restriction?: string | null;
  parent_id?: string | null;
}): Promise<{ id: string }> {
  const { data } = await api.post<{ data: { id: string } }>("/catalog/products", body);
  return data.data;
}

export async function updateCatalogProduct(
  id: string,
  body: Record<string, unknown>
): Promise<void> {
  await api.patch(`/catalog/products/${id}`, body);
}

export async function setProductPriceRole(
  productId: string,
  role: PriceRole,
  basePrice: number | null
): Promise<void> {
  await api.put(`/catalog/products/${productId}/price-role`, {
    role,
    base_price: basePrice,
  });
}

export async function updateCatalogGroup(
  groupId: string,
  body: Record<string, unknown>
): Promise<void> {
  await api.patch(`/catalog/groups/${groupId}`, body);
}

export async function updateCatalogOption(
  optionId: string,
  body: Record<string, unknown>
): Promise<void> {
  await api.patch(`/catalog/options/${optionId}`, body);
}

export async function setOptionPriceRole(
  optionId: string,
  role: PriceRole,
  priceDelta: number | null
): Promise<void> {
  await api.put(`/catalog/options/${optionId}/price-role`, {
    role,
    price_delta: priceDelta,
  });
}

export async function uploadCatalogImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<{ data: { url: string } }>(
    "/catalog/uploads/image",
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return resolveCatalogMediaUrl(data.data.url) || data.data.url;
}

export async function addProductImage(
  productId: string,
  url: string,
  sort?: number
): Promise<string> {
  const { data } = await api.post<{ data: { id: string } }>(
    `/catalog/products/${productId}/images`,
    { url, sort: sort ?? 0 }
  );
  return data.data.id;
}

export async function deleteProductImage(imageId: string): Promise<void> {
  await api.delete(`/catalog/images/${imageId}`);
}

export async function setProductMainImage(
  productId: string,
  imageUrl: string
): Promise<void> {
  await updateCatalogProduct(productId, { image_url: imageUrl });
}

/** @deprecated Use getShopFeed */
export async function listCatalogProducts(): Promise<CatalogProductSummary[]> {
  return listCatalogProductsAdmin();
}

/** @deprecated Use getProductFull */
export async function getCatalogProduct(
  id: string,
  role?: PriceRole
): Promise<CatalogProduct | null> {
  try {
    return await getProductFull(id, role);
  } catch {
    return null;
  }
}
