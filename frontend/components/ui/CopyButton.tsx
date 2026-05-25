"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "./Button";

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
  fullWidth?: boolean;
}

export function CopyButton({
  text,
  label = "نسخ",
  className = "",
  fullWidth = false,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("تم النسخ");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("تعذر النسخ");
    }
  }

  return (
    <Button
      variant="ghost"
      onClick={handleCopy}
      className={`text-sm ${fullWidth ? "w-full" : ""} ${className}`}
    >
      {copied ? "تم!" : label}
    </Button>
  );
}
