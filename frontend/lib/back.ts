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
      return "/full-set";
    case "catalog":
      return "/#catalog";
    default:
      return fallback;
  }
}
