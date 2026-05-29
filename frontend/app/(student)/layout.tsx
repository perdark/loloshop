import { StudentNav } from "@/components/StudentNav";
import { SplashIntro } from "@/components/SplashIntro";

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div dir="rtl" lang="ar" className="shop-paper min-h-screen bg-cream pb-8">
      {/* Rendered outside <main> so its fixed overlay anchors to the viewport,
          not to <main>'s transformed (animate-page-in) box. */}
      <SplashIntro />
      <StudentNav />
      {/* Phone-first but no longer caged at 512px — editorial grids engage on
          tablet/desktop while mobile stays a single calm column. */}
      <main className="mx-auto w-full max-w-lg px-4 py-6 animate-page-in md:max-w-3xl lg:max-w-6xl md:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
