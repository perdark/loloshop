export default function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div dir="rtl" lang="ar" className="min-h-screen bg-cream pb-8">
      <header className="border-b border-ink/10 bg-beige px-4 py-4">
        <p className="font-script text-2xl text-orange">lolo shop</p>
        <p className="font-display text-sm font-semibold text-ink">لولو شوب</p>
      </header>
      <main className="mx-auto max-w-lg px-4 py-6">{children}</main>
    </div>
  );
}
