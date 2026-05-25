export const SASH_COLOR_HEX: Record<string, string> = {
  "أبيض": "#f8f8f6",
  "رمادي فاتح": "#c8c8c8",
  "أخضر داكن": "#1f4e3d",
  "أسود": "#111111",
  "كحلي": "#0b1e3f",
  "عنابي": "#7a1f2b",
};

export function sashColorToHex(color: string | null): string {
  if (!color) return "#f8f8f6";
  return SASH_COLOR_HEX[color] || "#f8f8f6";
}

/** Designer canvas logical size (per panel) */
export const DESIGN_PANEL_WIDTH = 360;
export const DESIGN_PANEL_HEIGHT = 600;
export const HIGH_RES_PANEL_WIDTH = 1440;
export const HIGH_RES_PANEL_HEIGHT = 2400;
