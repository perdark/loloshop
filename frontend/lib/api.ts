import axios, { type AxiosError } from "axios";
import { logout, getToken } from "./auth";
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

// Verify-once cache so several simultaneous 401s share a SINGLE /auth/me probe.
let sessionProbe: Promise<boolean> | null = null;

/** Is the stored token ACTUALLY dead, or did one request just 401 spuriously?
 *  Probe the auth-truth endpoint once with a raw fetch (so it never re-enters this
 *  interceptor). Returns true ONLY on a real 401 from /auth/me. A 200 means the
 *  original 401 was endpoint-specific/transient → keep the session (the whole point
 *  of the logout-narrowing). A network/5xx is inconclusive → do NOT tear down. */
async function tokenIsDead(): Promise<boolean> {
  if (sessionProbe) return sessionProbe;
  sessionProbe = (async () => {
    const token = getToken();
    if (!token) return true;
    try {
      const res = await fetch(`${baseURL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.status === 401;
    } catch {
      return false;
    } finally {
      sessionProbe = null;
    }
  })();
  return sessionProbe;
}

function redirectToLogin() {
  if (
    typeof window !== "undefined" &&
    !window.location.pathname.startsWith("/login")
  ) {
    window.location.href = "/login";
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<ApiError>) => {
    if (error.response?.status === 401 && typeof window !== "undefined") {
      const path = window.location.pathname;
      const url = error.config?.url || "";
      // Guards (kept): never bounce a user mid login/join; never let a public-catalog
      // 401 or a wrong staff-portal password trigger a logout/redirect.
      const isPublicCatalog =
        url.includes("/catalog/shop") ||
        (url.includes("/catalog/products/") && url.includes("/full"));
      const isStaffPortal = url.includes("/auth/staff-portal");
      const isAuthTruth = url.includes("/auth/me");
      const onAuthPage = path.startsWith("/login") || path.startsWith("/join");

      if (!onAuthPage && !isPublicCatalog && !isStaffPortal) {
        if (isAuthTruth) {
          // The auth-truth endpoint itself rejected us → genuinely dead. Clear the
          // session; the page guard (useRequireAuth) handles the redirect.
          logout();
        } else if (getToken() && (await tokenIsDead())) {
          // ANY other authed endpoint 401'd AND /auth/me confirms the token is dead.
          // This is what makes the fix apply EVERYWHERE — student/retail pages with no
          // useRequireAuth guard, and background polls — WITHOUT ever logging out a
          // still-valid session (a spurious 401 leaves /auth/me at 200 → no logout).
          logout();
          redirectToLogin();
        }
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
