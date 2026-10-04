"use client";

import { StudioTool } from "@/components/studio/StudioTool";

// Thin wrapper — the tool lives in StudioTool so it can be shared with
// /staff/studio and /design-support/studio (mirrors app/admin/calligraphy/page.tsx).
// Auth is enforced by the admin layout (useRequireAuth("admin")) plus the backend
// guard on /studio/* (allowToolUser).
export default function StudioPage() {
  return <StudioTool backHref="/admin" />;
}
