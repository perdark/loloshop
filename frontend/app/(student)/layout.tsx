export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div dir="rtl" lang="ar" className="min-h-screen bg-cream">
      {children}
    </div>
  );
}
