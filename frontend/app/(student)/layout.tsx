import Link from "next/link";
import { StudentNav } from "@/components/StudentNav";
import { SplashIntro } from "@/components/SplashIntro";
import { DiscountPopup } from "@/components/DiscountPopup";
import { VisitBeacon } from "@/components/VisitBeacon";
import { Onboarding } from "@/components/student/Onboarding";
import { FooterSignature } from "@/components/shop/FooterSignature";
import { SupportChat } from "@/components/shop/SupportChat";
import { SupportChatProvider } from "@/components/shop/SupportChatProvider";

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    /* `app-chrome` (globals.css): no text selection, no iOS long-press callout — the
       storefront is shipped as a WebView app and selectable text is the loudest "this is a
       website" tell. Scoped here, NOT on <body>, so /admin, /staff and /wholesaler keep
       selection: copying an order id or a phone number there is real work. */
    <div dir="rtl" lang="ar" className="app-chrome shop-paper min-h-screen bg-cream pb-8">
      {/* Rendered outside <main> so fixed overlays anchor to the viewport,
          not to <main>'s transformed (animate-page-in) box. */}
      <SplashIntro />
      <Onboarding />
      <DiscountPopup />
      <VisitBeacon />
      {/* One assistant conversation for the whole storefront. The provider renders no DOM of
          its own; it has to sit above BOTH the floating panel and <main> because the home
          page's «عندك سؤال؟» section is a second view of the same thread. */}
      <SupportChatProvider>
        {/* Fixed overlay — belongs beside the other fixed children, outside <main>, whose
            animate-page-in transform would otherwise become its containing block. */}
        <SupportChat />
        <StudentNav />
        {/* Phone-first but no longer caged at 512px — editorial grids engage on
            tablet/desktop while mobile stays a single calm column. */}
        <main className="mx-auto w-full max-w-lg px-4 py-6 animate-page-in md:max-w-3xl lg:max-w-6xl md:px-6 lg:px-8">
          {children}
        </main>
      </SupportChatProvider>
      {/* Clears the fixed bottom tab bar (56px + safe area) so the footer and
          any page's last row are never trapped underneath it. */}
      <footer
        className="border-t border-line px-4 py-10 sm:px-6"
        style={{ paddingBottom: "calc(6rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-script text-3xl leading-none text-orange-ink">lolo shop</p>
          <p className="mx-auto mt-4 max-w-[40ch] text-sm leading-relaxed text-ink-soft">
            افضل اللحظات تطرز من اصحاب الخبرة{" "}
            <br />
            <a
              href="https://instagram.com/lolo_shop96"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-orange-ink underline underline-offset-2"
            >
              @lolo_shop96
            </a>
            .
          </p>
          <nav
            aria-label="روابط قانونية"
            className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs font-semibold text-muted"
          >
            <Link className="transition hover:text-orange-ink" href="/privacy">
              سياسة الخصوصية
            </Link>
            <Link className="transition hover:text-orange-ink" href="/terms">
              شروط الاستخدام
            </Link>
          </nav>
          <FooterSignature />
        </div>
      </footer>
    </div>
  );
}
