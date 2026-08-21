"use client";

import { useState } from "react";
import { toast } from "sonner";
import { safeFileName, saveFromUrl } from "@/lib/download";

/**
 * «تنزيل» for a file that lives at a URL.
 *
 * ⚠️ A BUTTON, not `<a href download>`. The staff iPad is the whole reason: the
 * `download` attribute is inert inside the app's WebView, so the tap navigated the shell
 * to the image and stranded the worker on a white page holding one photo — and on a
 * cross-origin href every browser ignores it, iPad or not. `saveFromUrl` fetches the
 * bytes and hands them over without leaving the page; on iOS it goes through the share
 * sheet, which is also the fastest route to WhatsApp. See `lib/download.ts`.
 */
export function DownloadLink({
  url,
  name,
  ext = "png",
  className,
  children = "تنزيل",
}: {
  url: string;
  /** Filename WITHOUT extension — uploads are stored under a hash, so this is the only
   *  thing that tells two saved files apart. */
  name: string;
  ext?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <button
      type="button"
      disabled={saving}
      onClick={async () => {
        setSaving(true);
        try {
          const out = await saveFromUrl(url, safeFileName(name, ext));
          if (out !== "cancelled") toast.success("تم التنزيل");
        } catch {
          toast.error("تعذّر تنزيل الملف");
        } finally {
          setSaving(false);
        }
      }}
      className={className}
    >
      {saving ? "جارٍ التنزيل…" : children}
    </button>
  );
}
