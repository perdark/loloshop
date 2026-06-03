"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import {
  exportHighResCombinedPng,
  exportHighResPanelPng,
  exportHighResGownPng,
  type HighResExportInput,
} from "./HighResExporter";

interface ExportPngButtonProps {
  design: HighResExportInput;
  studentName: string;
}

export function ExportPngButton({ design, studentName }: ExportPngButtonProps) {
  const [loadingGown, setLoadingGown] = useState(false);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [loadingRight, setLoadingRight] = useState(false);
  const [loadingLeft, setLoadingLeft] = useState(false);

  const safeName = studentName.replace(/\s+/g, "-").slice(0, 40);
  const anyLoading = loadingGown || loadingBoard || loadingRight || loadingLeft;

  async function handleBoardExport() {
    setLoadingBoard(true);
    try {
      await exportHighResCombinedPng(
        design,
        `loloshop-${safeName}-board-300dpi.png`
      );
      toast.success("تم تنزيل اللوح (يمين + يسار)");
    } catch (e) {
      console.error(e);
      toast.error("تعذر تصدير اللوح");
    } finally {
      setLoadingBoard(false);
    }
  }

  async function handleRightExport() {
    setLoadingRight(true);
    try {
      await exportHighResPanelPng(
        design.rightCanvas,
        design.sashColor,
        design.fontsUsed,
        `loloshop-${safeName}-right-300dpi.png`
      );
      toast.success("تم تنزيل لوح اليمين");
    } catch (e) {
      console.error(e);
      toast.error("تعذر تصدير لوح اليمين");
    } finally {
      setLoadingRight(false);
    }
  }

  async function handleLeftExport() {
    setLoadingLeft(true);
    try {
      await exportHighResPanelPng(
        design.leftCanvas,
        design.sashColor,
        design.fontsUsed,
        `loloshop-${safeName}-left-300dpi.png`
      );
      toast.success("تم تنزيل لوح اليسار");
    } catch (e) {
      console.error(e);
      toast.error("تعذر تصدير لوح اليسار");
    } finally {
      setLoadingLeft(false);
    }
  }

  async function handleGownExport() {
    setLoadingGown(true);
    try {
      await exportHighResGownPng(design, `loloshop-${safeName}-gown.png`);
      toast.success("تم تنزيل صورة الروب");
    } catch (e) {
      console.error(e);
      toast.error("تعذر تصدير صورة الروب");
    } finally {
      setLoadingGown(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Primary: full board */}
      <Button
        fullWidth
        loading={loadingBoard}
        disabled={anyLoading && !loadingBoard}
        onClick={handleBoardExport}
      >
        تنزيل اللوح (يمين + يسار)
      </Button>

      {/* Secondary: per-side */}
      <div className="flex gap-2">
        <Button
          variant="secondary"
          className="flex-1"
          loading={loadingRight}
          disabled={anyLoading && !loadingRight}
          onClick={handleRightExport}
        >
          لوح اليمين
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          loading={loadingLeft}
          disabled={anyLoading && !loadingLeft}
          onClick={handleLeftExport}
        >
          لوح اليسار
        </Button>
      </div>

      {/* Tertiary: gown photo */}
      <Button
        variant="ghost"
        fullWidth
        loading={loadingGown}
        disabled={anyLoading && !loadingGown}
        onClick={handleGownExport}
      >
        تنزيل صورة الروب
      </Button>
    </div>
  );
}
