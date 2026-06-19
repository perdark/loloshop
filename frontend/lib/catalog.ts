import { api, apiUploadFile } from "./api";
import type {
  CatalogInputType,
  CatalogOption,
  CatalogOptionGroup,
  CatalogProduct,
  CatalogProductSummary,
  HeroSlide,
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
    requiresCustomerText: Boolean(
      raw.requires_customer_text ?? raw.requiresCustomerText
    ),
    customerTextPromptAr:
      (raw.customer_text_prompt_ar as string | null) ?? null,
    customerTextPlaceholderAr:
      (raw.customer_text_placeholder_ar as string | null) ?? null,
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
    requiresCustomerText: Boolean(
      raw.requires_customer_text ?? raw.requiresCustomerText
    ),
    customerTextPromptAr:
      (raw.customer_text_prompt_ar as string | null) ?? null,
    customerTextPlaceholderAr:
      (raw.customer_text_placeholder_ar as string | null) ?? null,
    inherited: Boolean((raw as Record<string, unknown>)._inherited ?? (raw as Record<string, unknown>).inherited ?? false),
    lockedOptionId:
      (raw.locked_option_id as string | null) ??
      (raw.lockedOptionId as string | null) ??
      null,
    options: opts.map(mapOption),
  };
}

/** Coerce the raw image_fit value to a known fit, defaulting to "cover". */
function mapImageFit(raw: unknown): import("./types").ImageFit {
  return raw === "contain" ? "contain" : "cover";
}

/** Optional «السعر قبل الخصم» — NULL/absent → null, else a finite number. */
function mapCompareAtPrice(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
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
    compareAtPrice: mapCompareAtPrice(raw.compare_at_price ?? raw.compareAtPrice),
    imageUrl: resolveCatalogMediaUrl(raw.image_url as string | null),
    imageFit: mapImageFit(raw.image_fit ?? raw.imageFit),
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
    compareAtPrice: mapCompareAtPrice(raw.compare_at_price ?? raw.compareAtPrice),
    genderRestriction:
      (raw.gender_restriction as CatalogProduct["genderRestriction"]) ?? null,
    customizable: Boolean(raw.customizable),
    active: raw.active !== false,
    featured: Boolean(raw.featured),
    wholesalerOnly: Boolean(raw.wholesaler_only ?? raw.wholesalerOnly),
    retailOnly: Boolean(raw.retail_only ?? raw.retailOnly),
    sort: Number(raw.sort ?? 0),
    imageUrl: resolveCatalogMediaUrl(raw.image_url as string | null),
    imageFit: mapImageFit(raw.image_fit ?? raw.imageFit),
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
    compareAtPrice: mapCompareAtPrice(raw.compare_at_price ?? raw.compareAtPrice),
    customizable: Boolean(raw.customizable),
    genderRestriction:
      (raw.gender_restriction as CatalogProductSummary["genderRestriction"]) ??
      null,
    active: raw.active !== false,
    featured: Boolean(raw.featured),
    wholesalerOnly: Boolean(raw.wholesaler_only ?? raw.wholesalerOnly),
    retailOnly: Boolean(raw.retail_only ?? raw.retailOnly),
    sort: Number(raw.sort ?? 0),
    imageUrl: resolveCatalogMediaUrl(raw.image_url as string | null),
    imageFit: mapImageFit(raw.image_fit ?? raw.imageFit),
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
    audience: (raw.audience as import("./types").ShopAudience) ?? "guest",
    packages,
    byType,
  };
}

export function mapHeroSlide(raw: Record<string, unknown>): HeroSlide {
  return {
    id: String(raw.id),
    imageUrl: resolveCatalogMediaUrl(raw.image_url as string | null) || "",
    kicker: (raw.kicker_ar as string | null) ?? null,
    title: String(raw.title_ar ?? ""),
    caption: (raw.caption_ar as string | null) ?? null,
    accent: (raw.accent as string | null) ?? null,
    ctaLabel: (raw.cta_label_ar as string | null) ?? null,
    ctaHref: (raw.cta_href as string | null) ?? null,
    sort: Number(raw.sort ?? 0),
    active: raw.active === undefined ? undefined : !!raw.active,
  };
}

/** Public home-slider slides (active only). */
export async function getHeroSlides(): Promise<HeroSlide[]> {
  const { data } = await api.get<{ data: Record<string, unknown>[] }>(
    "/catalog/hero"
  );
  return (data.data || []).map(mapHeroSlide);
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
  /** Optional «السعر قبل الخصم» (IQD). null/omitted = no discount. */
  compare_at_price?: number | null;
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

/** Deletes (or archives) the product. Returns mode: 'deleted' | 'archived'. */
export async function deleteCatalogProduct(
  id: string
): Promise<{ id: string; mode: "deleted" | "archived" }> {
  const { data } = await api.delete<{
    data: { id: string; mode: "deleted" | "archived" };
  }>(`/catalog/products/${id}`);
  return data.data;
}

export async function createCatalogGroup(
  productId: string,
  body: {
    name_ar: string;
    input_type?: CatalogInputType;
    required?: boolean;
    max_select?: number | null;
  }
): Promise<{ id: string }> {
  const { data } = await api.post<{ data: { id: string } }>(
    `/catalog/products/${productId}/groups`,
    body
  );
  return data.data;
}

export async function deleteCatalogGroup(groupId: string): Promise<void> {
  await api.delete(`/catalog/groups/${groupId}`);
}

export async function createCatalogOption(
  groupId: string,
  body: { label_ar: string; price_delta?: number }
): Promise<{ id: string }> {
  const { data } = await api.post<{ data: { id: string } }>(
    `/catalog/groups/${groupId}/options`,
    body
  );
  return data.data;
}

export async function deleteCatalogOption(optionId: string): Promise<void> {
  await api.delete(`/catalog/options/${optionId}`);
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

/** Lock a (child) product's option group to a single fixed option (student can't change it). */
export async function lockGroupOption(
  productId: string,
  groupId: string,
  optionId: string
): Promise<void> {
  await api.put(`/catalog/products/${productId}/lock-group-option`, {
    group_id: groupId,
    option_id: optionId,
  });
}

/** Clear the lock on a product's option group. */
export async function unlockGroupOption(
  productId: string,
  groupId: string
): Promise<void> {
  await api.delete(
    `/catalog/products/${productId}/lock-group-option/${groupId}`
  );
}

export async function uploadCatalogImage(file: File): Promise<string> {
  // Use apiUploadFile so axios sets the multipart boundary automatically — setting
  // Content-Type: multipart/form-data manually (no boundary) makes multer drop the file.
  const data = (await apiUploadFile("/catalog/uploads/image", file)) as {
    data: { url: string };
  };
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

// ─── Promo / Discount Popup Config ───────────────────────────────────────────

export interface PromoConfig {
  active: boolean;
  title_ar: string;
  message_ar: string;
  deadline: string | null;
}

/** Public endpoint — no auth required. Returns the storefront promo config. */
export async function getPromo(): Promise<PromoConfig> {
  const { data } = await api.get<{ data: PromoConfig }>("/catalog/promo");
  return data.data;
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

// ─── Full-Set Packages ────────────────────────────────────────────────────────

export interface FullSetPackage {
  id: string;
  nameAr: string;
  price: number;
  imageUrl: string | null;
  storyImageUrl: string | null;
  /** Admin-set photo gallery — when 2+ photos, the storefront tile auto-rotates. */
  gallery: string[];
  sort: number;
  description: string | null;
  badgeLabel: string | null;
  accent: string | null;
  features: string[];
  includedItems: string[];
  /** Admin-chosen products composing the set (one per type); empty → defaults by type. */
  products: { id: string; type: string; nameAr: string }[];
}

function mapFullSetPackage(raw: Record<string, unknown>): FullSetPackage {
  return {
    id: String(raw.id),
    nameAr: String(raw.name_ar ?? raw.nameAr),
    price: Number(raw.price ?? 0),
    imageUrl: resolveCatalogMediaUrl(raw.image_url as string | null),
    storyImageUrl: resolveCatalogMediaUrl(
      raw.story_image_url as string | null
    ),
    gallery: Array.isArray(raw.gallery)
      ? (raw.gallery as unknown[])
          .map((u) => resolveCatalogMediaUrl(String(u)) || String(u))
          .filter(Boolean)
      : [],
    sort: Number(raw.sort ?? 0),
    description: (raw.description as string | null) ?? null,
    badgeLabel: (raw.badge_label as string | null) ?? null,
    accent: (raw.accent as string | null) ?? null,
    features: (raw.features as string[] | null) ?? [],
    includedItems: (raw.included_items as string[] | null) ?? [],
    products: Array.isArray(raw.products)
      ? (raw.products as Record<string, unknown>[]).map((p) => ({
          id: String(p.id),
          type: String(p.type),
          nameAr: String(p.name_ar ?? ""),
        }))
      : [],
  };
}

export async function listFullSetPackages(): Promise<FullSetPackage[]> {
  const { data } = await api.get<{ data: Record<string, unknown>[] }>(
    "/catalog/packages",
    { params: { full_set: 1 } }
  );
  return (data.data || []).map(mapFullSetPackage);
}
