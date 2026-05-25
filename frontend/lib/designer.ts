import { api } from "./api";
import type {
  DesignState,
  FontDef,
  Product,
  ProductType,
} from "./types";

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

export interface MyDesignResponse {
  data: DesignState | null;
  student_status: "pending_approval" | "approved" | "rejected" | null;
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
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<{ data: { url: string } }>(
    "/designs/uploads/logo",
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return data.data.url;
}

export async function uploadDesignImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<{ data: { url: string } }>(
    "/designs/uploads/image",
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return data.data.url;
}
