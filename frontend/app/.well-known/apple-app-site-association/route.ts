/**
 * Apple App Site Association — the iOS half of the deep-link setup. Proves that
 * <TeamID>.com.loloshop96.app may handle https://lolo-shop96.com/join/* as a Universal
 * Link. Sits beside assetlinks.json, which does the same job for Android.
 *
 * ⚠️ THREE THINGS APPLE IS STRICT ABOUT, all satisfied by this file's location and headers:
 *   1. The path has NO file extension — hence the extensionless route folder. Never rename
 *      this to .json; iOS requests this exact path and nothing else.
 *   2. Content-Type must be application/json (set explicitly below).
 *   3. It must be served over https with NO redirect. nginx `location /` proxies straight
 *      to Next (nginx-ssl.conf:61), so that already holds.
 *
 * ⚠️ CACHING: unlike Android, Apple fetches this through its OWN CDN, which holds it for up
 * to ~24h — a fix here is NOT instant on devices. While developing, iOS Settings → Developer
 * → Associated Domains Development makes a device bypass the CDN.
 *
 * ⚠️ THIS FILE ALONE DOES NOTHING. The app must also ship the
 * `com.apple.developer.associated-domains` entitlement (injected by codemagic.yaml on the
 * ios-appstore branch), and the App ID must have the "Associated Domains" capability enabled
 * in the Apple Developer portal — otherwise the provisioning profile omits it and the
 * entitlement is stripped at signing time.
 */

const DEFAULT_BUNDLE_ID = "com.loloshop96.app";

/**
 * Paths this app claims.
 *
 * ⚠️ MUST STAY IN SYNC with the pathPrefix in android/app/src/main/AndroidManifest.xml and
 * ALLOWED_PATH_PREFIXES in components/DeepLinkHandler.tsx.
 *
 * Narrow on purpose — see docs/superpowers/specs/2026-07-31-app-only-gate.md:139. Claiming
 * "*" would make an installed app intercept every lolo-shop96.com link the student taps
 * anywhere on their phone, including ones they meant to open in a browser.
 *
 * /join/ is the rep's referral link. /s/ /w/ /d/ are the secret-key portals for staff,
 * workshop and design-team members who have no phone for the WhatsApp OTP — browser-only
 * since `TeamKeyEntry` was removed from /login on 2026-08-06, and put back in the app here.
 */
const PATHS = ["/join/*", "/s/*", "/w/*", "/d/*"];

export const dynamic = "force-dynamic";

export function GET() {
  // 10-character alphanumeric, e.g. "AB12CD34EF" — Apple Developer → Membership details.
  const teamId = (process.env.IOS_TEAM_ID || "").trim().toUpperCase();

  if (!/^[A-Z0-9]{10}$/.test(teamId)) {
    // Mirrors the assetlinks.json route: a 404 while unconfigured is retryable, whereas a
    // syntactically valid document naming the WRONG app gets cached by Apple's CDN for a
    // day — a much worse failure than absence.
    return Response.json(
      {
        error: "IOS_TEAM_ID is not configured (expects a 10-character Apple Team ID).",
        bundle_id: DEFAULT_BUNDLE_ID,
      },
      { status: 404 }
    );
  }

  const appID = `${teamId}.${DEFAULT_BUNDLE_ID}`;

  return Response.json(
    {
      applinks: {
        details: [
          {
            // iOS 13+ reads appIDs/components…
            appIDs: [appID],
            components: PATHS.map((path) => ({
              "/": path,
              comment:
                path === "/join/*"
                  ? "Wholesaler referral join link"
                  : "Team secret-key portal (phoneless staff / workshop / design)",
            })),
            // …and these two keep iOS 12 and earlier working. Apple allows both spellings
            // in one entry, so this is not a duplicate claim.
            appID,
            paths: PATHS,
          },
        ],
      },
    },
    { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" } }
  );
}
