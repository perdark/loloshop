/**
 * "Are we inside the native app?" — the single answer, shared by everything that asks.
 *
 * ⚠️ TWO SIGNALS, BECAUSE ONE IS NOT ENOUGH ON ANDROID.
 * `window.Capacitor` only exists when the bridge was injected with
 * `addDocumentStartJavaScript`, which needs `WebViewFeature.DOCUMENT_START_SCRIPT` —
 * Android WebView 105+ (Bridge.java:265-270). Below that Capacitor falls back to
 * WebViewLocalServer, which never serves our HTML because `server.url` is REMOTE, so
 * `window.Capacitor` is simply undefined inside a perfectly real app. `window.androidBridge`
 * closes that gap: MessageHandler.java:36-41 registers it on every path (WebMessageListener on
 * WebView 88+, classic addJavascriptInterface below that). iOS needs no equivalent —
 * WKUserScript at document start has no version gate.
 *
 * ⚠️ THIS FILE EXISTS SO THE ANSWER CANNOT DRIFT. Before 2026-08-08 the gate tested both
 * signals and DeepLinkHandler tested only `window.Capacitor`, while its comment claimed they
 * matched. Anything that needs the test imports it from here. The ONE unavoidable copy is the
 * gate's inline head script (lib/app-gate.ts), which is built as a string for <head> and
 * cannot import — if you change the rule here, change it there too.
 *
 * ⚠️ WHAT MATCHING THE SIGNAL DOES NOT FIX, and the decision taken on it.
 * On WebView <105 there is no Capacitor JS runtime at all, so `@capacitor/app` resolves to its
 * WEB implementation: `AppWeb.getLaunchUrl()` returns `{url: ''}` and `appUrlOpen` never fires.
 * An App Link on such a phone therefore OPENS THE APP AND DROPS THE CODE — strictly worse than
 * the old browser behaviour, and no amount of feature-detection recovers it, because reading
 * the launch intent requires the very bridge that is missing.
 * ACCEPTED, not fixed: WebView is a Play-updated component and 105 shipped in August 2022, so
 * the affected population is phones with Play Services disabled or never updated — the same
 * phones that cannot install from Play in the first place. The alternative is a native change
 * in MainActivity that no cloud session can compile or test. If a real student reports it,
 * the fix is to navigate the WebView from `onNewIntent` in the Android project.
 */

type CapacitorGlobal = {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
};

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
    /** Capacitor's Android JS interface — present on every WebView version. See above. */
    androidBridge?: unknown;
  }
}

export type NativePlatform = "android" | "ios";

/** True inside either shell, false in any browser. */
export function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.Capacitor || window.androidBridge);
}

/**
 * Which shell, or null for a browser.
 *
 * `getPlatform()` is authoritative when the bridge is there. When it is not, only the Android
 * fallback can be identified — which is correct, because that gap is Android-only.
 */
export function nativeShellPlatform(): NativePlatform | null {
  if (typeof window === "undefined") return null;
  const platform = window.Capacitor?.getPlatform?.();
  if (platform === "android" || platform === "ios") return platform;
  // "web" means @capacitor/core loaded in a browser tab, not a shell.
  if (platform) return null;
  return window.androidBridge ? "android" : null;
}
