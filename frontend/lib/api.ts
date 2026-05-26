import axios, { type AxiosError } from "axios";
import { logout } from "./auth";
import type { ApiError } from "./types";

const baseURL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "http://localhost:4000";

export const api = axios.create({
  baseURL: `${baseURL}/api`,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  // Default json Content-Type breaks multer — server returns «لم يتم رفع ملف»
  if (typeof FormData !== "undefined" && config.data instanceof FormData) {
    if (typeof config.headers.setContentType === "function") {
      config.headers.setContentType(false);
    } else if (typeof config.headers.delete === "function") {
      config.headers.delete("Content-Type");
    } else {
      delete config.headers["Content-Type"];
    }
  }
  return config;
});

/** Multipart upload — reuses the axios instance (interceptor strips the JSON
 *  Content-Type for FormData) so auth + 401 handling stay unified. */
export async function apiUploadFile(
  path: string,
  file: File,
  fieldName = "file"
): Promise<unknown> {
  const form = new FormData();
  form.append(fieldName, file, file.name);
  const { data } = await api.post(path, form);
  return data;
}

api.interceptors.response.use(
  (res) => res,
  (error: AxiosError<ApiError>) => {
    if (error.response?.status === 401 && typeof window !== "undefined") {
      const path = window.location.pathname;
      const url = error.config?.url || "";
      const isPublicCatalog =
        url.includes("/catalog/shop") ||
        url.includes("/catalog/products/") && url.includes("/full");
      if (
        !isPublicCatalog &&
        !path.startsWith("/login") &&
        !path.startsWith("/join")
      ) {
        logout();
      }
    }
    return Promise.reject(error);
  }
);

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (data && typeof data === "object") {
      const msg =
        (data as ApiError).error || (data as ApiError).message;
      if (msg) return msg;
    }
    return fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
