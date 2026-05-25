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

export function getJoinUrl(referralCode: string): string {
  if (typeof window === "undefined") {
    return `/join/${referralCode}`;
  }
  return `${window.location.origin}/join/${referralCode}`;
}
