"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { getApiErrorMessage } from "@/lib/api";
import { safeFileName, saveFromUrl } from "@/lib/download";
import { ConversationList } from "@/components/studio/ConversationList";
import { Composer } from "@/components/studio/Composer";
import { LoadingBubble, MessageBubble } from "@/components/studio/MessageBubble";
import {
  createStudioConversation,
  deleteStudioConversation,
  getStudioConversation,
  getStudioConversations,
  renameStudioConversation,
  sendStudioMessage,
  type StudioConversation,
  type StudioMessage,
  type StudioMode,
  type StudioModel,
} from "@/lib/studio";

// Examples relevant to an actual shift here — marketing copy, a WhatsApp reply, or a
// generated sash mockup — never generic "write me a poem" filler.
const EXAMPLE_PROMPTS: { text: string; mode: StudioMode }[] = [
  { text: "اكتب منشور انستا قصير للترويج بباقة تخرج فيها وشاح وقبعة", mode: "chat" },
  { text: "صيغ رد واتساب مهذب لطالبة تسأل عن مدة تسليم الوشاح", mode: "chat" },
  { text: "اقترح ثلاث عبارات أنيقة تُكتب على وشاح التخرج", mode: "chat" },
  { text: "وشاح تخرج أسود مطرز بخط عربي ذهبي أنيق على خلفية بسيطة", mode: "image" },
];

let localIdSeq = 0;
function localId() {
  localIdSeq += 1;
  return `local-${Date.now()}-${localIdSeq}`;
}

/**
 * Shared by `/staff/studio`, `/design-support/studio` and `/admin/studio` — same shape as
 * `CalligraphyTool`: one component, thin page wrappers, server-side access already enforced
 * by `allowToolUser` on every `/studio/*` call (see `lib/calligraphyAccess.js`).
 */
export function StudioTool({ backHref }: { backHref?: string } = {}) {
  // ── conversations ────────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<StudioConversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StudioMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ── composer draft ───────────────────────────────────────────────────────────
  const [mode, setMode] = useState<StudioMode>("chat");
  const [text, setText] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [newModel, setNewModel] = useState<StudioModel>("gpt");
  const [sending, setSending] = useState(false);
  // Which mode the in-flight request is running as — drives the loading bubble's copy
  // ("يفكّر…" vs "يرسم الصورة… ممكن تاخذ دقيقة"), independent of whatever the composer
  // has since been reset to.
  const [pendingMode, setPendingMode] = useState<StudioMode | null>(null);

  // ── lightbox ─────────────────────────────────────────────────────────────────
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewSaving, setPreviewSaving] = useState(false);

  const threadEndRef = useRef<HTMLDivElement>(null);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId]
  );

  const refreshConversations = useCallback(async () => {
    try {
      const rows = await getStudioConversations();
      rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      setConversations(rows);
      return rows;
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحميل المحادثات"));
      return [];
    }
  }, []);

  useEffect(() => {
    refreshConversations().finally(() => setConversationsLoading(false));
  }, [refreshConversations]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pendingMode]);

  async function openConversation(id: string) {
    setDrawerOpen(false);
    setActiveId(id);
    setMessagesLoading(true);
    setMessages([]);
    try {
      const { messages: rows } = await getStudioConversation(id);
      setMessages(rows);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحميل المحادثة"));
    } finally {
      setMessagesLoading(false);
    }
  }

  function startNewConversation() {
    setActiveId(null);
    setMessages([]);
    setText("");
    setImages([]);
    setMode("chat");
    setDrawerOpen(false);
  }

  async function handleRename(id: string, title: string) {
    try {
      const updated = await renameStudioConversation(id, title);
      setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تعديل العنوان"));
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteStudioConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) startNewConversation();
      toast.success("تم حذف المحادثة");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حذف المحادثة"));
    }
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    const sentImages = images;
    const sentMode = mode;
    const sentText = trimmed;

    // Optimistic user bubble — the attached files' own blob previews, nothing server-side
    // yet. Revoked in `finally` once the real (or rolled-back) state has replaced it.
    const optimisticUrls = sentImages.map((f) => URL.createObjectURL(f));
    const optimisticId = localId();
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        role: "user",
        content: sentText,
        image_urls: optimisticUrls,
        kind: "text",
        cost_usd: 0,
        created_at: new Date().toISOString(),
      },
    ]);
    setPendingMode(sentMode);
    setText("");
    setImages([]);

    try {
      let convId = activeId;
      let isFirstMessage = false;
      if (!convId) {
        const conv = await createStudioConversation(newModel);
        convId = conv.id;
        isFirstMessage = true;
        setActiveId(conv.id);
        setConversations((prev) => [conv, ...prev]);
      }

      const { user, assistant } = await sendStudioMessage(convId, {
        text: sentText,
        mode: sentMode,
        images: sentImages,
      });

      setMessages((prev) => [...prev.filter((m) => m.id !== optimisticId), user, assistant]);

      // The server auto-titles the first message from the text it just saw — a cheap
      // full refresh keeps the sidebar's title + ordering honest without guessing it here.
      if (isFirstMessage) {
        await refreshConversations();
      } else {
        setConversations((prev) => {
          const next = prev.map((c) =>
            c.id === convId ? { ...c, updated_at: assistant.created_at } : c
          );
          next.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
          return next;
        });
      }
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      // Hand the draft back — a failed send must never cost the designer their text.
      setText(sentText);
      setImages(sentImages);
      toast.error(getApiErrorMessage(e, "تعذّر الإرسال"));
    } finally {
      optimisticUrls.forEach((u) => URL.revokeObjectURL(u));
      setPendingMode(null);
      setSending(false);
    }
  }

  function applyExample(p: { text: string; mode: StudioMode }) {
    setText(p.text);
    setMode(p.mode);
  }

  async function downloadPreview() {
    if (!previewUrl) return;
    setPreviewSaving(true);
    try {
      const out = await saveFromUrl(previewUrl, safeFileName("صورة ChatGPT", "png", "صورة"));
      if (out !== "cancelled") toast.success("تم تنزيل الصورة");
    } catch {
      toast.error("تعذّر تنزيل الصورة");
    } finally {
      setPreviewSaving(false);
    }
  }

  const conversationListProps = {
    conversations,
    loading: conversationsLoading,
    activeId,
    onSelect: openConversation,
    onNew: startNewConversation,
    onRename: handleRename,
    onDelete: handleDelete,
  };

  return (
    <div dir="rtl" lang="ar" className="flex min-h-0 flex-col">
      {backHref && (
        <div className="mb-4">
          <Link
            href={backHref}
            className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-orange-ink hover:underline"
          >
            <span aria-hidden>→</span> رجوع
          </Link>
        </div>
      )}

      <PageHeader title="ChatGPT" />

      <div className="flex h-[calc(100dvh-14rem)] min-h-[420px] overflow-hidden lg:h-[calc(100dvh-16rem)] lg:max-h-[800px] lg:min-h-[440px] rounded-2xl border border-line bg-surface shadow-[var(--shadow-soft)]">
        {/* ≥lg side column */}
        <div className="hidden w-72 shrink-0 border-e border-line lg:block">
          <ConversationList {...conversationListProps} />
        </div>

        {/* thread column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 lg:hidden">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface-sink px-3 text-sm font-semibold text-ink"
            >
              <span aria-hidden>☰</span> المحادثات
            </button>
            <p className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-ink" dir="auto">
              {activeConversation?.title || "محادثة جديدة"}
            </p>
            <span className="w-11 shrink-0" aria-hidden />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
            {messagesLoading ? (
              <p className="py-10 text-center text-sm text-ink-soft">جارٍ التحميل…</p>
            ) : messages.length === 0 && !pendingMode ? (
              <div className="flex h-full flex-col items-center justify-center gap-5 px-2 text-center">
                <EmptyState
                  title="ابدأ محادثة جديدة"
                  message="اكتب رسالة، أو جرّب أحد الأمثلة التالية:"
                />
                <div className="grid w-full max-w-lg gap-2 sm:grid-cols-2">
                  {EXAMPLE_PROMPTS.map((p) => (
                    <button
                      key={p.text}
                      type="button"
                      onClick={() => applyExample(p)}
                      className="min-h-11 rounded-xl border border-line bg-surface-sink px-3 py-2.5 text-start text-xs font-medium text-ink-soft transition-colors hover:border-orange-ink/40 hover:text-ink"
                      dir="auto"
                    >
                      {p.mode === "image" ? "🎨 " : "💬 "}
                      {p.text}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-3xl flex-col gap-3">
                {messages.map((m) => (
                  <MessageBubble key={m.id} message={m} onPreviewImage={setPreviewUrl} />
                ))}
                {pendingMode && <LoadingBubble mode={pendingMode} />}
                <div ref={threadEndRef} />
              </div>
            )}
          </div>

          <Composer
            mode={mode}
            onModeChange={setMode}
            text={text}
            onTextChange={setText}
            images={images}
            onImagesChange={setImages}
            showModelPicker={!activeId}
            model={activeConversation?.model ?? newModel}
            onModelChange={setNewModel}
            sending={sending}
            onSend={handleSend}
          />
        </div>
      </div>

      {/* phone drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/40"
            onClick={() => setDrawerOpen(false)}
            role="presentation"
          />
          <div className="absolute inset-y-0 start-0 w-[82%] max-w-xs bg-surface shadow-[var(--shadow-pop)]">
            <ConversationList {...conversationListProps} />
          </div>
        </div>
      )}

      {/* full-size image lightbox — click any thumbnail to open + download */}
      <Modal open={!!previewUrl} onClose={() => setPreviewUrl(null)} title="الصورة">
        {previewUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="" className="max-h-[70vh] w-full rounded-xl object-contain" />
            <div className="mt-3 flex justify-end">
              <Button variant="ghost" loading={previewSaving} onClick={downloadPreview}>
                تنزيل
              </Button>
            </div>
          </>
        )}
      </Modal>

    </div>
  );
}
