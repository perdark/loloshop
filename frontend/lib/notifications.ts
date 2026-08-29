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

// ─── The handset's own «العروض» switch (migration 095) ───────────────────────
// ⚠️ A SECOND, SEPARATE CONSENT — not a duplicate of the two above, and the two must never be
// folded together. `NotificationPrefs` belongs to a PERSON and follows them onto their next
// phone; this belongs to a HANDSET that has no account behind it, and there is nowhere else to
// put its consent. Exactly one of the two applies to any given recipient server-side.
//
// Both endpoints take the device token as the identity, because an anonymous phone has no
// other. See the backend controller for why that trade is safe: the worst a leaked token buys
// is turning someone's offers OFF.

/** Reads this handset's flag. `null` when the device was never registered (nothing to show). */
export async function getDeviceMarketing(token: string): Promise<boolean | null> {
  try {
    const { data } = await api.get<{ data: { marketing: boolean } }>(
      "/notifications/devices/prefs",
      { params: { token } }
    );
    return data.data.marketing;
  } catch {
    // 404 = this phone has no row yet (permission never granted). The caller hides the switch
    // rather than showing a control that saves nowhere.
    return null;
  }
}

export async function setDeviceMarketing(token: string, marketing: boolean): Promise<boolean> {
  const { data } = await api.patch<{ data: { marketing: boolean } }>(
    "/notifications/devices/prefs",
    { token, marketing }
  );
  return data.data.marketing;
}
