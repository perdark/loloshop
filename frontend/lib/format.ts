const IQD_FORMAT = new Intl.NumberFormat("ar-IQ", {
  style: "decimal",
  maximumFractionDigits: 0,
});

const DATE_FORMAT = new Intl.DateTimeFormat("ar-IQ", {
  timeZone: "Asia/Baghdad",
  year: "numeric",
  month: "long",
  day: "numeric",
});

const DATE_SHORT = new Intl.DateTimeFormat("ar-IQ", {
  timeZone: "Asia/Baghdad",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatIQD(amount: number): string {
  return `${IQD_FORMAT.format(amount)} د.ع`;
}

/**
 * Latin → Arabic-Indic digits, for counts rendered outside `formatIQD` (positions, tallies,
 * elapsed minutes). Shared because it had started multiplying into page-local copies.
 */
export function toArabicDigits(value: number | string): string {
  return String(value).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}

/** Discount percent off the compare-at (old) price, in the same Arabic-Indic
 *  digits as prices — e.g. «خصم ٢٥٪». Returns null when there is no real discount. */
export function formatDiscountPercent(
  price: number,
  compareAtPrice: number | null | undefined
): string | null {
  if (compareAtPrice == null || compareAtPrice <= price) return null;
  const pct = Math.round((1 - price / compareAtPrice) * 100);
  if (pct <= 0) return null;
  return `خصم ${IQD_FORMAT.format(pct)}٪`;
}

export function formatDateIQ(date: string | Date | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return DATE_FORMAT.format(d);
}

export function formatDateShort(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return DATE_SHORT.format(d);
}

/**
 * «09:00» → «٩:٠٠ ص»… no: «9:00 ص». Owner decision 2026-08-27 — the shop reads and writes
 * hours in 12-hour ص/م, so every attendance surface prints them that way.
 *
 * Latin digits deliberately, matching `fmtShopDate`'s existing decision on the server: these
 * are numbers a person checks against one in their head, and scanning speed is the whole job.
 * The DATABASE keeps 24-hour `TIME` — this is a display shell and nothing else parses it back.
 *
 * ⚠️ Midnight is «12:00 ص», not «0:00 ص». الجمعة ends at 00:00 and would otherwise print a
 * zero hour that reads as an unset field.
 */
export function formatTime12(value: string | null | undefined): string {
  if (!value) return "—";
  const [hRaw, mRaw] = String(value).split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "—";
  const suffix = h < 12 ? "ص" : "م";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** «15:00 → 00:00» as one readable Arabic range, midnight included. */
export function formatShiftRange(
  start: string | null | undefined,
  end: string | null | undefined
): string {
  if (!start || !end) return "—";
  return `${formatTime12(start)} – ${formatTime12(end)}`;
}

export function getJoinUrl(referralCode: string): string {
  if (typeof window === "undefined") {
    return `/join/${referralCode}`;
  }
  return `${window.location.origin}/join/${referralCode}`;
}

const MONTHS_AR = [
  "كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران",
  "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول",
];

/** 'YYYY-MM' → «آب 2026». */
export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTHS_AR[m - 1]} ${y}`;
}

/**
 * The current month at the shop (Asia/Baghdad) plus `back` previous ones, newest first, ready
 * for a `<Select>` — shared by `/staff/team` and `/staff/me`'s activity month picker so the
 * two screens can never drift on which months are offered. No date library on purpose, same
 * as `MyMonthPanel`'s `shiftMonth`.
 */
export function recentMonthOptions(back = 5): { value: string; label: string }[] {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const y0 = Number(parts.find((p) => p.type === "year")!.value);
  const m0 = Number(parts.find((p) => p.type === "month")!.value);
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i <= back; i++) {
    const total = y0 * 12 + (m0 - 1) - i;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    out.push({ value: `${y}-${String(m).padStart(2, "0")}`, label: `${MONTHS_AR[m - 1]} ${y}` });
  }
  return out;
}
