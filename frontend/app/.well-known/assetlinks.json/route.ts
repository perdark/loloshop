/**
 * Digital Asset Links — proves to Android that com.loloshop96.app may handle
 * https://lolo-shop96.com/join/* links. The manifest's intent-filter carries
 * android:autoVerify="true", which makes Android fetch THIS URL at install time and compare
 * the fingerprints below against the APK's signing certificate.
 *
 * ⚠️ WHICH FINGERPRINT — this is the usual way the setup fails. The app ships as an AAB, so
 * Google re-signs it with Play App Signing: the fingerprint of the LOCAL upload keystore is
 * the wrong one and verification fails silently. Use
 *   Play Console → Test and release → Setup → App integrity
 *     → App signing key certificate → SHA-256 certificate fingerprint
 * ANDROID_SHA256_CERT_FINGERPRINTS takes a comma-separated list, so while testing you can
 * include the Play key AND a local debug key and have both verify.
 *
 * Verification is soft: if it fails, /join/ links simply keep opening in the browser as they
 * always have. Nothing breaks, so a wrong value here is easy to miss — check it deliberately:
 *   adb shell pm get-app-links com.loloshop96.app
 *   https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://lolo-shop96.com&relation=delegate_permission/common.handle_all_urls
 */
const DEFAULT_PACKAGE_NAME = "com.loloshop96.app";

export const dynamic = "force-dynamic";

/**
 * Normalises to Android's expected AA:BB:… form and DROPS anything that is not a full
 * SHA-256. Validation matters here because the two realistic mistakes — pasting a SHA-1
 * fingerprint, or a truncated copy — both yield a document that looks correct to a human
 * and simply never verifies on a device.
 */
function parseFingerprints(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim().toUpperCase().replace(/[^0-9A-F]/g, ""))
    .filter((item) => item.length === 64) // 32 bytes; SHA-1 is 40 hex chars and is rejected
    .map((item) => item.match(/.{2}/g)!.join(":"));
}

export function GET() {
  const packageName = process.env.ANDROID_PACKAGE_NAME || DEFAULT_PACKAGE_NAME;
  const fingerprints = parseFingerprints(process.env.ANDROID_SHA256_CERT_FINGERPRINTS);

  if (fingerprints.length === 0) {
    return Response.json(
      {
        error:
          "ANDROID_SHA256_CERT_FINGERPRINTS is not configured, or holds no valid SHA-256 " +
          "(expects 64 hex characters per fingerprint — a SHA-1 value is rejected here).",
        package_name: packageName,
      },
      { status: 404 }
    );
  }

  return Response.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]);
}
