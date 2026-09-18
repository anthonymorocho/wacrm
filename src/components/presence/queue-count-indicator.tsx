"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import {
  loadQueueCounts,
  type QueueChannel,
  type QueueCountBreakdown,
} from "@/lib/dashboard/queries";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const REFRESH_INTERVAL_MS = 30_000;

const QUEUE_CHANNELS: ReadonlyArray<{
  key: QueueChannel;
  labelKey: "whatsappChannel" | "facebookChannel" | "instagramChannel";
  dotClassName: string;
}> = [
  {
    key: "whatsapp",
    labelKey: "whatsappChannel",
    dotClassName: "bg-emerald-400",
  },
  {
    key: "messenger",
    labelKey: "facebookChannel",
    dotClassName: "bg-blue-400",
  },
  {
    key: "instagram",
    labelKey: "instagramChannel",
    dotClassName: "bg-fuchsia-400",
  },
];

export function shouldShowQueueCount(
  profileLoading: boolean,
  accountId: string | null,
): accountId is string {
  return !profileLoading && Boolean(accountId);
}

/** Compact account-scoped queue count for the global dashboard header. */
export function QueueCountIndicator() {
  const t = useTranslations("Header");
  const { accountId, profileLoading } = useAuth();
  const [queueCounts, setQueueCounts] = useState<QueueCountBreakdown | null>(
    null,
  );

  const refresh = useCallback(async () => {
    if (!accountId) return;
    try {
      const counts = await loadQueueCounts(createClient(), accountId);
      setQueueCounts(counts);
    } catch (error) {
      console.error("[QueueCountIndicator] queue count failed:", error);
    }
  }, [accountId]);

  useEffect(() => {
    if (!shouldShowQueueCount(profileLoading, accountId)) return;

    void loadQueueCounts(createClient(), accountId)
      .then((counts) => setQueueCounts(counts))
      .catch((error) =>
        console.error("[QueueCountIndicator] initial queue count failed:", error),
      );
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [accountId, profileLoading, refresh]);

  if (!shouldShowQueueCount(profileLoading, accountId)) return null;

  const queueTotal = queueCounts?.total;
  const visibleChannels = QUEUE_CHANNELS.filter(
    ({ key }) => key !== "instagram" || (queueCounts?.instagram ?? 0) > 0,
  );

  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="flex cursor-help items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-right transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={
                queueCounts
                  ? t("queuedConversations", { count: queueTotal ?? 0 })
                  : t("queueLoading")
              }
              aria-live="polite"
            />
          }
        >
          <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
            {t("queued")}
          </span>
          <span className="text-xs font-semibold tabular-nums text-foreground">
            {queueTotal ?? "—"}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="end"
          className="min-w-32 border border-border bg-popover p-2 text-popover-foreground shadow-lg"
        >
          <div className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("queueBreakdown")}
            </p>
            <div className="space-y-1.5">
              {visibleChannels.map(({ key, labelKey, dotClassName }) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-5 text-xs"
                >
                  <span className="flex items-center gap-2 text-popover-foreground">
                    <span
                      aria-hidden="true"
                      className={`size-1.5 rounded-full ${dotClassName}`}
                    />
                    {t(labelKey)}:
                  </span>
                  <span className="font-semibold tabular-nums text-popover-foreground">
                    {queueCounts?.[key] ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
