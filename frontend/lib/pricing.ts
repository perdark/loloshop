import type {
  CatalogOption,
  CatalogOptionGroup,
  CatalogProduct,
  PriceRole,
} from "./types";

export interface PriceLine {
  key: string;
  label: string;
  amount: number;
}

export type OptionSelection = Record<
  string,
  string | string[] | number | boolean | undefined
>;

export function resolveOptionPrice(
  option: CatalogOption,
  _role: PriceRole
): number {
  return option.priceDelta;
}

export function resolveBasePrice(
  product: CatalogProduct,
  _role: PriceRole
): number {
  return product.basePrice;
}

export function computePriceBreakdown(
  product: CatalogProduct,
  selection: OptionSelection,
  role: PriceRole = "retail"
): { lines: PriceLine[]; total: number } {
  const lines: PriceLine[] = [
    {
      key: "base",
      label: `سعر أساس — ${product.nameAr}`,
      amount: resolveBasePrice(product, role),
    },
  ];

  for (const group of [...product.optionGroups].sort((a, b) => a.sort - b.sort)) {
    const sel = selection[group.id];
    if (sel == null || sel === false) continue;

    if (group.inputType === "single_select" && typeof sel === "string") {
      const opt = group.options.find((o) => o.id === sel && o.active);
      if (opt) {
        const amt = resolveOptionPrice(opt, role);
        if (amt !== 0) {
          lines.push({
            key: opt.id,
            label: `${group.nameAr}: ${opt.labelAr}`,
            amount: amt,
          });
        }
      }
    }

    if (group.inputType === "toggle" && (sel === true || sel === "yes")) {
      const opt = group.options[0];
      if (opt) {
        const amt = resolveOptionPrice(opt, role);
        lines.push({ key: opt.id, label: `${group.nameAr}: ${opt.labelAr}`, amount: amt });
      }
    }

    if (group.inputType === "counter" && typeof sel === "number" && sel > 0) {
      const opt = group.options[0];
      if (opt) {
        const unit = resolveOptionPrice(opt, role);
        const max = group.maxSelect ?? sel;
        const count = Math.min(sel, max);
        lines.push({
          key: `${opt.id}-x${count}`,
          label: `${group.nameAr} × ${count}`,
          amount: unit * count,
        });
      }
    }
  }

  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { lines, total };
}

export function validateSelection(
  product: CatalogProduct,
  selection: OptionSelection,
  studentGender: "male" | "female" | null
): string | null {
  if (
    product.genderRestriction &&
    studentGender &&
    product.genderRestriction !== studentGender
  ) {
    return "هذا المنتج غير متاح لجنسك";
  }

  for (const group of product.optionGroups) {
    if (
      group.genderRestriction &&
      studentGender &&
      group.genderRestriction !== studentGender
    ) {
      continue;
    }

    const sel = selection[group.id];
    if (group.required) {
      if (group.inputType === "single_select" && !sel) {
        return `اختر: ${group.nameAr}`;
      }
      if (group.inputType === "toggle" && !sel) {
        return `حدد: ${group.nameAr}`;
      }
      if (group.inputType === "counter" && (!sel || Number(sel) < 1)) {
        return `حدد: ${group.nameAr}`;
      }
    }

    if (group.inputType === "counter" && typeof sel === "number" && group.maxSelect) {
      if (sel > group.maxSelect) {
        return `${group.nameAr}: الحد الأقصى ${group.maxSelect}`;
      }
    }
  }

  return null;
}

export function groupVisibleForGender(
  group: CatalogOptionGroup,
  studentGender: "male" | "female" | null
): boolean {
  if (!group.genderRestriction) return true;
  if (!studentGender) return true;
  return group.genderRestriction === studentGender;
}
