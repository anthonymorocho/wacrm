"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import type { Profile } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface BulkTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  profiles: Profile[];
  currentUserId: string | undefined;
  submitting: boolean;
  onConfirm: (targetAgentId: string) => void;
}

export function BulkTransferDialog({
  open,
  onOpenChange,
  selectedCount,
  profiles,
  currentUserId,
  submitting,
  onConfirm,
}: BulkTransferDialogProps) {
  const t = useTranslations("Inbox.bulkTransfer");
  const [targetAgentId, setTargetAgentId] = useState("");

  const agents = useMemo(
    () =>
      profiles.filter(
        (profile) =>
          profile.user_id !== currentUserId &&
          ["owner", "admin", "agent"].includes(profile.account_role ?? ""),
      ),
    [currentUserId, profiles],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setTargetAgentId("");
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  const handleConfirm = useCallback(() => {
    if (!targetAgentId || submitting) return;
    onConfirm(targetAgentId);
  }, [onConfirm, submitting, targetAgentId]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <ArrowRight className="h-4 w-4 text-primary" />
            {t("title")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("description", { count: selectedCount })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="text-sm font-medium text-popover-foreground">
            {t("destination")}
          </label>
          <Select
            value={targetAgentId}
            onValueChange={(value) => setTargetAgentId(value ?? "")}
            disabled={submitting}
          >
            <SelectTrigger className="w-full border-border bg-background text-popover-foreground">
              <SelectValue placeholder={t("selectAgent")} />
            </SelectTrigger>
            <SelectContent>
              {agents.map((agent) => (
                <SelectItem key={agent.user_id} value={agent.user_id}>
                  {agent.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {agents.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("noAgents")}</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
            className="border-border text-popover-foreground hover:bg-muted"
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!targetAgentId || submitting || agents.length === 0}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? t("transferring") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
