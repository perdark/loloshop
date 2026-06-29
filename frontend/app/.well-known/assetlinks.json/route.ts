const DEFAULT_PACKAGE_NAME = "com.loloshop96.app";

export const dynamic = "force-dynamic";

function parseFingerprints(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function GET() {
  const packageName = process.env.ANDROID_PACKAGE_NAME || DEFAULT_PACKAGE_NAME;
  const fingerprints = parseFingerprints(process.env.ANDROID_SHA256_CERT_FINGERPRINTS);

  if (fingerprints.length === 0) {
    return Response.json(
      {
        error: "ANDROID_SHA256_CERT_FINGERPRINTS is not configured.",
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
