/** Shared sash fabric colors for canvas + flat preview */
export const SASH_COLOR_HEX: Record<
  string,
  { base: string; light: string; dark: string }
> = {
  أبيض: { base: "#f8f8f6", light: "#ffffff", dark: "#e6e6e0" },
  "رمادي فاتح": { base: "#c8c8c8", light: "#dcdcdc", dark: "#a8a8a8" },
  "أخضر داكن": { base: "#1f4e3d", light: "#2d6a52", dark: "#143528" },
  أسود: { base: "#111111", light: "#2a2a2a", dark: "#000000" },
  كحلي: { base: "#0b1e3f", light: "#162e57", dark: "#050f23" },
  عنابي: { base: "#7a1f2b", light: "#9a2b3a", dark: "#561218" },
  ماروني: { base: "#7a1f2b", light: "#9a2b3a", dark: "#561218" },
};

export function sashHexBase(label: string): string {
  return SASH_COLOR_HEX[label]?.base ?? "#f8f8f6";
}

export type CanvasSideJson = Record<string, unknown> & {
  orientation?: string;
  sourceWidth?: number;
  sourceHeight?: number;
};
