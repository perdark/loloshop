import { StudentHeader } from "@/components/StudentHeader";

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div dir="rtl" lang="ar" className="min-h-screen bg-cream pb-8">
      <StudentHeader />
      <main className="mx-auto max-w-lg px-4 py-6">{children}</main>
    </div>
  );
}
