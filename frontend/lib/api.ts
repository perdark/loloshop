import axios, { type AxiosError } from "axios";
import { logout } from "./auth";
import { compressImageForUpload } from "./imageCompress";
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
 *  Content-Type for FormData) so auth + 401 handling stay unified.
 *
 *  Images are downscaled in the browser first (see lib/imageCompress.ts). It lives here,
 *  at the single choke point every upload already passes through, rather than in each of
 *  the eleven callers — a new upload screen then cannot forget it. Non-images and files
 *  already small enough are passed through untouched, and a compression failure always
 *  falls back to the original file.
 *
 *  Pass `compress: false` for artwork that must stay pixel-exact. */
export async function apiUploadFile(
  path: string,
  file: File,
  fieldName = "file",
  { compress = true }: { compress?: boolean } = {}
): Promise<unknown> {
  const payload = compress ? await compressImageForUpload(file) : file;
  const form = new FormData();
  form.append(fieldName, payload, payload.name);
  const { data } = await api.post(path, form);
  return data;
}

api.interceptors.response.use(
  (res) => res,
  (error: AxiosError<ApiError>) => {
    if (error.response?.status === 401 && typeof window !== "undefined") {
      const path = window.location.pathname;
      const url = error.config?.url || "";
      // SINGLE SOURCE OF TRUTH FOR LOGOUT: only the auth-truth endpoint (/auth/me,
      // called by useRequireAuth on protected dashboard loads) may tear down the
      // session. Background polls (notifications every 30s, queues, the my-order
      // approval poll, …) can return a transient/spurious 401 — those must NOT nuke a
      // valid 7-day session, and a browsing student with a stale token must NOT be
      // hard-redirected to /login. A genuinely expired token still logs out: the next
      // dashboard load hits /auth/me → 401 → here → logout(). (Earlier this session a
      // "verify-on-401 + global redirect" variant flooded the server with /auth/me
      // probes and yanked students to /login on every stale-token 401 — reverted.)
      const isAuthTruth = url.includes("/auth/me");
      const isPublicCatalog =
        url.includes("/catalog/shop") ||
        (url.includes("/catalog/products/") && url.includes("/full"));
      const isStaffPortal = url.includes("/auth/staff-portal");
      if (
        isAuthTruth &&
        !isPublicCatalog &&
        !isStaffPortal &&
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

/** HTTP status when the failure came from Axios; null for network/client errors. */
export function getApiErrorStatus(error: unknown): number | null {
  return axios.isAxiosError(error) ? (error.response?.status ?? null) : null;
}
