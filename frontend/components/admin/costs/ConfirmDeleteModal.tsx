"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { getApiErrorMessage } from "@/lib/api";

/**
 * One confirm-delete dialog shared by every CRUD tab on `/admin/costs` — the owner's explicit
 * requirement is that everything here can be deleted, and every delete gets the same honest
 * "here is what this actually removes" treatment instead of a bare `window.confirm`.
 */
export function ConfirmDeleteModal({
  title,
  warning,
  onConfirm,
  onClose,
  onDone,
}: {
  title: string;
  /** What will actually disappear — say it plainly (e.g. "سيُحذف البند و٣ سطور وصفة تستخدمه"). */
  warning: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      toast.success("تم الحذف");
      await onDone();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذّر الحذف"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="danger" onClick={confirm} loading={busy}>
            حذف نهائياً
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink">{warning}</p>
    </Modal>
  );
}
