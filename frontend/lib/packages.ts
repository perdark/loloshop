import { api } from "./api";
import { resolveCatalogMediaUrl } from "./catalog";
import type { PackageTier } from "./types";

function mapPackage(raw: Record<string, unknown>): PackageTier {
  return {
    id: String(raw.id),
    nameAr: String(raw.name_ar ?? raw.nameAr),
    price: Number(raw.price ?? 0),
    imageUrl: resolveCatalogMediaUrl(raw.image_url as string | null),
    sort: Number(raw.sort ?? 0),
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
