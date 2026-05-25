"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import {
  buildHighResCombinedDataUrl,
  type HighResExportInput,
} from "./HighResExporter";

interface PdfExportButtonProps {
  design: HighResExportInput;
  studentName: string;
}

export function PdfExportButton({ design, studentName }: PdfExportButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    setLoading(true);
    try {
      const imgData = await buildHighResCombinedDataUrl(design);
      const { jsPDF } = await import("jspdf");

      const combinedW = 2880;
      const combinedH = 2400;
      const pdfW = 297;
      const pdfH = (combinedH / combinedW) * pdfW;

      const doc = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: [pdfW, Math.max(pdfH, 80)],
      });
      doc.addImage(imgData, "PNG", 0, 0, pdfW, pdfH);
      const safeName = studentName.replace(/\s+/g, "-").slice(0, 40);
      doc.save(`loloshop-${safeName}-proof.pdf`);
      toast.success("تم تنزيل ملف PDF");
    } catch (e) {
      console.error(e);
      toast.error("تعذر إنشاء PDF");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="secondary" onClick={handleExport} loading={loading}>
      تنزيل PDF للمعاينة
    </Button>
  );
}
