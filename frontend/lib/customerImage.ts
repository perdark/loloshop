import type { CatalogOptionGroup, CatalogProduct } from "./types";
import type { OptionSelection } from "./pricing";

export function selectionKey(groupId: string, optionId: string): string {
  return `${groupId}:${optionId}`;
}

export function getSelectedOptionId(
  group: CatalogOptionGroup,
  selection: OptionSelection
): string | null {
  const sel = selection[group.id];
  if (sel == null || sel === false) return null;

  if (group.inputType === "single_select" && typeof sel === "string") {
    return sel;
  }
  if (group.inputType === "toggle" && sel === true) {
    return (
      group.options.find((o) => o.active)?.id ?? group.options[0]?.id ?? null
    );
  }
  if (group.inputType === "counter" && typeof sel === "number" && sel > 0) {
    return (
      group.options.find((o) => o.active)?.id ?? group.options[0]?.id ?? null
    );
  }
  return null;
}

/** Customer must upload when group or chosen option requires it. */
export function customerImageRequired(
  group: CatalogOptionGroup,
  optionId: string | null
): boolean {
  if (!optionId) return false;
  if (group.requiresCustomerImage) return true;
  const opt = group.options.find((o) => o.id === optionId);
  return Boolean(opt?.requiresCustomerImage);
}

export function validateCustomerImages(
  product: CatalogProduct,
  selection: OptionSelection,
  customerImages: Record<string, string>
): string | null {
  for (const group of product.optionGroups) {
    const optionId = getSelectedOptionId(group, selection);
    if (!customerImageRequired(group, optionId)) continue;
    const key = selectionKey(group.id, optionId!);
    if (!customerImages[key]) {
      return `صورة مطلوبة منك: ${group.nameAr}`;
    }
  }
  return null;
}
