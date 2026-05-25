export type UserRole = "admin" | "staff" | "wholesaler" | "retail";

export type OrderStatus =
  | "pending_approval"
  | "designing"
  | "design_complete"
  | "staff_review"
  | "printing"
  | "ready"
  | "delivered"
  | "cancelled";

export type ProductType = "sash" | "robe" | "cap" | "shawl";
export type CatalogInputType = "single_select" | "toggle" | "counter";
export type GenderRestriction = "male" | "female" | null;
export type PriceRole = "wholesaler" | "retail";

export interface User {
  id: string;
  name: string;
  phone: string;
  email?: string;
  role: UserRole;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface AdminAnalytics {
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  orderCount: number;
  ordersByStatus: Record<string, number>;
  dailyOrders: { date: string; count: number; revenue: number }[];
  topWholesalers: {
    id: string;
    name: string;
    orderCount: number;
  }[];
}

export interface AdminAccounting {
  totals: {
    revenue: number;
    cost: number;
    profit: number;
    orders: number;
  };
  byBatch: AccountingRow[];
  byWholesaler: AccountingRow[];
  independentRetail: AccountingRow;
}

export interface AccountingRow {
  id?: string;
  label: string;
  revenue: number;
  cost: number;
  profit: number;
  orders: number;
}

export interface AdminOrder {
  id: string;
  studentId: string;
  studentName: string;
  universityName: string | null;
  department: string | null;
  productName: string;
  wholesalerName: string | null;
  price: number;
  cost: number | null;
  profit: number | null;
  status: OrderStatus;
  createdAt: string;
}

export interface AdminWholesaler {
  id: string;
  name: string;
  phone: string;
  email?: string;
  studentCount: number;
  pendingCount: number;
  deadline: string | null;
  referralCode: string;
  referralUrl: string;
  createdAt?: string;
}

export interface CreateWholesalerPayload {
  name: string;
  phone: string;
  email: string;
  password: string;
  referralCode: string;
  deadline: string;
}

export interface CreateWholesalerResult {
  id: string;
  referralUrl: string;
}

export interface WholesalerDashboard {
  deadline: string | null;
  studentCount: number;
  pendingCount: number;
  completedDesigns: number;
  referralUrl: string;
  referralCode: string;
}

export interface PendingStudent {
  id: string;
  fullName: string;
  phone: string;
  email?: string;
  universityName?: string;
  department?: string;
  createdAt: string;
}

export interface JoinPayload {
  full_name_third: string;
  phone: string;
  email: string;
  password: string;
}

export interface ApiError {
  message?: string;
  error?: string;
  code?: string;
}

export interface CatalogOption {
  id: string;
  groupId: string;
  labelAr: string;
  priceDelta: number;
  imageUrl: string | null;
  sort: number;
  active: boolean;
}

export interface CatalogOptionGroup {
  id: string;
  productId: string;
  nameAr: string;
  inputType: CatalogInputType;
  sort: number;
  required: boolean;
  hasImage: boolean;
  hintAr: string | null;
  imageUrl: string | null;
  maxSelect: number | null;
  genderRestriction: GenderRestriction;
  options: CatalogOption[];
}

export interface ProductImage {
  id: string;
  url: string;
  sort: number;
}

export interface CatalogProduct {
  id: string;
  type: ProductType;
  nameAr: string;
  description: string | null;
  basePrice: number;
  genderRestriction: GenderRestriction;
  customizable: boolean;
  active?: boolean;
  featured?: boolean;
  sort?: number;
  imageUrl: string | null;
  images: ProductImage[];
  priceRole?: PriceRole;
  optionGroups: CatalogOptionGroup[];
}

export interface CatalogProductSummary {
  id: string;
  type: ProductType;
  nameAr: string;
  description: string | null;
  basePrice: number;
  customizable: boolean;
  genderRestriction: GenderRestriction;
  active: boolean;
  featured: boolean;
  sort: number;
  imageUrl: string | null;
  groupCount: number;
  imageCount: number;
}

export interface ShopPackageCard {
  id: string;
  nameAr: string;
  price: number;
  imageUrl: string | null;
  sort: number;
}

export interface ShopProductCard {
  id: string;
  type: ProductType;
  nameAr: string;
  description: string | null;
  basePrice: number;
  imageUrl: string | null;
  featured: boolean;
  customizable: boolean;
  genderRestriction: GenderRestriction;
}

export interface ShopFeed {
  priceRole: PriceRole;
  packages: ShopPackageCard[];
  byType: Partial<Record<ProductType, ShopProductCard[]>>;
}

export interface PackageTier {
  id: string;
  nameAr: string;
  price: number;
  sashTypeOptionId: string;
  sashTypeLabel: string;
  defaultCapOptionId: string;
  defaultCapLabel: string;
  robeProductId: string;
  sashProductId: string;
  capProductId: string;
}

export interface BatchSummary {
  id: string;
  nameAr: string;
  deadline: string | null;
  wholesalerId: string | null;
  wholesalerName: string | null;
  grandTotal: number;
  orderCount: number;
}

export interface BatchStudentDetail {
  id: string;
  name: string;
  fullNameThird: string | null;
  status: string;
  total: number;
  orderCount: number;
}

export interface BatchDetail {
  id: string;
  nameAr: string;
  deadline: string | null;
  wholesalerId: string | null;
  students: BatchStudentDetail[];
  grandTotal: number;
}

export interface OrderBreakdownLine {
  label: string;
  price: number;
  groupId?: string | null;
  optionId?: string | null;
  qty?: number;
}

export interface ConfigureOrderResult {
  orderId: string;
  priceRole: PriceRole;
  total: number;
  breakdown: OrderBreakdownLine[];
}

export interface OrderBreakdownDetail {
  id: string;
  productName: string;
  studentName: string;
  total: number;
  status: OrderStatus;
  createdAt: string;
  breakdown: { label: string; price: number; qty: number }[];
}

export interface ProductVariant {
  id: string;
  product_id?: string;
  color: string | null;
  material: string | null;
  size: string | null;
  price: number;
  image_url: string | null;
}

export interface Product {
  id: string;
  type: ProductType;
  name_ar: string;
  description: string | null;
  base_price: number;
  customizable: boolean;
  variants: ProductVariant[];
}

export interface FontDef {
  id: string;
  name_ar: string;
  script: "arabic" | "latin";
  style: string;
  source: "google" | "local";
}

export interface DesignState {
  id?: string;
  variant_id: string | null;
  sash_color: string | null;
  left_canvas: unknown | null;
  right_canvas: unknown | null;
  logo_url: string | null;
  extra_image_url: string | null;
  fonts_used: string[];
  notes: string | null;
  completed: boolean;
  completed_at?: string | null;
}
