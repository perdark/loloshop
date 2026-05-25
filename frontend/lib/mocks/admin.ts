import type {
  AdminAnalytics,
  AdminOrder,
  AdminWholesaler,
  OrderStatus,
} from "../types";

export const MOCK_WHOLESALERS: AdminWholesaler[] = [
  {
    id: "w1",
    name: "أحمد الكاظمي",
    phone: "07701234567",
    studentCount: 142,
    pendingCount: 5,
    deadline: "2026-04-15T00:00:00.000Z",
    referralCode: "baghdad-cs-2026",
    referralUrl: "/join/baghdad-cs-2026",
  },
  {
    id: "w2",
    name: "سارة الجبوري",
    phone: "07809876543",
    studentCount: 89,
    pendingCount: 2,
    deadline: "2026-05-01T00:00:00.000Z",
    referralCode: "basra-med-2026",
    referralUrl: "/join/basra-med-2026",
  },
  {
    id: "w3",
    name: "علي الحيدري",
    phone: "07501112233",
    studentCount: 56,
    pendingCount: 0,
    deadline: "2026-03-30T00:00:00.000Z",
    referralCode: "mosul-eng-2026",
    referralUrl: "/join/mosul-eng-2026",
  },
];

const statuses: OrderStatus[] = [
  "pending_approval",
  "designing",
  "design_complete",
  "staff_review",
  "printing",
  "ready",
  "delivered",
];

export const MOCK_ORDERS: AdminOrder[] = Array.from({ length: 10 }, (_, i) => {
  const price = 45000 + i * 2500;
  const cost = 28000 + i * 1500;
  const w = MOCK_WHOLESALERS[i % 3];
  return {
    id: `o${i + 1}`,
    studentId: `st${i + 1}`,
    studentName: `طالب ${i + 1} محمد علي حسن`,
    universityName: "جامعة بغداد",
    department: "علوم حاسوب",
    productName: i % 3 === 0 ? "روب تخرج" : "وشاح تخرج",
    price,
    cost,
    profit: price - cost,
    status: statuses[i % statuses.length],
    wholesalerName: w.name,
    createdAt: new Date(2026, 4, 18 - i).toISOString(),
  };
});

export const MOCK_ANALYTICS: AdminAnalytics = {
  totalRevenue: 4850000,
  totalCost: 3120000,
  totalProfit: 1730000,
  orderCount: 258,
  ordersByStatus: {
    pending_approval: 12,
    designing: 28,
    design_complete: 15,
    staff_review: 8,
    printing: 22,
    ready: 14,
    delivered: 156,
    cancelled: 3,
  },
  dailyOrders: [
    { date: "2026-05-18", count: 8, revenue: 400000 },
    { date: "2026-05-19", count: 12, revenue: 600000 },
    { date: "2026-05-20", count: 6, revenue: 300000 },
    { date: "2026-05-21", count: 15, revenue: 750000 },
    { date: "2026-05-22", count: 11, revenue: 550000 },
    { date: "2026-05-23", count: 9, revenue: 450000 },
    { date: "2026-05-24", count: 14, revenue: 700000 },
  ],
  topWholesalers: MOCK_WHOLESALERS.map((w, i) => ({
    id: w.id,
    name: w.name,
    orderCount: 80 - i * 15,
  })),
};
