import { toast } from "sonner";
import { nativeShellPlatform } from "./native-shell";

// ─────────────────────────────────────────────────────────────────────────────
// ONE way to hand a file to the user — because the iPad the design team actually
// works on breaks every other way. Measured against prod 2026-08-21:
//
//   · «تنزيل الكل (ZIP)» did `window.location.href = <API url>`. That endpoint sits
//     behind `authRequired`, and a browser NAVIGATION carries no Authorization header,
//     so it answered `401 {"error":"غير مصرح"}` — 45 bytes of JSON replacing the whole
//     workbench. That is the «صفحة فارغة» the designer reported, and it failed on every
//     browser, not only on the iPad.
//   · Every per-image «تنزيل» was `<a href={url} download>`. The `download` attribute is
//     inert inside the iOS WebView shell (WKWebView never wired it to a downloader) and
//     on the `data:` URLs the board exporter produces, so the tap NAVIGATES to the image
//     instead: a white page with the artwork in the corner and no way back. That is the
//     «صفحة نصف فارغة وفيها صورة».
//   · The ZIP fallback called `URL.revokeObjectURL` on the line after `a.click()`.
//     Safari tears the download down together with the URL, so the tap did nothing.
//
// The rules encoded here:
//   1. Anything behind auth is FETCHED (axios attaches the Bearer token) and saved as a
//      blob. Never navigate to an API URL.
//   2. Inside the iOS shell, Web Share is the only path that reaches Files / WhatsApp.
//   3. Everywhere else: a `blob:` URL — always same-origin, so `download` is honoured;
//      a CROSS-origin href is the one browsers silently ignore — plus a LATE revoke.
//   4. The caller always names the file. Plates are stored under a 32-char hash, so a
//      designer's Downloads folder used to be forty files nobody could tell apart.
// ─────────────────────────────────────────────────────────────────────────────

/** `shared` = handed to the iOS share sheet · `cancelled` = the user dismissed it. */
export type SaveOutcome = "saved" | "shared" | "cancelled";

/** Windows/macOS/iOS all refuse some of these in a filename; Arabic letters are fine. */
export function safeFileName(base: string, ext: string, fallback = "file"): string {
  const clean = (base || "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `${clean || fallback}.${ext.replace(/^\./, "")}`;
}

function shareableFiles(file: File): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  try {
    return navigator.canShare ? navigator.canShare({ files: [file] }) : false;
  } catch {
    return false;
  }
}

/** A persistent «الملف جاهز — احفظه» toast whose button opens the share sheet. */
function shareOnNextTap(file: File): Promise<SaveOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (o: SaveOutcome) => {
      if (!settled) {
        settled = true;
        resolve(o);
      }
    };
    toast("الملف جاهز", {
      description: file.name,
      duration: Infinity,
      action: {
        label: "احفظ / شارك",
        onClick: () => {
          navigator.share({ files: [file] }).then(
            () => done("shared"),
            () => done("cancelled")
          );
        },
      },
      onDismiss: () => done("cancelled"),
    });
  });
}

/** Save a blob we already hold (a ZIP from the API, a canvas export, a fetched image). */
export async function saveFile(blob: Blob, filename: string): Promise<SaveOutcome> {
  const file = new File([blob], filename, {
    type: blob.type || "application/octet-stream",
  });

  // The iOS shell has no downloader behind `download`; the share sheet is the only exit.
  // ⚠️ FILES ONLY — no `title`/`text`. Telegram/WhatsApp send the title as a separate text
  // message, so the recipient got «اسم الملف.png» as words instead of (or before) the file.
  if (nativeShellPlatform() === "ios" && shareableFiles(file)) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (e) {
      // A dismissed sheet is not a failure.
      if ((e as Error)?.name === "AbortError") return "cancelled";
      // ⚠️ NotAllowedError = the tap's user activation expired while we were still
      // fetching (a ZIP of many plates takes seconds). WebKit then refuses the sheet, and
      // the anchor below is INERT in WKWebView, so falling through looked like a success
      // toast with no file — the «الماك ما ينزل الخط» report (iOS app on a Mac/iPad,
      // 2026-10-14). Ask for one more tap: that tap is a fresh gesture the sheet accepts.
      if ((e as Error)?.name === "NotAllowedError") return shareOnNextTap(file);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Late revoke — Safari cancels an in-flight download the moment its blob URL dies.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "saved";
}

/**
 * Save a file that lives at a URL (an `/uploads` image). Fetched, not linked: the fetch
 * is what turns it into a blob we can name and hand over without navigating away.
 */
export async function saveFromUrl(url: string, filename: string): Promise<SaveOutcome> {
  try {
    // `same-origin` credentials on purpose: /uploads is static and unauthenticated, and
    // asking for credentials on a CROSS-origin read makes the browser demand a matching
    // `Access-Control-Allow-Credentials` it does not need. Prod serves the images from
    // the site's own host anyway (both hosts are in CORS_ORIGIN, verified 2026-08-21).
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await saveFile(await res.blob(), filename);
  } catch {
    // CORS or offline: fall back to the plain link. It is the behaviour this file exists
    // to replace, so it is a floor, not a fix — the tap at least still does SOMETHING
    // (on a local dev build the images come from the prod host, which is exactly this).
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return "saved";
  }
}

/** Save a `data:` URL (canvas exports). Same reason: `download` is inert on iOS here. */
export async function saveDataUrl(dataUrl: string, filename: string): Promise<SaveOutcome> {
  const res = await fetch(dataUrl);
  return saveFile(await res.blob(), filename);
}
