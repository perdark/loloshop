import { api } from "./api";
import type { NativePlatform } from "./native-shell";

/**
 * Push notifications — the web half.
 *
 * WHAT THIS REPLACES. Until now «الإشعارات» meant rows in the `notifications` table rendered
 * inside the app: a rep whose student joined at 11pm found out the next time they happened to
 * open it, and a closed phone learned nothing at all. The rows still exist and are still the
 * source of truth — this only makes them arrive.
 *
 * WHY IT LIVES IN THE WEB APP AND NOT IN THE NATIVE PROJECT. The shells are remote-URL
 * WebViews (capacitor.config.ts `server.url`), so this file is served from the site and
 * reaches already-installed apps on deploy. The ONLY parts that need a new binary are the
 * things compiled into it: `POST_NOTIFICATIONS` in AndroidManifest.xml, the Firebase
 * `google-services.json`, and the iOS `aps-environment` entitlement.
 *
 * ⚠️ EVERYTHING HERE IS BEST-EFFORT AND MUST STAY THAT WAY. A student whose phone refuses
 * notifications, or who taps «رفض» on the permission sheet, has to keep using the app
 * normally. Every call below is wrapped and every failure is swallowed to a console warning.
 */

/**
 * Which shell we are in comes from lib/native-shell.ts — the shared two-signal test, so this
 * file, DeepLinkHandler and the gate cannot disagree about what "native" means. The
 * `androidBridge` fallback matters here in particular: a phone on WebView <105 can still
 * RECEIVE pushes (delivery is native and has nothing to do with the WebView version), so only
 * the registration call has to survive that gap — and it does.
 */
export type PushPlatform = NativePlatform;

/** The token last accepted by the backend, so logout knows what to unregister. */
const STORED_TOKEN_KEY = "loloshop_push_token";

export function getStoredPushToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORED_TOKEN_KEY);
}

/**
 * Where this handset's «العروض» consent is remembered between launches.
 *
 * ⚠️ IT IS A CACHE OF A SERVER FACT, NOT THE FACT. The server owns consent —
 * `users.notification_prefs.marketing` for an account (089), `device_tokens.marketing_opt_in`
 * for an anonymous handset (095). This only exists so that a token which rotates, or a phone
 * that signs in months after it granted permission, can re-assert the consent it already gave
 * instead of silently losing it. The server ORs it in and never lowers it from a registration,
 * so a stale `true` cannot re-enrol somebody — but a stale one after an opt-out could, which is
 * exactly why `setMarketingConsent(false)` is called by every opt-out path.
 */
const MARKETING_CONSENT_KEY = "loloshop_push_marketing_consent";

/** True when this phone has tapped the consent card and not opted out since. */
export function hasMarketingConsent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(MARKETING_CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Record (or clear) the consent this phone gave. Never throws — private mode is not an error. */
export function setMarketingConsent(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) localStorage.setItem(MARKETING_CONSENT_KEY, "1");
    else localStorage.removeItem(MARKETING_CONSENT_KEY);
  } catch {
    /* the server still holds the real answer */
  }
}

/**
 * Hand a device token to the backend. Called on EVERY app launch, not just the first: FCM and
 * APNs rotate tokens on their own schedule (restore from backup, app update, or no visible
 * reason at all) and a stale token fails silently forever.
 *
 * ⚠️ NO LONGER GATED ON BEING SIGNED IN (migration 095). `device_tokens.user_id` is nullable,
 * so a phone that granted permission before it had an account registers with no owner and the
 * upsert on `token` promotes it the moment that handset signs in. Discarding those tokens was
 * why the shop could reach 165 phones out of 2,249 accounts and none of the installs that never
 * registered.
 *
 * `marketingOptIn` may only ever RAISE the flag server-side; it is never how consent is
 * withdrawn (see `setMarketingConsent`).
 */
export async function registerPushToken(
  token: string,
  platform: PushPlatform,
  { marketingOptIn = false }: { marketingOptIn?: boolean } = {}
): Promise<void> {
  await api.post("/notifications/devices", {
    token,
    platform,
    marketing_opt_in: marketingOptIn,
  });
  try {
    localStorage.setItem(STORED_TOKEN_KEY, token);
  } catch {
    // Private-mode storage failure only costs us the logout cleanup below.
  }
}

/**
 * Detach this phone from the account that is signing out.
 *
 * ⚠️ `jwt` IS PASSED EXPLICITLY, and that is the whole point. This runs from inside
 * `lib/auth.ts logout()`, and axios' request interceptor reads the token from localStorage in a
 * microtask — by which time logout has already cleared it. Without the header the request is a
 * 401, the row survives, and the next person to use the handset receives the previous
 * student's «تمت الموافقة على طلبك».
 */
export async function unregisterPushToken(jwt: string): Promise<void> {
  const token = getStoredPushToken();
  try {
    localStorage.removeItem(STORED_TOKEN_KEY);
  } catch {
    /* ignore */
  }
  if (!token || !jwt) return;
  try {
    await api.post(
      "/notifications/devices/unregister",
      { token },
      { headers: { Authorization: `Bearer ${jwt}` } }
    );
  } catch {
    // Best-effort. The backend also moves a token to its new owner on the next register,
    // so the worst case is a short window, not a permanent cross-account subscription.
  }
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.unregister();
  } catch {
    // Not in a shell, or the plugin is unavailable — nothing to detach.
  }
}

/**
 * Fired by NotificationPermissionPrompt the moment the student grants permission, so
 * PushRegistrar can attach its listeners and call `register()` in the same breath instead of
 * waiting for the next launch.
 *
 * ⚠️ THE TWO COMPONENTS SPLIT ONE JOB AND MUST NOT BE MERGED BACK. The prompt owns the ASK —
 * it is the only caller of `requestPermissions()`, because iOS gives an install exactly one
 * permission sheet and two callers is how it gets spent silently. PushRegistrar owns the
 * REGISTRATION — it needs `req.user`, so it can only run while signed in, which is far too
 * late to be the only moment the app ever asks.
 */
export const PUSH_PERMISSION_CHANGED_EVENT = "loloshop:push-permission-changed";
