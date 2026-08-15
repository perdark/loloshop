import type { Metadata } from "next";
import { Suspense } from "react";
import { LoloChatPage } from "@/components/shop/LoloChatPage";

/**
 * «لولو» — the dedicated full-page chat. Reached from the homepage banner
 * (components/shop/AskLoloSection.tsx) and from the floating widget's
 * «الصفحة الكاملة» link (components/shop/SupportChat.tsx). Lives inside the (student) route
 * group so it shares StudentLayout's <SupportChatProvider> — the same conversation, more room.
 */

export const metadata: Metadata = {
  title: "لولو — دردشة",
  description: "اسأل لولو عن الأسعار، طلبك، أو ممثل جامعتك — تردّ عليك خلال ثواني.",
};

export default function LoloPage() {
  // useSearchParams inside LoloChatPage (the ?q= deep-link from the homepage banner's chips)
  // requires a Suspense boundary in Next 16 — same pattern as (student)/shop/page.tsx.
  return (
    <Suspense fallback={null}>
      <LoloChatPage />
    </Suspense>
  );
}
