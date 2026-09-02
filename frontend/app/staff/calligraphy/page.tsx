"use client";

import { useRequireAuth } from "@/hooks/useRequireAuth";
import { CalligraphyTool } from "@/components/calligraphy/CalligraphyTool";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import type { StaffType } from "@/lib/types";

// Designer/manager/embroiderer (+ admin) calligraphy tool inside the staff layout. Same
// tool as /admin/calligraphy. The backend restricts /calligraphy/* per
// `lib/calligraphyAccess.js`'s `TOOL_STAFF_TYPES` (manager/designer/embroiderer + admin).
// The page shell must gate to the SAME set — otherwise any staff role loads the tool and
// every API call 403s → a broken screen. Pushing to embroidery («تحويل للتطريز») stays a
// narrower set (`PUSH_STAFF_TYPES`, manager/designer only) — see CalligraphyTool.tsx.
export default function StaffCalligraphyPage() {
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
          message="أداة الخط العربي مخصّصة للمصممين والمطرّزين والمديرين فقط."
        />
      </div>
    );
  }

  return <CalligraphyTool backHref="/staff" />;
}
