"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatDateShort } from "@/lib/format";
import { STUDIO_MODEL_LABEL, type StudioConversation } from "@/lib/studio";

interface ConversationListProps {
  conversations: StudioConversation[];
  loading: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  /** Rendered once, above the admin/manager affordances a plain designer never sees. */
  usageAction?: React.ReactNode;
}

/**
 * The conversation column. One component serves both the ≥lg side rail (always visible,
 * rendered by the caller inside a fixed-width column) and the phone drawer (rendered inside
 * an overlay) — the caller decides the chrome around it, this just lists + acts.
 */
export function ConversationList({
  conversations,
  loading,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  usageAction,
}: ConversationListProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function startRename(c: StudioConversation) {
    setRenamingId(c.id);
    setRenameDraft(c.title || "");
  }

  function commitRename() {
    if (renamingId && renameDraft.trim()) {
      onRename(renamingId, renameDraft.trim());
    }
    setRenamingId(null);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-line p-3">
        <Button variant="primary" fullWidth onClick={onNew}>
          + محادثة جديدة
        </Button>
        {usageAction}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="px-2 py-4 text-center text-sm text-ink-soft">جارٍ التحميل…</p>
        ) : conversations.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-ink-soft">
            لا توجد محادثات بعد — ابدأ محادثة جديدة.
          </p>
        ) : (
          <ul className="space-y-1">
            {conversations.map((c) => {
              const active = c.id === activeId;
              return (
                <li key={c.id}>
                  {renamingId === c.id ? (
                    <div className="flex items-center gap-1.5 rounded-xl border border-orange-ink/40 bg-surface p-1.5">
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        onBlur={commitRename}
                        dir="auto"
                        className="min-h-9 w-full min-w-0 rounded-lg border border-line bg-surface px-2 text-sm text-ink outline-none focus:border-orange-ink"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelect(c.id)}
                      className={`group flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-start transition-colors ${
                        active
                          ? "bg-orange-ink/10 text-orange-ink"
                          : "text-ink-soft hover:bg-surface-sink hover:text-ink"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">
                        {c.title || "محادثة بلا عنوان"}
                      </span>
                      <span className="shrink-0 rounded-full border border-line bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft">
                        {STUDIO_MODEL_LABEL[c.model] ?? c.model}
                      </span>
                      <span className="hidden shrink-0 text-[11px] text-ink-soft/70 sm:inline">
                        {formatDateShort(c.updated_at)}
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="إعادة تسمية المحادثة"
                        onClick={(e) => {
                          e.stopPropagation();
                          startRename(c);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            startRename(c);
                          }
                        }}
                        className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-soft opacity-0 transition-opacity hover:bg-surface group-hover:opacity-100 group-focus-within:opacity-100 sm:flex"
                      >
                        ✎
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="حذف المحادثة"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(c.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            setConfirmDeleteId(c.id);
                          }
                        }}
                        className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-soft opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100 group-focus-within:opacity-100 sm:flex"
                      >
                        🗑
                      </span>
                    </button>
                  )}

                  {confirmDeleteId === c.id && (
                    <div className="mt-1 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2">
                      <p className="flex-1 text-xs text-danger">حذف هذه المحادثة نهائياً؟</p>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          onDelete(c.id);
                          setConfirmDeleteId(null);
                        }}
                      >
                        حذف
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(null)}>
                        إلغاء
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
