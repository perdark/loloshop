"use client";

import { CopyButton } from "@/components/ui/CopyButton";
import { studioImageUrl, type StudioMessage, type StudioMode } from "@/lib/studio";

interface MessageBubbleProps {
  message: StudioMessage;
  onPreviewImage: (url: string) => void;
}

/** One user or assistant turn. Images attached to a USER message are what they uploaded;
 *  images on an ASSISTANT message are what السمارت‌API drew (`kind: 'image'`). Both are
 *  rendered the same way — clickable thumbnails that open the lightbox. */
export function MessageBubble({ message, onPreviewImage }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const images = message.image_urls ?? [];

  return (
    <div className={`flex w-full ${isUser ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[88%] rounded-2xl px-4 py-3 shadow-[var(--shadow-soft)] sm:max-w-[75%] ${
          isUser
            ? "border border-line bg-surface text-ink"
            : "border border-orange-ink/20 bg-orange-ink/[0.07] text-ink"
        }`}
      >
        {images.length > 0 && (
          <div className={`grid gap-2 ${images.length > 1 ? "grid-cols-2" : "grid-cols-1"} ${message.content ? "mb-2" : ""}`}>
            {images.map((path, i) => {
              const url = studioImageUrl(path);
              return (
                <button
                  key={`${message.id}-${i}`}
                  type="button"
                  onClick={() => onPreviewImage(url)}
                  className="overflow-hidden rounded-xl border border-line bg-surface-sink focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-ink/40"
                  aria-label="فتح الصورة بالحجم الكامل"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-auto w-full object-contain" loading="lazy" />
                </button>
              );
            })}
          </div>
        )}

        {message.content && (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed" dir="auto">
            {isUser ? message.content : <LiteMarkdown text={message.content} />}
          </p>
        )}

        {!isUser && message.content && (
          <div className="mt-2 flex justify-end">
            <CopyButton text={message.content} className="min-h-8 px-2.5 py-1 text-xs" />
          </div>
        )}
      </div>
    </div>
  );
}

/** The bubble shown while a request is in flight — never a blank gap, since image
 *  generation on SmartAPI can run close to a minute. */
// The models answer in markdown (GPT almost always). Showing raw «**» to a designer reads as
// broken, so this renders the four things that actually show up — bold, headings, bullets and
// inline code — as React elements. No innerHTML, so model output can never inject markup.
function inlineBold(line: string, key: string) {
  return line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={`${key}-${i}`} className="rounded bg-surface-sink px-1 text-[0.85em]" dir="ltr">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function LiteMarkdown({ text }: { text: string }) {
  const lines = text.replace(/```[a-z]*\n?/g, "").split("\n");
  return (
    <>
      {lines.map((raw, i) => {
        const heading = raw.match(/^#{1,6}\s+(.*)$/);
        const bullet = raw.match(/^\s*[-*•]\s+(.*)$/);
        const nl = i < lines.length - 1 ? "\n" : "";
        if (heading) return <span key={i}><strong>{inlineBold(heading[1], `h${i}`)}</strong>{nl}</span>;
        if (bullet) return <span key={i}>{"• "}{inlineBold(bullet[1], `b${i}`)}{nl}</span>;
        if (/^\s*(-{3,}|\*{3,})\s*$/.test(raw)) return <span key={i}>{nl}</span>;
        return <span key={i}>{inlineBold(raw, `l${i}`)}{nl}</span>;
      })}
    </>
  );
}

export function LoadingBubble({ mode }: { mode: StudioMode }) {
  return (
    <div className="flex w-full justify-end">
      <div className="flex max-w-[75%] items-center gap-2 rounded-2xl border border-orange-ink/20 bg-orange-ink/[0.07] px-4 py-3 text-sm text-ink-soft shadow-[var(--shadow-soft)]">
        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-orange-ink/50 border-t-transparent" aria-hidden />
        <span>{mode === "image" ? "يرسم الصورة… ممكن تاخذ دقيقة" : "يفكّر…"}</span>
      </div>
    </div>
  );
}
