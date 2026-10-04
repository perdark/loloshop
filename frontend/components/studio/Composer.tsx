"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { compressImageForUpload } from "@/lib/imageCompress";
import {
  MAX_STUDIO_IMAGES,
  STUDIO_MODEL_LABEL,
  type StudioMode,
  type StudioModel,
} from "@/lib/studio";

interface ComposerProps {
  mode: StudioMode;
  onModeChange: (mode: StudioMode) => void;
  text: string;
  onTextChange: (text: string) => void;
  images: File[];
  onImagesChange: (images: File[]) => void;
  /** Only offered before the conversation's first message — after that the model is
   *  fixed server-side on the conversation row. */
  showModelPicker: boolean;
  model: StudioModel;
  onModelChange: (model: StudioModel) => void;
  sending: boolean;
  onSend: () => void;
}

const MODE_OPTIONS: { id: StudioMode; label: string }[] = [
  { id: "chat", label: "💬 محادثة" },
  { id: "image", label: "🎨 ولّد صورة" },
];

export function Composer({
  mode,
  onModeChange,
  text,
  onTextChange,
  images,
  onImagesChange,
  showModelPicker,
  model,
  onModelChange,
  sending,
  onSend,
}: ComposerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  // `pointer: coarse` decides Enter's behaviour: a touch keyboard has no convenient
  // Shift chord, so Enter must stay a plain newline there (spec: "on touch Enter = newline").
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    setIsTouch(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  // Object URLs for the attached-image previews — revoke on every change/unmount.
  useEffect(() => {
    const urls = images.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [images]);

  // Auto-grow the textarea up to a reasonable cap instead of scrolling inside a tiny box.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  async function handlePick(files: FileList | null) {
    if (!files || !files.length) return;
    const room = MAX_STUDIO_IMAGES - images.length;
    if (room <= 0) {
      toast.error(`حد أقصى ${MAX_STUDIO_IMAGES} صور لكل رسالة`);
      return;
    }
    const picked = Array.from(files).slice(0, room);
    const compressed = await Promise.all(picked.map((f) => compressImageForUpload(f)));
    onImagesChange([...images, ...compressed]);
    if (files.length > room) {
      toast.message(`أُرفقت ${room} فقط — حد أقصى ${MAX_STUDIO_IMAGES} صور`);
    }
  }

  function removeImage(i: number) {
    onImagesChange(images.filter((_, idx) => idx !== i));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || isTouch) return;
    e.preventDefault();
    if (!sending && text.trim()) onSend();
  }

  const canSend = !sending && text.trim().length > 0;

  return (
    <div className="shrink-0 border-t border-line bg-surface p-3 sm:p-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-2.5">
        {/* mode + model row */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            className="inline-flex rounded-full border border-line bg-surface-sink p-1"
            role="group"
            aria-label="نوع الطلب"
          >
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-pressed={mode === opt.id}
                onClick={() => onModeChange(opt.id)}
                className={`min-h-9 rounded-full px-3.5 text-sm font-semibold transition-colors ${
                  mode === opt.id ? "bg-orange-ink text-white" : "text-ink-soft hover:text-ink"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {showModelPicker ? (
            <div
              className="inline-flex rounded-full border border-line bg-surface-sink p-1"
              role="group"
              aria-label="النموذج"
            >
              {(Object.keys(STUDIO_MODEL_LABEL) as StudioModel[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={model === m}
                  onClick={() => onModelChange(m)}
                  className={`min-h-9 rounded-full px-3.5 text-sm font-semibold transition-colors ${
                    model === m ? "bg-ink text-white" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {STUDIO_MODEL_LABEL[m]}
                </button>
              ))}
            </div>
          ) : (
            <span className="rounded-full border border-line bg-surface-sink px-3 py-1 text-xs font-semibold text-ink-soft">
              {STUDIO_MODEL_LABEL[model]}
            </span>
          )}
        </div>

        {/* attached image previews */}
        {previews.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {previews.map((url, i) => (
              <div key={url} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  aria-label="إزالة الصورة"
                  className="absolute end-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink/70 text-xs font-bold text-white"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* input row */}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void handlePick(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={images.length >= MAX_STUDIO_IMAGES}
            aria-label="إرفاق صورة"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface-sink text-ink-soft transition-colors hover:border-orange-ink/40 hover:text-orange-ink disabled:opacity-40"
          >
            📎
          </button>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            dir="auto"
            rows={1}
            placeholder={
              mode === "image" ? "اوصف الصورة التي تريدها…" : "اكتب رسالتك…"
            }
            className="min-h-11 min-w-0 flex-1 resize-none rounded-2xl border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink/50 focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
          />
          <Button
            variant="primary"
            size="md"
            disabled={!canSend}
            loading={sending}
            onClick={onSend}
            className="shrink-0 !px-5"
          >
            إرسال
          </Button>
        </div>
      </div>
    </div>
  );
}
