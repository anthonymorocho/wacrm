"use client";

import { CheckCheck, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BulkCloseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  submitting: boolean;
  onConfirm: () => void;
}

export function BulkCloseDialog({
  open,
  onOpenChange,
  selectedCount,
  submitting,
  onConfirm,
}: BulkCloseDialogProps) {
  const t = useTranslations("Inbox.bulkClose");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <CheckCheck className="h-4 w-4 text-primary" />
            {t("title")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("description", { count: selectedCount })}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="border-border text-popover-foreground hover:bg-muted"
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={submitting}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? t("closing") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
