import { api } from "./api";
import { resolveCatalogMediaUrl } from "./catalog";
import type { PackageTier, ProductType, VipUpgradeContext, VipUpgradeResult } from "./types";

function strArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapPackage(raw: Record<string, unknown>): PackageTier {
  return {
    id: String(raw.id),
    nameAr: String(raw.name_ar ?? raw.nameAr),
    price: Number(raw.price ?? 0),
    imageUrl: resolveCatalogMediaUrl(raw.image_url as string | null),
    storyImageUrl: resolveCatalogMediaUrl(raw.story_image_url as string | null),
    gallery: strArray(raw.gallery).map((u) => resolveCatalogMediaUrl(u) || u),
    sort: Number(raw.sort ?? 0),
    active: raw.active === undefined ? undefined : !!raw.active,
    sashTypeOptionId: String(
      raw.sash_type_option_id ?? raw.sashTypeOptionId ?? ""
    ),
    sashTypeLabel: String(raw.sash_type_label ?? raw.sashTypeLabel ?? ""),
    defaultCapOptionId: String(
      raw.default_cap_option_id ?? raw.defaultCapOptionId ?? ""
    ),
    defaultCapLabel: String(
      raw.default_cap_label ?? raw.defaultCapLabel ?? ""
    ),
    isVip: !!(raw.is_vip ?? raw.isVip),
    description: (raw.description as string | null) ?? null,
    features: strArray(raw.features),
    includedItems: strArray(raw.included_items ?? raw.includedItems),
    badgeLabel: (raw.badge_label as string | null) ?? (raw.badgeLabel as string | null) ?? null,
    accent: (raw.accent as string | null) ?? null,
  };
}

export async function listPackages(role: "wholesaler" | "retail" = "wholesaler"): Promise<PackageTier[]> {
  const { data } = await api.get<{ data: Record<string, unknown>[] }>(
    "/catalog/packages",
    { params: { role } }
  );
  return (data.data || []).map(mapPackage);
}

export async function confirmPackage(body: {
  packageId: string;
  capOptionId: string;
  batchId?: string;
}): Promise<{ orderId: string }> {
  const payload: Record<string, string> = {
    package_id: body.packageId,
    cap_option_id: body.capOptionId,
  };
  if (body.batchId) payload.batch_id = body.batchId;

  const { data } = await api.post<{
    data: { order_id: string };
  }>("/orders/configure-package", payload);

  return { orderId: String(data.data.order_id) };
}

// ---------- VIP (retail premium tier) ----------

/** Active retail VIP packages for the showcase + selectors. */
export async function listVipPackages(): Promise<PackageTier[]> {
  const { data } = await api.get<{ data: Record<string, unknown>[] }>(
    "/catalog/packages",
    { params: { role: "retail", vip: 1 } }
  );
  return (data.data || []).map(mapPackage);
}

/** Does the current student have an existing bundle worth upgrading to VIP? */
export async function getVipUpgradeContext(): Promise<VipUpgradeContext> {
  const { data } = await api.get<{ data: Record<string, unknown> }>(
    "/orders/vip-upgrade-context"
  );
  const d = data.data || {};
  return {
    upgradeable: !!d.upgradeable,
    reason: (d.reason as VipUpgradeContext["reason"]) ?? null,
    locator: (d.locator as VipUpgradeContext["locator"]) ?? null,
    orderIds: Array.isArray(d.order_ids) ? d.order_ids.map(String) : [],
    currentTotal: Number(d.current_total ?? 0),
    packageName: (d.package_name as string | null) ?? null,
    missingTypes: Array.isArray(d.missing_types)
      ? (d.missing_types as ProductType[])
      : [],
  };
}

/**
 * Re-stamp the student's existing bundle to a VIP package (server-side priced).
 * The locator fields are snake_case to match VipUpgradeContext.locator (spread it directly).
 */
export async function upgradeToVip(body: {
  packageId: string;
  from_package_id?: string;
  checkout_group_id?: string;
  order_id?: string;
}): Promise<VipUpgradeResult> {
  const payload: Record<string, string> = { package_id: body.packageId };
  if (body.from_package_id) payload.from_package_id = body.from_package_id;
  if (body.checkout_group_id) payload.checkout_group_id = body.checkout_group_id;
  if (body.order_id) payload.order_id = body.order_id;

  const { data } = await api.post<{
    data: { order_ids: string[]; total: number; package_name: string; missing_types: ProductType[] };
  }>("/orders/upgrade-vip", payload);
  const d = data.data;
  return {
    orderIds: (d.order_ids || []).map(String),
    total: Number(d.total ?? 0),
    packageName: String(d.package_name ?? ""),
    missingTypes: d.missing_types || [],
  };
}
