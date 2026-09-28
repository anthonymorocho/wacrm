"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import {
  loadMyConversationAssignmentStats,
  loadQueueCounts,
  type QueueChannel,
  type QueueCountBreakdown,
} from "@/lib/dashboard/queries";
import type { MyConversationAssignmentStats } from "@/lib/dashboard/types";
import { startOfLocalDay } from "@/lib/dashboard/date-utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const REFRESH_INTERVAL_MS = 60_000;

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

function describeQueueCountFailure(error: unknown): string {
  const fields =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const message =
    error instanceof Error
      ? error.message
      : typeof fields.message === "string"
        ? fields.message
        : String(error);
  const name = error instanceof Error ? error.name : fields.name;
  const extra = [
    ["channel", fields.channel],
    ["code", fields.code],
    ["status", fields.status],
    ["details", fields.details],
    ["hint", fields.hint],
  ]
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => `${key}=${String(value)}`);

  return [message || String(name || "Queue count error"), ...extra].join(" | ");
}

function logQueueCountFailure(stage: string, error: unknown) {
  console.error(
    `[QueueCountIndicator] ${stage}: ${describeQueueCountFailure(error)}`,
  );
}

/** Account queue and the signed-in user's assignment counts for the header. */
export function QueueCountIndicator() {
  const t = useTranslations("Header");
  const { accountId, profileLoading } = useAuth();
  const [queueCounts, setQueueCounts] = useState<QueueCountBreakdown | null>(
    null,
  );
  const [assignmentStats, setAssignmentStats] =
    useState<MyConversationAssignmentStats | null>(null);
  const refreshInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (
      !accountId ||
      document.visibilityState !== "visible" ||
      refreshInFlight.current
    ) {
      return;
    }

    refreshInFlight.current = true;
    try {
      const db = createClient();
      const [queueResult, assignmentResult] = await Promise.allSettled([
        loadQueueCounts(db, accountId),
        loadMyConversationAssignmentStats(
          db,
          startOfLocalDay().toISOString(),
        ),
      ]);

      if (queueResult.status === "fulfilled") {
        setQueueCounts(queueResult.value);
      } else {
        logQueueCountFailure("queue count failed", queueResult.reason);
      }

      if (assignmentResult.status === "fulfilled") {
        setAssignmentStats(assignmentResult.value);
      } else {
        logQueueCountFailure(
          "assignment stats failed",
          assignmentResult.reason,
        );
      }
    } finally {
      refreshInFlight.current = false;
    }
  }, [accountId]);

  useEffect(() => {
    if (!shouldShowQueueCount(profileLoading, accountId)) return;

    void refresh();

    let refreshTimer: number | undefined;
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") {
        if (refreshTimer !== undefined) {
          window.clearTimeout(refreshTimer);
          refreshTimer = undefined;
        }
        return;
      }
      if (refreshTimer !== undefined) return;

      // Focus and visibilitychange commonly fire together on tab return.
      // Coalesce them into one refresh.
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        void refresh();
      }, 250);
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_INTERVAL_MS);

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [accountId, profileLoading, refresh]);

  if (!shouldShowQueueCount(profileLoading, accountId)) return null;

  const queueTotal = queueCounts?.total;
  const assignmentMetrics = [
    {
      label: t("assignedNow"),
      value: assignmentStats?.currentlyAssigned,
      ariaLabel: assignmentStats
        ? t("assignedNowCount", {
            count: assignmentStats.currentlyAssigned,
          })
        : t("assignmentStatsLoading"),
      tooltip: t("assignedNowTooltip"),
    },
    {
      label: t("assignedToday"),
      value: assignmentStats?.assignedToday,
      ariaLabel: assignmentStats
        ? t("assignedTodayCount", { count: assignmentStats.assignedToday })
        : t("assignmentStatsLoading"),
      tooltip: t("assignedTodayTooltip"),
    },
    {
      label: t("transferredToday"),
      value: assignmentStats?.transferredToday,
      ariaLabel: assignmentStats
        ? t("transferredTodayCount", {
            count: assignmentStats.transferredToday,
          })
        : t("assignmentStatsLoading"),
      tooltip: t("transferredTodayTooltip"),
    },
  ];

  return (
    <TooltipProvider delay={200}>
      <div className="flex items-center gap-1 sm:gap-1.5">
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
                {QUEUE_CHANNELS.map(({ key, labelKey, dotClassName }) => (
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
        {assignmentMetrics.map((metric) => (
          <AssignmentMetric key={metric.label} {...metric} />
        ))}
      </div>
    </TooltipProvider>
  );
}

function AssignmentMetric({
  label,
  value,
  ariaLabel,
  tooltip,
}: {
  label: string;
  value: number | undefined;
  ariaLabel: string;
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={ariaLabel}
            className="flex cursor-help items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-right transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="text-xs font-semibold tabular-nums text-foreground">
          {value ?? "—"}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="end"
        className="max-w-64 border border-border bg-popover p-2 text-xs text-popover-foreground shadow-lg"
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
