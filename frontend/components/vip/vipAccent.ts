/** Gold default + validation for the VIP accent (badge/halo/glyph use only — never text-bearing fills). */
export const VIP_ACCENT = "#b8860b";

export function vipAccent(accent?: string | null): string {
  return accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : VIP_ACCENT;
}
