import type { CatalogOptionGroup } from "./types";

/** Optional per-sleeve embroidery toggles (migration 057). */
export function isRobeSleeveToggleGroup(group: CatalogOptionGroup): boolean {
  return (
    group.inputType === "toggle" &&
    group.nameAr.startsWith("تطريز ردن الروب")
  );
}

export function partitionRobeSleeveGroups(groups: CatalogOptionGroup[]): {
  sleeveGroups: CatalogOptionGroup[];
  otherGroups: CatalogOptionGroup[];
} {
  const sleeveGroups = groups
    .filter(isRobeSleeveToggleGroup)
    .sort((a, b) => a.sort - b.sort);
  const sleeveIds = new Set(sleeveGroups.map((g) => g.id));
  return {
    sleeveGroups,
    otherGroups: groups.filter((g) => !sleeveIds.has(g.id)),
  };
}

/** Short label inside the «ردن الروب» card (full group name stays in DB/API). */
export function robeSleeveToggleLabel(group: CatalogOptionGroup): string {
  if (group.nameAr.includes("الأيمن")) return "تطريز الردن الأيمن";
  if (group.nameAr.includes("الأيسر")) return "تطريز الردن الأيسر";
  const opt = group.options.find((o) => o.active) ?? group.options[0];
  return opt?.labelAr ?? group.nameAr;
}
