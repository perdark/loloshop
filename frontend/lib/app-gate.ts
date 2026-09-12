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
 *    cannot receive a WhatsApp OTP. ⚠️ These are now the ONLY way in for those three groups:
 *    the in-app key field on /login (`TeamKeyEntry`) was deleted 2026-08-06 because students
 *    were being shown a staff entrance. Do not remove them from this list.
 *    (Updated 2026-08-08: they no longer HAVE to open in a browser — AndroidManifest.xml and
 *    the AASA document now claim these three prefixes, so on a phone with the new binary the
 *    link opens the app and DeepLinkHandler routes it. They stay allowed here anyway, because
 *    that is only true once the store build lands and App Links verify, and because the
 *    workshop/TV screens still run in a real browser.)
 *  • /staff, /design-support — the destinations those key portals hand off to. See the note
 *    on them below; allowing /s/ and /d/ without these makes the login work and the app not.
 *  • /privacy, /terms, /delete-account — Apple and Google require these reachable on the
 *    open web. Gating them risks a rejection on the next submission.
 *  • /get-app — the redirect target itself. Omitting it is an infinite redirect loop.
 *
 * NOT exempt, deliberately: /wholesaler and the whole student storefront. Reps and students
 * are the audience the app exists for (owner, 2026-09-12: staff only).
 */
export const BROWSER_ALLOWED_PREFIXES = [
  "/admin",
  // ⚠️ /join MUST stay allowed, and this is not a convenience — it is the difference between
  // a working referral and a lost student. Without it, tapping a rep's link on a phone with no
  // app installed replaces the page with the store, and NOTHING carries the code through the
  // install: Play's `?referrer=` (appended below) has no reader on our side, and iOS has no
  // deferred deep linking at all. The student installs, lands on the home page, and their
  // cohort is gone — silently, with no error anyone can see.
  // Allowing it costs nothing once App Links verify: Android intercepts /join/* BEFORE the
  // browser loads the page, so students who DO have the app still open in the app.
  // Covers both /join (the جامعة→قسم picker) and /join/<code>.
  "/join",
  "/workshop",
  "/tv/",
  "/s/",
  "/w/",
  "/d/",
  // ⚠️ /staff AND /design-support ARE THE OTHER HALF OF /s/ AND /d/ — a portal key without
  // its destination is a dead end, not an entrance. `/s/<key>` signs a staff member in and
  // immediately `router.replace("/staff")` (app/s/[key]/page.tsx:68); `/d/<key>` does the same
  // to "/design-support" (app/d/[key]/page.tsx:71). With only the key path allowed, every
  // staff member and every designer would be bounced to the store ONE NAVIGATION AFTER a
  // successful login — with a valid session, from a page that had just worked. Owner ruling
  // 2026-09-12: «make anyone opening loloshop from browser download app EXCEPT the staff».
  // (/workshop already had its pair; that is why the workshop portal never showed this.)
  "/staff",
  "/design-support",
  // ⚠️ /login IS STILL GATED, ON PURPOSE, AND THAT SHAPES HOW STAFF GET IN. A staff member
  // with no session who opens /staff is sent to /login by the page itself — a CLIENT-side
  // replace, so this head script does not re-run and they can sign in there — but a RELOAD
  // on /login bounces them to /get-app. Their entrance is the `/s/<key>` portal link, which
  // is why it is allowed above and why the in-app key field was deleted (2026-08-06:
  // students were being shown a staff entrance). Allowing /login here would open the door
  // for every student too, which is the one thing this gate exists to prevent.
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
  // `<` is escaped because JSON.stringify does NOT escape "</script>", and this string is
  // interpolated straight into an inline <script>. Every value here comes from an env var the
  // owner sets, so this is defence in depth rather than a live hole — but a stray "</script>"
  // in a store URL would close the tag early and turn the rest of the gate into page markup.
  // < is a valid JS string escape, so the parsed value is unchanged.
  const config = JSON.stringify({
    allow: BROWSER_ALLOWED_PREFIXES,
    bypass: GATE_BYPASS,
  }).replace(/</g, "\\u003c");

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
   iOS needs no equivalent — WKUserScript at document start has no version gate.
   ⚠️ THIS IS THE ONE UNAVOIDABLE COPY of lib/native-shell.ts isNativeShell(). It cannot import:
   the whole function is built as a STRING for an inline <head> script. Change one, change both. */
if(window.Capacitor||window.androidBridge)return;
for(var i=0;i<C.allow.length;i++){var a=C.allow[i];if(p===a||p.indexOf(a)===0)return;}
try{
  var q=new URLSearchParams(location.search);
  if(C.bypass&&q.get('web')===C.bypass){localStorage.setItem('loloshop_web_ok','1');return;}
  if(localStorage.getItem('loloshop_web_ok')==='1')return;
}catch(e){}
/* ONE DESTINATION FOR EVERY DEVICE — owner ruling 2026-09-12.
   Until today this sniffed the UA and sent Android straight to Play and iPhone straight to the
   App Store, so the phone visitor — who is nearly all of our traffic — never saw a LoloShop
   page at all: the shop's own landing page existed only for laptops, which almost nobody uses.
   /get-app is now the real marketing page and carries both store buttons, so the sniff is gone
   and with it the two ways it could misfire (an Android WebView below 105 that the bridge test
   could not see, and iPadOS reporting itself as Macintosh).
   ⚠️ REMOVED 2026-08-08 and still not needed: a '&referrer=join_<code>' tail on the Play URL.
   "/join" is in the allowlist above, so this line is unreachable for every /join/* path. If
   /join is ever taken OUT of the allowlist, restore it on the Play button in app/get-app —
   Play Install Referrer is the only thing that can carry a referral code through an Android
   install, and iOS has no equivalent at all. */
location.replace('/get-app');
}catch(e){}})();`;
}
