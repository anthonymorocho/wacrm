"use client";

import type { Deal, PipelineStage } from "@/types";
import { Calendar, Check, MessageCircle, X } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { useTranslations } from "next-intl";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  onOpenConversation?: (deal: Deal) => void;
  isOverlay?: boolean;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

export function DealCard({
  deal,
  stage,
  onEdit,
  onOpenConversation,
  isOverlay,
}: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const tConversation = useTranslations("Pipelines.conversation");
  const contactLabel = deal.contact?.name || deal.contact?.phone || t("noContact");
  const assigneeLabel = deal.assignee?.full_name || null;
  const isCustomerConversation = deal.auto_created_from_message === true;
  const conversation = Array.isArray(deal.conversation)
    ? deal.conversation[0]
    : deal.conversation;
  const latestMessage = conversation?.last_message_text?.trim();

  function openCard() {
    if (isCustomerConversation && deal.conversation_id && onOpenConversation) {
      onOpenConversation(deal);
      return;
    }
    onEdit(deal);
  }

  return (
    <div
      role="button"
      tabIndex={isOverlay ? -1 : 0}
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        openCard();
      }}
      onKeyDown={(e) => {
        if (!isOverlay && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          openCard();
        }
      }}
      className={`group relative w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 pl-4 pr-3 py-3 text-left shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 text-sm font-semibold leading-snug text-foreground break-words">
          {isCustomerConversation
            ? t("conversationWith", { who: contactLabel })
            : deal.title}
        </h4>
        <div className="flex shrink-0 items-center gap-1">
          {onOpenConversation && deal.conversation_id && !isOverlay &&
            (isCustomerConversation ? (
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground"
              >
                <MessageCircle className="h-3.5 w-3.5" />
              </span>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenConversation(deal);
                }}
                aria-label={tConversation("replyFromPipeline")}
                title={tConversation("replyFromPipeline")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MessageCircle className="h-3.5 w-3.5" />
              </button>
            ))}
          {!isCustomerConversation && deal.status === "won" && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
              <Check className="h-3 w-3" />
              {t("won")}
            </span>
          )}
          {!isCustomerConversation && deal.status === "lost" && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
              <X className="h-3 w-3" />
              {t("lost")}
            </span>
          )}
        </div>
      </div>

      {isCustomerConversation ? (
        <p
          aria-label={t("lastMessage")}
          className="mt-3 line-clamp-2 text-xs text-muted-foreground"
        >
          <span className="font-medium">{t("lastMessage")}:</span>{" "}
          {latestMessage || t("noMessagePreview")}
        </p>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
            {initials(deal.contact?.name, deal.contact?.phone ?? undefined)}
          </span>
          <span className="truncate text-xs text-muted-foreground">{contactLabel}</span>
        </div>
      )}

      {!isCustomerConversation && (
        <div className="mt-2 flex items-center justify-between">
          <span className="text-sm font-bold text-primary">
            {formatCurrency(deal.value, deal.currency)}
          </span>
          {deal.expected_close_date && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {formatDate(deal.expected_close_date)}
            </span>
          )}
        </div>
      )}

      {assigneeLabel && (
        <div className="mt-2 flex items-center justify-end">
          <span
            title={assigneeLabel}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
          >
            {initials(assigneeLabel)}
          </span>
        </div>
      )}
    </div>
  );
}
