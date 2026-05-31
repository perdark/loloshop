import { api, apiUploadFile } from "./api";
import type {
  DesignState,
  FontDef,
  Product,
  ProductType,
} from "./types";

const apiOrigin =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "http://localhost:4000";

/** Absolute URL for /uploads/* paths returned by the API */
export function resolveDesignMediaUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return `${apiOrigin}${url.startsWith("/") ? "" : "/"}${url}`;
}

export async function listProducts(type?: ProductType): Promise<Product[]> {
  const { data } = await api.get<{ data: Product[] }>("/products", {
    params: type ? { type } : undefined,
  });
  return data.data;
}

export async function getProduct(id: string): Promise<Product> {
  const { data } = await api.get<{ data: Product }>(`/products/${id}`);
  return data.data;
}

export async function listFonts(): Promise<FontDef[]> {
  const { data } = await api.get<{ data: FontDef[] }>("/fonts");
  return data.data;
}

export type SashSide = "left" | "right";

export interface MyDesignResponse {
  data: DesignState | null;
  student_status: "pending_approval" | "approved" | "rejected" | null;
  student_gender?: "male" | "female" | null;
  edit_exception?: boolean;
  /** Which side the student may edit; null = both editable (no lock). */
  editable_sash_side?: SashSide | null;
  /** Saved Fabric JSON for the locked side (rendered read-only). */
  locked_side_design?: unknown | null;
  /** True = student joined via a wholesaler/rep; false = independent retail. */
  is_rep_student?: boolean;
}

export async function getMyDesign(): Promise<MyDesignResponse> {
  const { data } = await api.get<MyDesignResponse>("/designs/me");
  return data;
}

export async function saveDesign(
  payload: Partial<DesignState>
): Promise<{ id: string }> {
  const { data } = await api.post<{ data: { id: string } }>(
    "/designs/save",
    payload
  );
  return data.data;
}

export async function completeDesign(): Promise<void> {
  await api.post("/designs/complete");
}

export async function uploadLogo(file: File): Promise<string> {
  const data = (await apiUploadFile("/designs/uploads/logo", file)) as {
    data: { url: string };
  };
  return resolveDesignMediaUrl(data.data.url);
}

export async function uploadDesignImage(file: File): Promise<string> {
  const data = (await apiUploadFile("/designs/uploads/image", file)) as {
    data: { url: string };
  };
  return resolveDesignMediaUrl(data.data.url);
}
