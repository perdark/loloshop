import type { User } from "./types";

const TOKEN_KEY = "token";
const USER_KEY = "user";
// Trusted-device token: minted by the backend after a login/signup OTP, sent back on
// every login to skip the WhatsApp OTP for ~90 days. Deliberately survives logout (a
// normal logout keeps the device trusted); the backend clears it on password reset.
const DEVICE_TOKEN_KEY = "loloshop_device_token";
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

export function getDeviceToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(DEVICE_TOKEN_KEY);
}

export function setDeviceToken(token: string): void {
  localStorage.setItem(DEVICE_TOKEN_KEY, token);
}

/**
 * Fired whenever the signed-in state changes without a route change. Chrome's native
 * `storage` event only reaches OTHER tabs, so a component in THIS tab (the header)
 * has no way to notice that the session ended under it — after account deletion it
 * would keep offering «خروج» and «حسابي» for a user who no longer has an account.
 */
export const AUTH_CHANGED_EVENT = "loloshop:auth-changed";

function notifyAuthChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  // NOTE: device token is intentionally NOT cleared — a normal logout keeps the device
  // trusted so the user skips the OTP on their next login.
  clearSkipDashboardRedirect();
  notifyAuthChanged();
}

/**
 * Full sign-out for account DELETION, where the "keep this device trusted" tradeoff
 * that `logout()` makes no longer applies: there is no account left to come back to.
 * The backend already dropped the matching trusted_devices row, so a leftover token
 * here would only be dead weight that the next person to use the phone inherits.
 */
export function logoutAndForgetDevice(): void {
  logout();
  localStorage.removeItem(DEVICE_TOKEN_KEY);
}

/** Panel home for dashboard roles; null for retail/wholesaler. */
export function dashboardPathFor(role: User["role"] | undefined): string | null {
  if (role === "admin") return "/admin";
  if (role === "staff") return "/staff";
  if (role === "worker") return "/workshop";
  if (role === "design_helper") return "/design-support";
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

/**
 * Login URL that returns the visitor to `returnTo` after they sign in. Used to
 * gate add-to-cart / order actions for anonymous shoppers: they browse freely,
 * and only land on login when they act — then come straight back. `returnTo`
 * must be a same-origin path (starts with a single "/") or it's ignored.
 */
export function loginHref(returnTo?: string | null): string {
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return "/login";
  }
  return `/login?redirect=${encodeURIComponent(returnTo)}`;
}

/** Validate a `?redirect=` value into a safe same-origin path, or null. */
export function safeRedirectTarget(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}
