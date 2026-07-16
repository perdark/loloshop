"use client";

// «الفصال» — ابو عبدو's parallel track over retail pieces (no caps). Rebuilt 2026-07-16
// on the shared StationConsole: «عرض بالطلب» (students → pieces → تم الفصال per piece),
// «عرض بالقطع» (type chips + bulk), and «المنجزة» (done list with إرجاع). Ticking here
// only writes tailor_status — the production pipeline is untouched (parallel by design).

import { StationConsole } from "@/components/staff/station/StationConsole";
import { PageLoader } from "@/components/ui/Spinner";
import { useRequireAuth } from "@/hooks/useRequireAuth";

export default function StaffTailorPage() {
  const { user, loading } = useRequireAuth(["staff", "admin"]);

  if (loading || !user) return <PageLoader />;

  return <StationConsole kind="tailor" />;
}
