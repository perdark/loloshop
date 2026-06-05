"use client";

// TEMP PREVIEW — mock-data render of the VIP showcase for design screenshots.
// Not linked anywhere; safe to delete. Lets the page render without the backend.
import type { PackageTier } from "@/lib/types";
import { VipShowcaseView } from "@/components/vip/VipShowcaseView";

const MOCK: PackageTier = {
  id: "vip-1",
  nameAr: "باقة VIP الفاخرة",
  price: 350000,
  imageUrl: null,
  sashTypeOptionId: "",
  sashTypeLabel: "",
  isVip: true,
  description:
    "الإطلالة الأرقى ليوم تخرّجك — خامات فاخرة، تطريز ذهبي يدوي، وأولوية في التجهيز مع تغليف هدية أنيق.",
  features: [
    "خامة فاخرة مستوردة",
    "تطريز ذهبي يدوي",
    "تجهيز سريع بأولوية قصوى",
    "تغليف هدية فاخر",
  ],
  includedItems: ["وشاح فاخر", "قبعة مطرّزة", "تطريز ذهبي", "تغليف هدية"],
  badgeLabel: "VIP",
  accent: "#b8860b",
};

export default function VipPreviewPage() {
  return (
    <VipShowcaseView
      packages={[MOCK]}
      standardPrice={300000}
      onPick={() => {}}
      onStandard={() => {}}
      onUpgrade={() => {}}
      upgradeable
      busyId={null}
      upgrading={false}
    />
  );
}
