"use client";

// رف التجهيز — the preparer's main screen (presser + manager + admin can also open it).
// Retail-only: rep/دفعة pieces are handled بالجملة and stay on the existing قائمة التجهيز.

import { ShelfConsole } from "@/components/staff/shelf/ShelfConsole";
import { PageLoader } from "@/components/ui/Spinner";
import { useRequireAuth } from "@/hooks/useRequireAuth";

export default function StaffShelfPage() {
  const { user, loading } = useRequireAuth(["staff", "admin"]);

  if (loading || !user) return <PageLoader />;

  return <ShelfConsole />;
}
