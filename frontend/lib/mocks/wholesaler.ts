import type { PendingStudent, WholesalerDashboard } from "../types";

export const MOCK_WHOLESALER_DASHBOARD: WholesalerDashboard = {
  deadline: "2026-04-15T00:00:00.000Z",
  studentCount: 142,
  pendingCount: 4,
  completedDesigns: 98,
  referralCode: "baghdad-cs-2026",
  referralUrl: "/join/baghdad-cs-2026",
};

export const MOCK_PENDING_STUDENTS: PendingStudent[] = [
  {
    id: "s1",
    fullName: "محمد علي حسن",
    phone: "07701112233",
    createdAt: "2026-05-22T10:00:00.000Z",
  },
  {
    id: "s2",
    fullName: "فاطمة أحمد جاسم",
    phone: "07802223344",
    createdAt: "2026-05-23T08:30:00.000Z",
  },
  {
    id: "s3",
    fullName: "حسين كريم محمود",
    phone: "07503334455",
    createdAt: "2026-05-23T14:15:00.000Z",
  },
  {
    id: "s4",
    fullName: "زينب عمر سعد",
    phone: "07704445566",
    createdAt: "2026-05-24T09:00:00.000Z",
  },
];
