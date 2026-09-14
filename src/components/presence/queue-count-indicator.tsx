"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { loadQueueCount } from "@/lib/dashboard/queries";

const REFRESH_INTERVAL_MS = 30_000;

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
  const [queueCount, setQueueCount] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    try {
      const count = await loadQueueCount(createClient(), accountId);
      setQueueCount(count);
    } catch (error) {
      console.error("[QueueCountIndicator] queue count failed:", error);
    }
  }, [accountId]);

  useEffect(() => {
    if (!shouldShowQueueCount(profileLoading, accountId)) return;

    void loadQueueCount(createClient(), accountId)
      .then((count) => setQueueCount(count))
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

  return (
    <div
      className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-right"
      aria-label={t("queuedConversations", { count: queueCount ?? 0 })}
      title={t("queuedConversations", { count: queueCount ?? 0 })}
      aria-live="polite"
    >
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
        {t("queued")}
      </span>
      <span className="text-xs font-semibold tabular-nums text-foreground">
        {queueCount ?? "—"}
      </span>
    </div>
  );
}
