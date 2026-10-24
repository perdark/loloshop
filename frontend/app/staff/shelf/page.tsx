"use client";

// رف التجهيز — the preparer's main screen (presser + manager + admin can also open it).
// Retail-only: rep/دفعة pieces are handled بالجملة and stay on the existing قائمة التجهيز.

import { ShelfConsole } from "@/components/staff/shelf/ShelfConsole";
import { PageLoader } from "@/components/ui/Spinner";
import { useRequireAuth } from "@/hooks/useRequireAuth";

export default function StaffShelfPage() {
  const { user, loading } = useRequireAuth(["staff", "admin"]);

  if (loading || !user) return <PageLoader />;

  // «فرّغ الرف» wipes the whole map in one press: manager/admin here, plus anyone the server
  // names in `board.can_clear` (site_settings.shelf_clear_users — محمد عادل, 2026-10-25).
  // This only HIDES the button; lib/shelfAccess.js is what refuses everyone else.
  const canClear =
    user.role === "admin" || (user.staff_types ?? []).includes("manager");

  return <ShelfConsole canClear={canClear} />;
}
