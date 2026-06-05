import type { User } from "./types";

const TOKEN_KEY = "token";
const USER_KEY = "user";
// Session flag: admin/staff clicked "زيارة الموقع الرئيسي" — don't bounce them
// from "/" back to their panel until they explicitly return.
const SKIP_DASHBOARD_REDIRECT_KEY = "skipDashboardRedirect";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function setUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  clearSkipDashboardRedirect();
}

/** Panel home for dashboard roles; null for retail/wholesaler. */
export function dashboardPathFor(role: User["role"] | undefined): string | null {
  if (role === "admin") return "/admin";
  if (role === "staff") return "/staff";
  return null;
}

export function setSkipDashboardRedirect(): void {
  sessionStorage.setItem(SKIP_DASHBOARD_REDIRECT_KEY, "1");
}

export function clearSkipDashboardRedirect(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SKIP_DASHBOARD_REDIRECT_KEY);
}

export function shouldSkipDashboardRedirect(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(SKIP_DASHBOARD_REDIRECT_KEY) === "1";
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
