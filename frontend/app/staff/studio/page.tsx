"use client";

import { useRequireAuth } from "@/hooks/useRequireAuth";
import { StudioTool } from "@/components/studio/StudioTool";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import type { StaffType } from "@/lib/types";

// Designer/manager/embroiderer (+ admin) studio tool inside the staff layout. Same
// tool as /admin/studio. The backend restricts /studio/* per `lib/calligraphyAccess.js`'s
// `allowToolUser` (mayUseTool: manager/designer/embroiderer + admin) — mirrors
// app/staff/calligraphy/page.tsx exactly, since the two tools share the same access list.
export default function StaffStudioPage() {
  const { user, loading } = useRequireAuth(["staff", "admin"]);

  if (loading || !user) return <PageLoader />;

  // Mirror StaffSidebar's multi-role read: prefer the staff_types union, fall back to
  // the primary staff_type. Admin is always allowed.
  const myTypes: StaffType[] =
    user.staff_types && user.staff_types.length
      ? user.staff_types
      : user.staff_type
        ? [user.staff_type]
        : [];
  const allowed =
    user.role === "admin" ||
    myTypes.includes("manager") ||
    myTypes.includes("designer") ||
    myTypes.includes("embroiderer");

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16" dir="rtl">
        <EmptyState
          title="غير مصرّح"
          message="ChatGPT مخصّص للمصممين والمطرّزين والمديرين فقط."
        />
      </div>
    );
  }

  return <StudioTool backHref="/staff" />;
}
