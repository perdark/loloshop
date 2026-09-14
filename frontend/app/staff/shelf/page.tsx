"use client";

// رف التجهيز — the preparer's main screen (presser + manager + admin can also open it).
// Retail-only: rep/دفعة pieces are handled بالجملة and stay on the existing قائمة التجهيز.

import { ShelfConsole } from "@/components/staff/shelf/ShelfConsole";
import { PageLoader } from "@/components/ui/Spinner";
import { useRequireAuth } from "@/hooks/useRequireAuth";

export default function StaffShelfPage() {
  const { user, loading } = useRequireAuth(["staff", "admin"]);

  if (loading || !user) return <PageLoader />;

  // «فرّغ الرف» wipes the whole map in one press, so it is manager/admin only — mirrors the
  // route's `requireStaffType()` (no types = manager + admin). This only HIDES the button;
  // the server is what refuses a preparer who posts the endpoint by hand.
  const canClear =
    user.role === "admin" || (user.staff_types ?? []).includes("manager");

  return <ShelfConsole canClear={canClear} />;
}
