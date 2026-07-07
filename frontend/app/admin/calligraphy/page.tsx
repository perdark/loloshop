"use client";

import { CalligraphyTool } from "@/components/calligraphy/CalligraphyTool";

// Thin wrapper — the tool (PageHeader + UI + logic) lives in CalligraphyTool so it
// can be shared with the designer/staff page (/staff/calligraphy). Rendered inside
// the admin layout. Auth is enforced by the admin layout (useRequireAuth("admin"))
// plus the backend guard on /calligraphy/*.
export default function CalligraphyPage() {
  return <CalligraphyTool />;
}
