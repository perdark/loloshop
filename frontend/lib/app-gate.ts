/**
 * App-only gate — the website becomes a download wall for the native app.
 *
 * THE FACT THIS IS BUILT ON: `capacitor.config.ts` sets `server.url` to
 * https://lolo-shop96.com, so the Android/iOS binaries are webview shells that load
 * THIS SITE. App and website are one artifact — you cannot strip one without the other.
 * Verified in node_modules/@capacitor/android/.../Bridge.java: the remote server.url is
 * added to `allowedOriginRules` (L241) and the bridge is injected with
 * `addDocumentStartJavaScript` (L265), so `window.Capacitor` exists in the ALREADY-SHIPPED
 * binaries. That is why this ships by website deploy alone — no rebuild, no App Review.
 *
 * The gate is product routing, NOT a security boundary. JWT + role checks remain the only
 * thing protecting data; a spoofed UA gets you a page, never an authorisation.
 */

/**
 * Paths that stay open in a normal browser. Everything else is bounced to the store.
 *
 * Owner decisions (2026-07-31):
 *  • /admin  — runs the shop from a laptop AND the phone app; exempting it gives both for free
 *  • /workshop, /tv — the workshop floor display lives on a browser on a real screen
 *  • /s /w /d — secret-key portals for staff/workshop/design-team who have NO phone and so
 *    cannot receive a WhatsApp OTP. Kept as the browser fallback; the in-app route is the
 *    key field on /login (see TeamKeyEntry).
 *  • /privacy, /terms, /delete-account — Apple and Google require these reachable on the
 *    open web. Gating them risks a rejection on the next submission.
 *  • /get-app — the redirect target itself. Omitting it is an infinite redirect loop.
 */
export const BROWSER_ALLOWED_PREFIXES = [
  "/admin",
  "/workshop",
  "/tv/",
  "/s/",
  "/w/",
  "/d/",
  "/privacy",
  "/terms",
  "/delete-account",
  "/get-app",
  "/manifest.json",
  "/.well-known/",
] as const;

/** Play listing. The package id is fixed by the published binary — do not change it. */
export const PLAY_URL =
  process.env.NEXT_PUBLIC_PLAY_URL ||
  "https://play.google.com/store/apps/details?id=com.loloshop96.app";

/**
 * App Store listing. Needs the numeric id (apps.apple.com/.../id123456789), which cannot be
 * derived from the bundle id offline. UNSET IS SAFE: iOS falls back to /get-app rather than
 * sending students to a broken Apple link.
 */
export const APP_STORE_URL = process.env.NEXT_PUBLIC_APPSTORE_URL || "";

/** Kill switch. Anything other than "1" disables the gate and the site behaves as it does today. */
export const APP_ONLY = process.env.NEXT_PUBLIC_APP_ONLY === "1";

/**
 * Per-device escape hatch: /login?web=<token> unlocks the browser for that device only.
 * Unset (the default) means no bypass exists at all. This is a debugging aid for the owner,
 * not a security control — see the header note.
 */
export const GATE_BYPASS = process.env.NEXT_PUBLIC_GATE_BYPASS || "";

/**
 * Builds the gate as a self-contained blocking script for <head>.
 *
 * Why an inline head script and not a React effect: Capacitor injects its bridge at document
 * start, so `window.Capacitor` is already readable here — which lets us decide BEFORE first
 * paint. A useEffect gate would flash the real page to every browser visitor first.
 */
export function buildGateScript(): string {
  const config = JSON.stringify({
    allow: BROWSER_ALLOWED_PREFIXES,
    play: PLAY_URL,
    ios: APP_STORE_URL,
    bypass: GATE_BYPASS,
  });

  return `(function(){try{
var C=${config},p=location.pathname;
/* Two native signals, because ONE IS NOT ENOUGH ON ANDROID.
   Bridge.java:266 only injects the bridge (and therefore window.Capacitor) when
   WebViewFeature.DOCUMENT_START_SCRIPT is supported — that is Android WebView 105+.
   Below 105 Capacitor falls back to WebViewLocalServer, which never serves our HTML
   because server.url is REMOTE, so window.Capacitor is undefined and the app would
   redirect ITSELF to the Play Store. window.androidBridge closes exactly that gap:
   MessageHandler.java:25-41 registers it on every path (WebMessageListener on
   WebView 88+, classic addJavascriptInterface below that).
   iOS needs no equivalent — WKUserScript at document start has no version gate. */
if(window.Capacitor||window.androidBridge)return;
for(var i=0;i<C.allow.length;i++){var a=C.allow[i];if(p===a||p.indexOf(a)===0)return;}
try{
  var q=new URLSearchParams(location.search);
  if(C.bypass&&q.get('web')===C.bypass){localStorage.setItem('loloshop_web_ok','1');return;}
  if(localStorage.getItem('loloshop_web_ok')==='1')return;
}catch(e){}
var ua=navigator.userAgent||'';
var m=p.match(/^\\/join\\/([^\\/?#]+)/);
if(/android/i.test(ua)){
  var u=C.play;
  /* Invisible, free, and the only thing that can make Android joins fully automatic later
     (Play Install Referrer) without burning another store review. */
  if(m)u+='&referrer='+encodeURIComponent('join_'+m[1]);
  location.replace(u);
}else if(/iphone|ipad|ipod/i.test(ua)||(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1)){
  /* iPadOS reports itself as Macintosh; maxTouchPoints is what separates it from a real Mac. */
  location.replace(C.ios||'/get-app');
}else{
  location.replace('/get-app');
}
}catch(e){}})();`;
}
