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

/** Horizontal editor board (Fabric work surface) */
export const EDITOR_CANVAS_WIDTH = 600;
export const EDITOR_CANVAS_HEIGHT = 360;

/** Vertical sash panel aspect on garment / print */
export const SASH_PANEL_WIDTH = 360;
export const SASH_PANEL_HEIGHT = 600;

/** Production PNG per panel (4× sash panel) */
export const HIGH_RES_PANEL_WIDTH = 1440;
export const HIGH_RES_PANEL_HEIGHT = 2400;

/** @deprecated use EDITOR_CANVAS_WIDTH — kept for callers migrating */
export const DESIGN_PANEL_WIDTH = 600;
/** @deprecated use EDITOR_CANVAS_HEIGHT */
export const DESIGN_PANEL_HEIGHT = 360;
