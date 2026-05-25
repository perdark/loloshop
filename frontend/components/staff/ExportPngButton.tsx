"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import {
  exportHighResCombinedPng,
  type HighResExportInput,
} from "./HighResExporter";

interface ExportPngButtonProps {
  design: HighResExportInput;
  studentName: string;
}

export function ExportPngButton({ design, studentName }: ExportPngButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    setLoading(true);
    try {
      const safeName = studentName.replace(/\s+/g, "-").slice(0, 40);
      await exportHighResCombinedPng(
        design,
        `loloshop-${safeName}-300dpi.png`
      );
      toast.success("تم تنزيل PNG بدقة عالية");
    } catch (e) {
      console.error(e);
      toast.error("تعذر تصدير الصورة");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button onClick={handleExport} loading={loading}>
      تنزيل PNG (300 DPI)
    </Button>
  );
}
