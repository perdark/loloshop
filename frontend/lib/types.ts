export type UserRole =
  | "admin"
  | "staff"
  | "wholesaler"
  | "retail"
  | "worker"
  | "design_helper";
export type StaffOrderScope = "retail" | "wholesaler" | "both";

export type OrderStatus =
  | "pending_approval"
  | "designing"
  | "design_complete"
  | "converting"
  | "staff_review"
  | "printing"
  | "embroidery"
  | "pressing"
  | "preparing"
  | "ready"
  | "delivered"
  | "cancelled";

/** Staff job-types (production pipeline). Meaningful only when role === "staff".
 *  "tailor" (مفصل) is a read-only view role: sees only student name + sash + American-shawl info. */
export type StaffType = "designer" | "digitizer" | "embroiderer" | "presser" | "preparer" | "manager" | "tailor";
/** Student study schedule (mandatory at signup). */
export type StudyType = "morning" | "evening";
export type SalaryTxnType = "salary_set" | "bonus" | "deduction";
export type DesignApprovalStatus = "pending" | "approved" | "rejected";
/** Who is browsing the shop — drives the package-form vs product-discovery funnel. */
export type ShopAudience = "wholesaler_student" | "retail" | "guest";

export type ProductType = "sash" | "robe" | "cap" | "shawl";
export type StudentApprovalStatus = "pending_approval" | "approved" | "rejected";

export interface WholesalerStudentRow {
  id: string;
  name: string;
  phone: string;
  status: StudentApprovalStatus;
  universityName: string | null;
  department: string | null;
  orderStatus: OrderStatus | null;
  isCompleted: boolean;
}
export type CatalogInputType = "single_select" | "toggle" | "counter";
export type GenderRestriction = "male" | "female" | null;
export type PriceRole = "wholesaler" | "retail";

export interface User {
  id: string;
  name: string;
  phone: string;
  email?: string;
  role: UserRole;
  /** Primary production role (= staff_types[0]); null/undefined for non-staff. From GET /auth/me. */
  staff_type?: StaffType | null;
  /** All production roles this staff member holds (multi-role). From GET /auth/me. */
  staff_types?: StaffType[] | null;
  /** Which order source this staff member can see. From GET /auth/me. */
  order_scope?: StaffOrderScope;
}

export interface LoginResponse {
  token: string;
  user: User;
  // Present after a login/signup OTP — a trusted-device token to skip future OTPs.
  device_token?: string;
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
  /** "retail" | "wholesaler" — populated from backend. */
  source?: "retail" | "wholesaler";
  /** Name of the staff member actively working on this order right now (fresh presence). */
  workingStaffName?: string | null;
}

export interface WholesalerPricePair {
  admin: number;
  selling: number;
}

/** Per-wholesaler admin due and student selling amount for every pricing line. */
export interface WholesalerPricingAddons {
  royal_sash: WholesalerPricePair;
  royal_cap_when_normal_sash: WholesalerPricePair;
  extra_cap_embroidery: WholesalerPricePair;
  robe_sleeve_each: WholesalerPricePair;
  american_shawl: WholesalerPricePair;
  piece_sash_normal: WholesalerPricePair;
  piece_sash_royal: WholesalerPricePair;
  piece_cap_normal: WholesalerPricePair;
  piece_cap_royal: WholesalerPricePair;
  piece_robe_normal: WholesalerPricePair;
  piece_robe_royal: WholesalerPricePair;
}

export interface AdminWholesaler {
  id: string;
  name: string;
  phone: string;
  email?: string;
  universityName?: string | null;
  department?: string | null;
  studentCount: number;
  pendingCount: number;
  deadline: string | null;
  referralCode: string;
  referralUrl: string;
  createdAt?: string;
  /** «التسعيرة»: admin-private base price, rep/student base price, and add-on surcharges. */
  adminPrice: number;
  wholesalerPrice: number;
  pricingAddons: WholesalerPricingAddons;
  /** «المستحق» — now the price-gap profit (rep/student price − admin price) across orders. */
  earnedCommission?: number;
  /** لون التطريز — per-wholesaler thread color (optional). */
  embroideryColor?: string | null;
}

export interface CreateWholesalerPayload {
  name: string;
  phone: string;
  email: string;
  password: string;
  referralCode: string;
  deadline: string;
  universityName: string;
  department: string;
  adminPrice: number;
  wholesalerPrice: number;
  pricingAddons?: WholesalerPricingAddons;
  /** لون التطريز — per-wholesaler thread color (optional). */
  embroideryColor?: string;
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
  commissionRate?: number;
  earnedCommission?: number;
  adminDue?: number;
  pricing?: {
    adminBase: number;
    sellingBase: number;
    addons: WholesalerPricingAddons;
  };
  embroideryColor?: string | null;
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
  /**
   * جامعة/قسم are inherited from the wholesaler's referral link (the student no longer
   * enters them). Optional here for any legacy caller that still sends them.
   */
  university_name?: string;
  department?: string;
  study_type: StudyType;
  instagram_username: string;
}

/** Robe tailoring measurements (قياسات الروب) in cm — not priced. */
export interface RobeMeasurements {
  shoulder_cm: number;
  /** محيط الصدر — optional */
  chest_cm?: number;
  robe_length_cm: number;
  sleeve_length_cm: number;
  /** ملاحظات لفصال الروب — optional free-text tailoring note. */
  tailor_notes?: string;
  /** صورة الوصل — optional receipt/bill photo URL (retail only). */
  receipt_image_url?: string;
}

/** Staff payroll: base salary + computed balance. */
export interface StaffSalary {
  userId: string;
  baseSalary: number;
  balance: number;
  transactions: SalaryTransaction[];
}

export interface SalaryTransaction {
  id: string;
  type: SalaryTxnType;
  amount: number;
  reasonAr: string | null;
  sourceType?: "manual" | "goal" | "attendance" | string;
  createdAt: string;
}

export type AttendanceVerificationMode =
  | "none"
  | "network"
  | "location"
  | "both"
  | "network_or_location";

export interface StaffAttendanceSettings {
  startTime: string;
  endTime: string;
  graceMinutes: number;
  deductionPerMinute: number;
  verificationMode: AttendanceVerificationMode;
  allowedIpRanges: string[];
  shopLatitude: number | null;
  shopLongitude: number | null;
  shopRadiusMeters: number;
  timezone: string;
  updatedAt?: string | null;
  isUserOverride?: boolean;
  attendanceRequired?: boolean;
}

export interface StaffAttendanceUserSetting {
  userId: string;
  staffName: string | null;
  startTime: string | null;
  endTime: string | null;
  graceMinutes: number | null;
  deductionPerMinute: number | null;
  attendanceRequired: boolean;
  hasOverride: boolean;
  updatedAt: string | null;
}

export interface StaffAttendanceRecord {
  id: string;
  userId: string;
  staffName: string | null;
  workDate: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  expectedStartTime: string;
  expectedEndTime: string;
  graceMinutes: number;
  lateMinutes: number;
  deductionAmount: number;
  deductionTransactionId: string | null;
  verificationMode: AttendanceVerificationMode;
  networkOk: boolean;
  locationOk: boolean;
  verified: boolean;
  checkInIp: string | null;
  checkOutIp: string | null;
  latitude: number | null;
  longitude: number | null;
  locationAccuracyMeters: number | null;
  distanceMeters: number | null;
  status: "present" | "late" | "missing_checkout" | "overridden";
  adminNoteAr: string | null;
  noteAr: string | null;
  workedMinutes: number;
  scheduledMinutes: number;
  overtimeMinutes: number;
  openTooLong: boolean;
  overriddenBy: string | null;
  overriddenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Staff incentive goal (e.g. "complete 15 orders before tomorrow") + live progress. */
export interface StaffGoal {
  id: string;
  userId: string;
  titleAr: string | null;
  targetCount: number;
  bonusAmount: number;
  deadline: string;
  progress: number;
  achieved: boolean;
  awarded: boolean;
  awardedAt: string | null;
  expired: boolean;
  createdAt: string;
}

/** One auto-recorded staff production action. */
export interface StaffActivity {
  id: string;
  action: string;
  orderId: string | null;
  fromStage: OrderStatus | null;
  toStage: OrderStatus | null;
  createdAt: string;
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
  /** Admin → customer hint image (guidance only) */
  imageUrl: string | null;
  sort: number;
  active: boolean;
  /** Customer → admin: must upload photo for this option value */
  requiresCustomerImage: boolean;
  /** Customer → admin: must type an instruction for this option value */
  requiresCustomerText?: boolean;
  /** Admin-set prompt shown to the customer when text is required (overrides group-level). */
  customerTextPromptAr?: string | null;
  /** Admin-set example shown inside the text box (overrides group-level). */
  customerTextPlaceholderAr?: string | null;
}

export interface CatalogOptionGroup {
  id: string;
  productId: string;
  nameAr: string;
  inputType: CatalogInputType;
  sort: number;
  required: boolean;
  /** Admin may show hint image to customer */
  hasImage: boolean;
  hintAr: string | null;
  imageUrl: string | null;
  maxSelect: number | null;
  genderRestriction: GenderRestriction;
  /** Customer → admin: must upload for any selection in this group */
  requiresCustomerImage: boolean;
  /** Customer → admin: must type an instruction for any selection in this group */
  requiresCustomerText?: boolean;
  /** Admin-set prompt shown to the customer when text is required (group-level default). */
  customerTextPromptAr?: string | null;
  /** Admin-set example shown inside the text box (group-level default). */
  customerTextPlaceholderAr?: string | null;
  options: CatalogOption[];
  inherited?: boolean;
  /** Admin locked this group to a single fixed option (student can't change it). */
  lockedOptionId?: string | null;
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
  /** Optional «السعر قبل الخصم» — when set and > basePrice, shown struck-through. */
  compareAtPrice: number | null;
  genderRestriction: GenderRestriction;
  customizable: boolean;
  active?: boolean;
  featured?: boolean;
  wholesalerOnly?: boolean;
  retailOnly?: boolean;
  sort?: number;
  imageUrl: string | null;
  imageFit: ImageFit;
  images: ProductImage[];
  priceRole?: PriceRole;
  optionGroups: CatalogOptionGroup[];
  parentId?: string | null;
  parentNameAr?: string | null;
}

export interface CatalogProductSummary {
  id: string;
  type: ProductType;
  nameAr: string;
  description: string | null;
  basePrice: number;
  /** Optional «السعر قبل الخصم» — admin-set old/compare-at price. */
  compareAtPrice: number | null;
  customizable: boolean;
  genderRestriction: GenderRestriction;
  active: boolean;
  featured: boolean;
  wholesalerOnly: boolean;
  retailOnly: boolean;
  sort: number;
  imageUrl: string | null;
  imageFit: ImageFit;
  groupCount: number;
  imageCount: number;
  parentId?: string | null;
  parentNameAr?: string | null;
}

export interface ShopPackageCard {
  id: string;
  nameAr: string;
  price: number;
  imageUrl: string | null;
  sort: number;
}

/** How a product photo fills its frame: crop-to-fill vs zoom-out-to-whole. */
export type ImageFit = "cover" | "contain";

export interface ShopProductCard {
  id: string;
  type: ProductType;
  nameAr: string;
  description: string | null;
  basePrice: number;
  /** Optional «السعر قبل الخصم» — when set and > basePrice, shown struck-through. */
  compareAtPrice: number | null;
  imageUrl: string | null;
  imageFit: ImageFit;
  featured: boolean;
  customizable: boolean;
  genderRestriction: GenderRestriction;
}

export interface ShopFeed {
  priceRole: PriceRole;
  /** wholesaler_student → redirect to package form; retail/guest → browse products. */
  audience: ShopAudience;
  packages: ShopPackageCard[];
  byType: Partial<Record<ProductType, ShopProductCard[]>>;
}

export interface HeroSlide {
  id: string;
  imageUrl: string;
  kicker: string | null;
  title: string;
  caption: string | null;
  accent: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  sort: number;
  active?: boolean;
}

export interface PackageTier {
  id: string;
  nameAr: string;
  price: number;
  imageUrl?: string | null;
  /** Second editorial photo for the VIP "story" band (admin-managed). */
  storyImageUrl?: string | null;
  /** Ordered photos that auto-rotate on the storefront package card (admin-managed). */
  gallery?: string[];
  sort?: number;
  active?: boolean;
  sashTypeOptionId: string;
  sashTypeLabel: string;
  defaultCapOptionId?: string;
  defaultCapLabel?: string;
  robeProductId?: string;
  sashProductId?: string;
  capProductId?: string;
  /** VIP tier (premium retail graduation bundle). */
  isVip?: boolean;
  /** Full graduation set (robe + cap + sash). Mutually exclusive with isVip. */
  isFullSet?: boolean;
  /** Admin-chosen catalog products this package bundles (package_products). */
  products?: { id: string; type: string; nameAr: string }[];
  description?: string | null;
  /** Ordered Arabic perks/benefits shown on the VIP showcase. */
  features?: string[];
  /** Display-only "what's inside" checklist. */
  includedItems?: string[];
  /** e.g. "VIP" / "الأفخم" — falls back to "VIP" in the UI. */
  badgeLabel?: string | null;
  /** Hex accent for the badge/halo ONLY (never body text). */
  accent?: string | null;
}

/** Result of probing whether the student has a bundle worth upgrading to VIP. */
export interface VipUpgradeContext {
  upgradeable: boolean;
  reason: "none" | "already_vip" | "in_production" | "no_student" | null;
  locator: { from_package_id?: string; checkout_group_id?: string; order_id?: string } | null;
  orderIds: string[];
  currentTotal: number;
  packageName: string | null;
  missingTypes: ProductType[];
}

export interface VipUpgradeResult {
  orderIds: string[];
  total: number;
  packageName: string;
  missingTypes: ProductType[];
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
  cost: number | null;
  profit: number | null;
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
  customerImageUrl?: string | null;
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
  breakdown: {
    label: string;
    price: number;
    qty: number;
    customerImageUrl: string | null;
  }[];
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
  /** Exact Google Fonts family name (e.g. "Aref Ruqaa"). */
  family?: string;
  /** Direct download URL for the real font files (Google zip or self-hosted).
   *  Used by the staff order view so print shops can grab the .ttf files. */
  file_url?: string | null;
  /** Weights available on the font source. Loader requests only these;
   *  Bold is disabled in the editor when 700 is absent. Defaults to [400, 700]. */
  weights?: number[];
}

export interface DesignState {
  id?: string;
  variant_id: string | null;
  sash_color: string | null;
  /** Thread/embroidery color typed by the student — stored in designs.embroidery_color. */
  embroidery_color?: string | null;
  left_canvas: unknown | null;
  right_canvas: unknown | null;
  logo_url: string | null;
  extra_image_url: string | null;
  fonts_used: string[];
  notes: string | null;
  completed: boolean;
  completed_at?: string | null;
  approval_status?: DesignApprovalStatus;
  rejection_reason?: string | null;
}
