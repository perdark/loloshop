"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";

interface Props {
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
  upload: (file: File) => Promise<string>;
  maxMB?: number;
}

export function Uploader({ label, value, onChange, upload, maxMB = 5 }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > maxMB * 1024 * 1024) {
      toast.error(`الملف أكبر من ${maxMB} ميجا`);
      return;
    }
    setUploading(true);
    try {
      const url = await upload(file);
      onChange(url);
      toast.success("تم الرفع");
    } catch {
      toast.error("فشل الرفع");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-cream p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-ink">{label}</span>
        {value && (
          <button
            type="button"
            className="text-xs text-red-700 hover:underline"
            onClick={() => onChange(null)}
          >
            إزالة
          </button>
        )}
      </div>
      {value ? (
        <div className="flex items-center gap-3">
          <img
            src={value}
            alt={label}
            className="h-16 w-16 rounded border border-ink/10 object-cover"
          />
          <Button
            variant="ghost"
            onClick={() => inputRef.current?.click()}
            loading={uploading}
          >
            تغيير
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          onClick={() => inputRef.current?.click()}
          loading={uploading}
          fullWidth
        >
          {uploading ? "جارٍ الرفع..." : "اختر ملفاً"}
        </Button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}
