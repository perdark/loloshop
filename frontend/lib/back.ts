/**
 * Maps a `from` search-param value to the URL the user should return to.
 * Pure utility — no React, no side effects.
 */
export function backHrefFromParam(
  from: string | null | undefined,
  fallback = "/"
): string {
  switch (from) {
    case "vip":
      return "/vip";
    case "packages":
      return "/vip";
    case "catalog":
      return "/#catalog";
    default:
      return fallback;
  }
}

/**
 * Arabic label for a known internal `from` path (staff/admin order origins).
 * Falls back to the generic «العودة».
 */
function orderBackLabel(path: string): string {
  if (path.startsWith("/admin/orders")) return "العودة للطلبات";
  if (path.startsWith("/staff/queue")) return "العودة للطلبات";
  if (path.startsWith("/staff/tailor")) return "العودة للفصال";
  if (path.startsWith("/staff/wholesalers")) return "العودة للممثل";
  if (path === "/staff") return "العودة";
  return "العودة";
}

/**
 * Resolve where an order-detail page's back button should return to.
 *
 * `fromParam` is the `?from=` value the entry point appended (the page it was
 * opened from). We only trust it when it is a **same-origin internal path**
 * (starts with "/" but not "//", which would be a protocol-relative absolute
 * URL) — never an absolute/external URL. When absent or untrusted we fall back
 * to the role's home (admin → dashboard, everyone else → /staff).
 *
 * Pure — no React, no side effects.
 */
export function orderBackTarget(
  fromParam: string | null | undefined,
  role: string
): { href: string; label: string } {
  const fallback: { href: string; label: string } =
    role === "admin"
      ? { href: "/admin", label: "العودة للوحة التحكم" }
      : { href: "/staff", label: "العودة" };

  if (!fromParam) return fallback;

  // Decode safely — a malformed value must not throw.
  let candidate = fromParam;
  try {
    candidate = decodeURIComponent(fromParam);
  } catch {
    candidate = fromParam;
  }

  // Same-origin internal path only. Must start with "/" followed by a non-slash,
  // non-backslash char (rejects "//evil.com" AND "/\evil.com", which browsers
  // normalise "\"→"/" into a protocol-relative absolute URL), and contain no
  // control/whitespace chars. Hyphens etc. are allowed (order paths carry UUIDs).
  if (!/^\/[^/\\]/.test(candidate) || /[\x00-\x1f\x7f]|\s/.test(candidate)) {
    return fallback;
  }

  return { href: candidate, label: orderBackLabel(candidate) };
}
