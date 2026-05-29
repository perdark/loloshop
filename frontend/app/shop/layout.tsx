import { BrandMark } from "@/components/ui/BrandLogo";

export default function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div dir="rtl" lang="ar" className="min-h-screen bg-cream pb-8">
      <header className="surface-glass sticky top-0 z-30 px-4 py-3">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <BrandMark size={52} priority />
          <p className="font-display text-sm font-semibold tracking-wide text-ink/75">
            لولو شوب
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-6 animate-page-in">{children}</main>
    </div>
  );
}
