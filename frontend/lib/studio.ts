import { api } from "@/lib/api";

// «الاستوديو» — ChatGPT داخل لولو شوب. Typed wrappers over /api/studio/*
// (backend: db/migrations/113_studio.sql, see docs/superpowers/specs/2026-10-04-studio-chatgpt.md).
// Same access as الخط العربي (admin + staff manager/designer/embroiderer + design_helper),
// enforced server-side; the frontend only needs to gate the PAGE shells the same way the
// calligraphy pages already do (see app/{staff,design-support,admin}/calligraphy/page.tsx).

export type StudioModel = "gpt" | "claude";
export type StudioMode = "chat" | "image";
export type StudioMessageRole = "user" | "assistant";
export type StudioMessageKind = "text" | "image";

export interface StudioConversation {
  id: string;
  title: string | null;
  model: StudioModel;
  updated_at: string;
}

export interface StudioMessage {
  id: string;
  role: StudioMessageRole;
  content: string;
  image_urls: string[];
  kind: StudioMessageKind;
  cost_usd: number;
  created_at: string;
}

export interface StudioUsageRow {
  user_id: string;
  name: string;
  messages: number;
  images: number;
  cost_usd: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:4000";

/**
 * Resolve a stored `/uploads/studio/...` path to an absolute URL. Mirrors the same guard as
 * `lib/calligraphy.ts`'s `absUrl` and `app/design-support/page.tsx`'s `resolveImageUrl`:
 * a stored path is sometimes already absolute, never double-prefix it.
 */
export function studioImageUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

export const STUDIO_MODEL_LABEL: Record<StudioModel, string> = {
  gpt: "GPT",
  claude: "Claude",
};

/** Mirrors the backend's own cap on one message's attachments. */
export const MAX_STUDIO_IMAGES = 4;

export async function getStudioConversations(): Promise<StudioConversation[]> {
  const { data } = await api.get<{ data: StudioConversation[] }>(
    "/studio/conversations"
  );
  return data.data;
}

export async function createStudioConversation(
  model?: StudioModel
): Promise<StudioConversation> {
  const { data } = await api.post<{ data: StudioConversation }>(
    "/studio/conversations",
    model ? { model } : {}
  );
  return data.data;
}

export async function getStudioConversation(
  id: string
): Promise<{ conversation: StudioConversation; messages: StudioMessage[] }> {
  const { data } = await api.get<{
    data: { conversation: StudioConversation; messages: StudioMessage[] };
  }>(`/studio/conversations/${id}`);
  return data.data;
}

export async function renameStudioConversation(
  id: string,
  title: string
): Promise<StudioConversation> {
  const { data } = await api.patch<{ data: StudioConversation }>(
    `/studio/conversations/${id}`,
    { title }
  );
  return data.data;
}

export async function deleteStudioConversation(id: string): Promise<void> {
  await api.delete<{ ok: boolean }>(`/studio/conversations/${id}`);
}

export interface SendStudioMessageInput {
  text: string;
  mode: StudioMode;
  images?: File[];
}

/**
 * Posts one turn. Multipart — up to 4 images ride alongside the text. The timeout is
 * deliberately long: image generation on SmartAPI can take ~60s and the spec calls for a
 * 240s ceiling so a slow draw is never mistaken for a dead request.
 */
export async function sendStudioMessage(
  conversationId: string,
  input: SendStudioMessageInput
): Promise<{ user: StudioMessage; assistant: StudioMessage }> {
  const form = new FormData();
  form.append("text", input.text);
  form.append("mode", input.mode);
  for (const image of input.images ?? []) {
    form.append("images", image, image.name);
  }
  const { data } = await api.post<{ data: { user: StudioMessage; assistant: StudioMessage } }>(
    `/studio/conversations/${conversationId}/messages`,
    form,
    { timeout: 240000 }
  );
  return data.data;
}

export async function getStudioUsage(): Promise<StudioUsageRow[]> {
  const { data } = await api.get<{ data: StudioUsageRow[] }>("/studio/usage");
  return data.data;
}
