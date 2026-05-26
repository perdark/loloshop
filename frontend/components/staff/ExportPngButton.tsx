"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import {
  exportHighResCombinedPng,
  exportHighResGownPng,
  type HighResExportInput,
} from "./HighResExporter";

interface ExportPngButtonProps {
  design: HighResExportInput;
  studentName: string;
}

export function ExportPngButton({ design, studentName }: ExportPngButtonProps) {
  const [loadingGown, setLoadingGown] = useState(false);
  const [loadingPanels, setLoadingPanels] = useState(false);

  const safeName = studentName.replace(/\s+/g, "-").slice(0, 40);

  async function handleGownExport() {
    setLoadingGown(true);
    try {
      await exportHighResGownPng(design, `loloshop-gown-${safeName}.png`);
      toast.success("تم تنزيل صورة الروب");
    } catch (e) {
      console.error(e);
      toast.error("تعذر تصدير صورة الروب");
    } finally {
      setLoadingGown(false);
    }
  }

  async function handlePanelsExport() {
    setLoadingPanels(true);
    try {
      await exportHighResCombinedPng(
        design,
        `loloshop-panels-${safeName}-300dpi.png`
      );
      toast.success("تم تنزيل لوحات الطباعة");
    } catch (e) {
      console.error(e);
      toast.error("تعذر تصدير اللوحات");
    } finally {
      setLoadingPanels(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <Button onClick={handleGownExport} loading={loadingGown} disabled={loadingPanels}>
        تنزيل PNG الروب
      </Button>
      <Button
        variant="ghost"
        onClick={handlePanelsExport}
        loading={loadingPanels}
        disabled={loadingGown}
      >
        تنزيل لوحات الطباعة
      </Button>
    </div>
  );
}
