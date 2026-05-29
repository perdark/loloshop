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
      <main className="mx-auto max-w-lg px-4 py-6 animate-page-in">{children}</main>
    </div>
  );
}
