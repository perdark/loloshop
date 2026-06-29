"use client";

import { StaffAttendancePanel } from "@/components/staff/StaffAttendancePanel";
import { PageHeader } from "@/components/ui/PageHeader";

export default function StaffAttendancePage() {
  return (
    <div className="animate-step-in" dir="rtl" lang="ar">
      <PageHeader
        title="بصمة الموظف"
        subtitle="تسجيل الحضور والانصراف ومتابعة التأخير بشكل مستقل عن الراتب"
      />
      <StaffAttendancePanel />
    </div>
  );
}
