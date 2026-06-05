import type { Metadata } from "next";
import { VipShowcase } from "@/components/vip/VipShowcase";

export const metadata: Metadata = {
  title: "باقة VIP — لولو شوب",
  description: "الإطلالة الأرقى ليوم تخرجك: خامات فاخرة، تطريز ذهبي، وتجهيز بأولوية.",
};

export default function VipPage() {
  return <VipShowcase />;
}
