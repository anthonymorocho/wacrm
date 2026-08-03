"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  Contact,
  Conversation,
  ConversationStatus,
  Deal,
  Message,
} from "@/types";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from "@/lib/inbox/conversations";
import { MessageThread } from "@/components/inbox/message-thread";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface DealConversationSheetProps {
  deal: Deal | null;
  stageName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DealConversationSheet({
  deal,
  stageName,
  open,
  onOpenChange,
}: DealConversationSheetProps) {
  const t = useTranslations("Pipelines.conversation");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [resyncToken, setResyncToken] = useState(0);

  useEffect(() => {
    if (!open || !deal) return;
    let cancelled = false;

    void (async () => {
      // Wait until the effect callback yields before clearing the previous
      // thread. This keeps the sheet from briefly showing stale content and
      // avoids a synchronous cascading render inside the effect.
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setConversation(null);
      setContact(null);
      setMessages([]);

      if (!deal.conversation_id) {
        setLoading(false);
        return;
      }

      const { data, error } = await createClient()
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .eq("id", deal.conversation_id)
        .maybeSingle();

      if (cancelled) return;
      if (error) console.error("Failed to load deal conversation:", error);
      if (data) {
        const normalized = normalizeConversation(data);
        setConversation(normalized);
        setContact(normalized.contact ?? deal.contact ?? null);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [deal, open]);

  const handleMessagesLoaded = useCallback((nextMessages: Message[]) => {
    setMessages(nextMessages);
  }, []);

  const handleNewMessage = useCallback((message: Message) => {
    setMessages((current) => {
      if (current.some((item) => item.id === message.id)) return current;
      return [...current, message];
    });
  }, []);

  const handleUpdateMessage = useCallback(
    (id: string, updates: Partial<Message>) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === id ? { ...message, ...updates } : message,
        ),
      );
    },
    [],
  );

  const handleStatusChange = useCallback(
    (conversationId: string, status: ConversationStatus) => {
      setConversation((current) =>
        current?.id === conversationId ? { ...current, status } : current,
      );
    },
    [],
  );

  const handleAssignChange = useCallback(
    (conversationId: string, assignedAgentId: string | null) => {
      setConversation((current) =>
        current?.id === conversationId
          ? { ...current, assigned_agent_id: assignedAgentId ?? undefined }
          : current,
      );
    },
    [],
  );

  const headerLabel =
    deal?.title || contact?.name || contact?.phone || t("conversation");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 border-border bg-popover p-0 sm:max-w-xl"
      >
        <SheetHeader className="shrink-0 border-b border-border/60 bg-card px-5 py-4 pr-14">
          <SheetTitle className="flex items-center gap-2 truncate text-popover-foreground">
            <MessageSquare className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate">{headerLabel}</span>
          </SheetTitle>
          <SheetDescription className="truncate text-xs text-muted-foreground">
            {stageName ? `${stageName} · ` : ""}
            {contact?.phone ?? t("replyFromPipeline")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="sr-only">{t("loading")}</span>
            </div>
          ) : conversation && contact ? (
            <MessageThread
              conversation={conversation}
              contact={contact}
              messages={messages}
              onMessagesLoaded={handleMessagesLoaded}
              onNewMessage={handleNewMessage}
              onUpdateMessage={handleUpdateMessage}
              onStatusChange={handleStatusChange}
              onAssignChange={handleAssignChange}
              resyncToken={resyncToken}
              onRefresh={() => setResyncToken((value) => value + 1)}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <MessageSquare className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="mt-3 text-sm font-medium text-foreground">
                {t("noConversation")}
              </p>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                {t("noConversationHint")}
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
