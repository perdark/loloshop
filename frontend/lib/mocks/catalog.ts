import type { PackageTier } from "../types";

/** Phase 10 packages API not wired yet */
export const MOCK_PACKAGES: PackageTier[] = [
  {
    id: "pkg-royal",
    nameAr: "باقة ملكي",
    price: 95000,
    sashTypeOptionId: "o-royal",
    sashTypeLabel: "ملكي خماسي",
    defaultCapOptionId: "o-cap-n",
    defaultCapLabel: "قبعة عادية",
    robeProductId: "prod-robe",
    sashProductId: "prod-sash",
    capProductId: "prod-cap",
  },
  {
    id: "pkg-normal",
    nameAr: "باقة عادي",
    price: 75000,
    sashTypeOptionId: "o-normal",
    sashTypeLabel: "وشاح عادي",
    defaultCapOptionId: "o-cap-t",
    defaultCapLabel: "قبعة مثلثة",
    robeProductId: "prod-robe",
    sashProductId: "prod-sash",
    capProductId: "prod-cap",
  },
];
