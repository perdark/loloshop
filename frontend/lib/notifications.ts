import { api } from "./api";

export interface AppNotification {
  id: string;
  type: string;
  titleAr: string;
  bodyAr: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

function mapNotification(raw: Record<string, unknown>): AppNotification {
  return {
    id: String(raw.id),
    type: String(raw.type ?? ""),
    titleAr: String(raw.title_ar ?? raw.titleAr ?? ""),
    bodyAr: (raw.body_ar ?? raw.bodyAr ?? null) as string | null,
    link: (raw.link ?? null) as string | null,
    read: Boolean(raw.read),
    createdAt: String(raw.created_at ?? raw.createdAt ?? ""),
  };
}

/** Latest 50 notifications for the signed-in user (most recent first). */
export async function getNotifications(): Promise<AppNotification[]> {
  const { data } = await api.get<{ data: Record<string, unknown>[] }>(
    "/notifications"
  );
  return (data.data ?? []).map(mapNotification);
}

export async function markNotificationRead(id: string): Promise<void> {
  await api.post(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.post("/notifications/read-all");
}

// ─── «شنو تريد يوصلك؟» — notification preferences ────────────────────────────
// ⚠️ These exist because Apple's guideline 4.5.4 requires promotional push to be explicitly
// opted into from inside the app, with an in-app way to opt out. `marketing` therefore starts
// FALSE for everyone; `orders` starts true because order updates are what the app is for.

export interface NotificationPrefs {
  /** تحديثات الطلب — on by default. */
  orders: boolean;
  /** العروض والأخبار — OFF by default. Opt-in, never assumed. */
  marketing: boolean;
}

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const { data } = await api.get<{ data: NotificationPrefs }>("/notifications/prefs");
  return data.data;
}

/** Sends only the toggle that moved — the server merges, so two open tabs cannot reset each other. */
export async function updateNotificationPrefs(
  patch: Partial<NotificationPrefs>
): Promise<NotificationPrefs> {
  const { data } = await api.patch<{ data: NotificationPrefs }>("/notifications/prefs", patch);
  return data.data;
}
