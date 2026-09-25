'use client';

import { Suspense, useState, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import {
  CONVERSATION_SELECT,
  filterVisibleConversations,
  isConversationVisibleToUser,
  normalizeConversation,
  updateConversationActivity,
} from '@/lib/inbox/conversations';
import type {
  Conversation,
  Message,
  Contact,
  ConversationStatus,
} from '@/types';
import { useRealtime } from '@/hooks/use-realtime';
import { ConversationList } from '@/components/inbox/conversation-list';
import { MessageThread } from '@/components/inbox/message-thread';
import { ContactSidebar } from '@/components/inbox/contact-sidebar';
import { WifiOff, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  clearRememberedInboxConversation,
  readRememberedInboxConversation,
  rememberInboxConversation,
  replaceInboxConversationUrl,
} from '@/lib/inbox/navigation';

// Remembers the agent's show/hide choice for the desktop contact panel
// across reloads and sessions (device-scoped, like the theme prefs).
const CONTACT_PANEL_STORAGE_KEY = 'wacrm:inbox:contact-panel-open';

// `useSearchParams` (the `?c=<id>` deep link below) requires a Suspense
// boundary or the production build bails to CSR and errors out. Thin
// wrapper supplies it; the inner component holds all the inbox state.
export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <InboxPageInner />
    </Suspense>
  );
}

function InboxPageInner() {
  const t = useTranslations('Inbox.page');
  const tThread = useTranslations('Inbox.messageThread');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, accountRole } = useAuth();
  /**
   * `?c=<id>` deep-link support. Used when landing here from the
   * dashboard's recent-conversations list so the right thread opens
   * automatically instead of showing the empty center panel.
   */
  const deepLinkConvId = searchParams.get('c');

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] =
    useState<Conversation | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeConversationIdRef.current = activeConversation?.id ?? null;
  }, [activeConversation?.id]);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [whatsappConnected, setWhatsappConnected] = useState<boolean | null>(
    null
  );
  /**
   * Bumped whenever we want children (ConversationList, MessageThread)
   * to refetch from the DB — used as a safety net against missed
   * realtime events. Bumped on WS reconnect and on tab visibility →
   * visible. The initial mount fetches don't depend on this; they fire
   * once on conversationId-change as usual.
   */
  const [resyncToken, setResyncToken] = useState(0);

  /**
   * Whether the desktop contact sidebar (tags / deals / notes) is shown.
   * Defaults to `true` (the historical behaviour) and is restored from
   * localStorage after mount. We deliberately do NOT read localStorage in
   * the initializer: the server renders with `true`, so reading a stored
   * `false` synchronously would produce a hydration mismatch. The effect
   * below reconciles to the stored value right after mount instead.
   */
  const [contactPanelOpen, setContactPanelOpen] = useState(true);
  const [contactDrawerOpen, setContactDrawerOpen] = useState(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONTACT_PANEL_STORAGE_KEY);
      if (stored !== null) setContactPanelOpen(stored === 'true');
    } catch {
      // localStorage can throw in private-browsing / sandboxed contexts.
    }
  }, []);

  const handleToggleContactPanel = useCallback(() => {
    setContactPanelOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CONTACT_PANEL_STORAGE_KEY, String(next));
      } catch {
        // Persistence is best-effort; ignore storage failures.
      }
      return next;
    });
  }, []);

  const handleOpenContactDrawer = useCallback(() => {
    setContactDrawerOpen(true);
  }, []);

  // Fire the URL/session restore exactly once per candidate — subsequent
  // list refreshes (realtime, manual refetch) must not snap the user
  // back to a conversation after they've clicked elsewhere.
  const autoSelectedConversationRef = useRef<string | null>(null);
  const rememberedConversationIdRef = useRef<string | null>(null);
  const sessionSelectionReadyRef = useRef(false);
  const pendingConversationsRef = useRef<Conversation[] | null>(null);

  const rememberSelectedConversation = useCallback((conversationId: string) => {
    if (typeof window === 'undefined') return;
    try {
      rememberInboxConversation(conversationId, window.sessionStorage);
      rememberedConversationIdRef.current = conversationId;
    } catch {
      // Access to sessionStorage itself can be denied in private or
      // embedded browser contexts; the Inbox state remains authoritative.
    }
  }, []);

  const clearRememberedConversation = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      clearRememberedInboxConversation(window.sessionStorage);
      rememberedConversationIdRef.current = null;
    } catch {
      // Storage is best-effort; there is nothing else to clean up here.
    }
  }, []);

  // Tracks conversations whose hydrate fetch is currently in flight. The
  // conv-INSERT and the first-message-INSERT events both call into
  // hydrateConversation; the dedupe here keeps it at one refetch per
  // new conversation even when both events arrive within milliseconds.
  const hydratingConvIdsRef = useRef<Set<string>>(new Set());

  /**
   * Synchronous mirror of the conversation ids currently in `conversations`
   * state. Event handlers need to know "do we already have this conv?"
   * without waiting for a setState updater to run — updaters fire during
   * reconciliation, *after* the synchronous handler code returns, so a
   * `let foundInList = false; setState(p => { foundInList = ...; return ... })`
   * flag reads as `false` in the same tick (this exact bug shipped in #105
   * and caused #106: every incoming message and every status flip fired a
   * redundant DB hydrate, swamping the supabase client and starving the
   * realtime channel). The ref is kept in sync via the effect below.
   */
  const knownConvIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const next = new Set<string>();
    for (const c of conversations) next.add(c.id);
    knownConvIdsRef.current = next;
  }, [conversations]);

  // Pull the conversation row with its `contact` joined and merge it
  // into state. Needed because Supabase Realtime payloads only carry the
  // row's own columns — a brand-new conversation arrives without a
  // contact, which surfaced as "Unknown" names, empty avatars, and
  // (when the conv-INSERT event was delayed past the message-INSERT)
  // conversations stuck on "No messages yet" until the user reloaded.
  // Also self-heals if a realtime event was missed: callers can invoke
  // this whenever they reference a conversation id they don't recognise.
  const hydrateConversation = useCallback(
    async (convId: string) => {
      if (hydratingConvIdsRef.current.has(convId)) return;
      hydratingConvIdsRef.current.add(convId);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('conversations')
          .select(CONVERSATION_SELECT)
          .eq('id', convId)
          .maybeSingle();
        if (error) {
          // Supabase errors have non-enumerable properties — log fields
          // explicitly so the console message isn't just `{}`.
          console.error('Failed to hydrate conversation:', {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
          });
          return;
        }
        if (!data) return;
        const fetched = normalizeConversation(data);
        // RLS is the trust boundary; this client-side check keeps a stale
        // realtime/hydration callback from reintroducing a row after a role or
        // assignment change.
        if (
          !accountRole ||
          !isConversationVisibleToUser(fetched, accountRole, user?.id ?? null)
        ) {
          return;
        }
        setConversations((prev) => {
          const existing = prev.find((c) => c.id === fetched.id);
          if (existing) {
            // Already in state — keep its fields (a realtime UPDATE may
            // have landed while the fetch was in flight and patched
            // last_message_text / unread_count to fresher values than
            // the row we just read). Only backfill `contact`, which the
            // realtime payloads never carry.
            return prev.map((c) =>
              c.id === fetched.id
                ? { ...c, contact: c.contact ?? fetched.contact }
                : c
            );
          }
          return [fetched, ...prev];
        });
      } finally {
        hydratingConvIdsRef.current.delete(convId);
      }
    },
    [accountRole, user?.id]
  );

  // Check WhatsApp connection status on mount
  useEffect(() => {
    const checkConnection = async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) return;

      // whatsapp_config is one-row-per-account post-multi-user, so
      // the previous `.eq('user_id', user.id)` would miss the row
      // for any teammate who didn't personally save the config —
      // the "WhatsApp not connected" banner would show in the
      // shared inbox even though the admin had it configured.
      // Resolve account_id via the profile and query by that.
      const { data: profile } = await supabase
        .from('profiles')
        .select('account_id')
        .eq('user_id', user.id)
        .maybeSingle();
      const accountId = profile?.account_id as string | undefined;
      if (!accountId) {
        setWhatsappConnected(false);
        return;
      }

      const { data } = await supabase
        .from('whatsapp_config')
        .select('status')
        .eq('account_id', accountId)
        .maybeSingle();

      setWhatsappConnected(data?.status === 'connected');
    };

    checkConnection();
  }, []);

  // Handle realtime message events
  const handleMessageEvent = useCallback(
    (event: { eventType: string; new: Message; old: Partial<Message> }) => {
      const newMsg = event.new;

      if (event.eventType === 'INSERT') {
        // Add to messages if it belongs to active conversation
        if (activeConversationIdRef.current === newMsg.conversation_id) {
          setMessages((prev) => {
            // Avoid duplicates
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            // Replace optimistic message if it exists
            const withoutOptimistic = prev.filter(
              (m) => !m.id.startsWith('temp-')
            );
            return [...withoutOptimistic, newMsg];
          });
        }

        // Update conversation list preview. We need to know *synchronously*
        // whether the conv is already in state to decide between patching
        // the preview and triggering a hydrate — see the comment on
        // knownConvIdsRef for why a closure flag inside the updater would
        // always read false here.
        if (knownConvIdsRef.current.has(newMsg.conversation_id)) {
          setConversations((prev) => {
            const current = prev.find(
              (conversation) => conversation.id === newMsg.conversation_id
            );
            if (!current) return prev;

            return updateConversationActivity(
              prev,
              newMsg.conversation_id,
              newMsg.created_at,
              {
                last_message_text: newMsg.content_text ?? '',
                unread_count:
                  activeConversationIdRef.current === newMsg.conversation_id
                    ? 0
                    : current.unread_count + 1,
              }
            );
          });
        } else {
          // First time we're seeing this conv: the conv-INSERT event
          // hasn't landed yet, or was missed. Hydrate from the DB so
          // the row surfaces with its `contact` joined; the conv-UPDATE
          // event the webhook emits right after the message INSERT will
          // converge state when it arrives.
          hydrateConversation(newMsg.conversation_id);
        }
      }

      if (event.eventType === 'UPDATE') {
        // Update message status
        setMessages((prev) =>
          prev.map((m) => (m.id === newMsg.id ? { ...m, ...newMsg } : m))
        );
      }
    },
    [hydrateConversation]
  );

  // Handle realtime conversation events
  const handleConversationEvent = useCallback(
    (event: {
      eventType: string;
      new: Conversation;
      old: Partial<Conversation>;
    }) => {
      const conv = event.new;

      if (event.eventType === 'DELETE') {
        const deletedId = event.old.id ?? conv?.id;
        if (!deletedId) return;
        setConversations((prev) =>
          prev.filter((item) => item.id !== deletedId)
        );
        if (activeConversationIdRef.current === deletedId) {
          activeConversationIdRef.current = null;
          setActiveConversation(null);
          setContactDrawerOpen(false);
          setActiveContact(null);
          setMessages([]);
          router.replace('/inbox', { scroll: false });
        }
        return;
      }

      if (
        !accountRole ||
        !isConversationVisibleToUser(conv, accountRole, user?.id ?? null)
      ) {
        // An agent loses visibility as soon as a conversation is transferred
        // away or released. Remove it immediately, including an open thread.
        setConversations((prev) => prev.filter((item) => item.id !== conv.id));
        if (activeConversationIdRef.current === conv.id) {
          activeConversationIdRef.current = null;
          setActiveConversation(null);
          setContactDrawerOpen(false);
          setActiveContact(null);
          setMessages([]);
          router.replace('/inbox', { scroll: false });
        }
        return;
      }

      if (event.eventType === 'INSERT') {
        // Prepend immediately for snappy UX so the new conv shows in the
        // list right away, then hydrate to fill in the `contact` join
        // (realtime payloads never include joins). Skip both if we
        // already have the row — that shouldn't happen normally, but
        // out-of-order delivery would have us prepending a duplicate.
        if (!knownConvIdsRef.current.has(conv.id)) {
          setConversations((prev) => {
            if (prev.some((c) => c.id === conv.id)) return prev;
            return [conv, ...prev];
          });
          hydrateConversation(conv.id);
        }
      }

      if (event.eventType === 'UPDATE') {
        if (knownConvIdsRef.current.has(conv.id)) {
          // If this UPDATE is for the conv the user is currently viewing,
          // suppress the incoming unread_count — the user is reading it
          // RIGHT NOW, so any positive value would just flicker the badge
          // back on for the ~100ms it takes for the reset effect's server
          // UPDATE to round-trip. Non-active convs take the value as-is.
          const isActive = activeConversationIdRef.current === conv.id;
          setConversations((prev) => {
            const current = prev.find(
              (conversation) => conversation.id === conv.id
            );
            if (!current) return prev;

            const incomingActivityAt = conv.last_message_at;
            const incomingTime = incomingActivityAt
              ? Date.parse(incomingActivityAt)
              : Number.NaN;
            const currentTime = current.last_message_at
              ? Date.parse(current.last_message_at)
              : Number.NaN;
            const hasNewerActivity =
              Boolean(incomingActivityAt) &&
              (!current.last_message_at ||
                (Number.isFinite(incomingTime) &&
                  (!Number.isFinite(currentTime) ||
                    incomingTime > currentTime)));

            const merged = prev.map((conversation) =>
              conversation.id === conv.id
                ? {
                    ...conversation,
                    ...conv,
                    // Status/assignment updates can carry the previous
                    // message timestamp. Do not let them overwrite a
                    // fresher preview already received through realtime.
                    ...(hasNewerActivity
                      ? {}
                      : {
                          last_message_at: conversation.last_message_at,
                          last_message_text: conversation.last_message_text,
                        }),
                    unread_count: isActive ? 0 : conv.unread_count,
                  }
                : conversation
            );

            return hasNewerActivity && incomingActivityAt
              ? updateConversationActivity(merged, conv.id, incomingActivityAt)
              : merged;
          });
        } else {
          // UPDATE arrived before the INSERT (or after a missed INSERT)
          // — fetch the row so it surfaces with its contact joined. The
          // patch contained in `conv` will already be reflected in what
          // the hydrate fetch returns.
          hydrateConversation(conv.id);
        }

        // Update active conversation if it changed
        if (activeConversationIdRef.current === conv.id) {
          setActiveConversation((prev) => (prev ? { ...prev, ...conv } : prev));
        }
      }
    },
    [accountRole, hydrateConversation, router, user?.id]
  );

  // Subscribe to realtime. The `isConnected` flag below feeds the
  // reconnect resync: realtime is best-effort and events sent while the
  // WS was disconnected (laptop sleep, network blip, background-tab
  // throttle) are simply lost. We need a way to catch up.
  const { isConnected } = useRealtime({
    channelName: 'inbox-realtime',
    onMessageEvent: handleMessageEvent,
    onConversationEvent: handleConversationEvent,
    enabled: true,
  });

  /**
   * Bump `resyncToken` whenever the realtime channel transitions from
   * disconnected → connected *after* the initial connect. The initial
   * connect is covered by the children's on-mount fetches; only later
   * reconnects need a manual refetch to fill the gap.
   *
   * Tracked via a `was-connected` ref rather than a count so that React
   * strict-mode's dev-only effect double-fire doesn't read as a
   * reconnect.
   */
  const wasConnectedRef = useRef(false);
  const initialConnectDoneRef = useRef(false);
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current) {
      // false → true transition
      if (initialConnectDoneRef.current) {
        setResyncToken((n) => n + 1);
      } else {
        initialConnectDoneRef.current = true;
      }
    }
    wasConnectedRef.current = isConnected;
  }, [isConnected]);

  /**
   * Refetch when the tab regains focus. Background tabs may have their
   * WS throttled by the browser even without a full disconnect, so a
   * visibilitychange → visible is a reliable signal that we may have
   * missed events. Cheap to fire; the children dedupe on their own.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setResyncToken((n) => n + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  /**
   * Manual refresh trigger for the thread-header refresh button.
   * Bumps the same resyncToken the reconnect / visibility paths use,
   * so it goes through the existing dedupe & refetch plumbing — no
   * separate code path to keep in sync.
   */
  const handleManualRefresh = useCallback(() => {
    setResyncToken((n) => n + 1);
  }, []);

  const restoreConversationFromCandidate = useCallback(
    (loaded: Conversation[]) => {
      const visibleLoaded = accountRole
        ? filterVisibleConversations(loaded, accountRole, user?.id ?? null)
        : [];
      const candidateId =
        deepLinkConvId ??
        (sessionSelectionReadyRef.current
          ? rememberedConversationIdRef.current
          : null);

      if (
        !candidateId ||
        autoSelectedConversationRef.current === candidateId ||
        visibleLoaded.length === 0
      ) {
        return;
      }

      autoSelectedConversationRef.current = candidateId;
      const match = visibleLoaded.find(
        (conversation) => conversation.id === candidateId
      );
      if (!match) {
        // A stale session value must not affect the next Inbox visit. URL
        // deep links are left alone so an externally shared link can still
        // be diagnosed by the caller instead of being silently rewritten.
        if (
          !deepLinkConvId &&
          rememberedConversationIdRef.current === candidateId
        ) {
          clearRememberedConversation();
        }
        return;
      }

      // Do not clear a thread that has already been hydrated while the list
      // was refreshing. This is the same guard used for URL deep links.
      if (activeConversation?.id === candidateId) return;

      activeConversationIdRef.current = match.id;
      setContactDrawerOpen(false);
      setActiveConversation(match);
      setActiveContact(match.contact ?? null);
      setMessages([]);
      rememberSelectedConversation(match.id);
      replaceInboxConversationUrl(match.id, window.history);

      if (match.unread_count > 0) {
        setConversations((previous) =>
          previous.map((conversation) =>
            conversation.id === match.id
              ? { ...conversation, unread_count: 0 }
              : conversation
          )
        );
      }
    },
    [
      accountRole,
      activeConversation?.id,
      clearRememberedConversation,
      deepLinkConvId,
      rememberSelectedConversation,
      user?.id,
    ]
  );

  // The list and session storage load independently. Keep the list as a
  // pending candidate so either one may finish first without losing the
  // user's selection.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        rememberedConversationIdRef.current = readRememberedInboxConversation(
          window.sessionStorage
        );
      } catch {
        rememberedConversationIdRef.current = null;
      }
    }
    sessionSelectionReadyRef.current = true;
    const pending = pendingConversationsRef.current;
    if (pending) restoreConversationFromCandidate(pending);
  }, [restoreConversationFromCandidate]);

  const handleConversationsLoaded = useCallback(
    (loaded: Conversation[]) => {
      setConversations(loaded);
      pendingConversationsRef.current = loaded;
      restoreConversationFromCandidate(loaded);
    },
    [restoreConversationFromCandidate]
  );

  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      if (
        !accountRole ||
        !isConversationVisibleToUser(conv, accountRole, user?.id ?? null)
      ) {
        return;
      }
      // Re-clicking the already-active conversation would clear the
      // messages array, but the fetch effect in MessageThread only re-runs
      // when conversationId changes — so messages would stay empty until
      // the user navigated away and back. Bail out early instead.
      if (activeConversation?.id === conv.id) return;
      activeConversationIdRef.current = conv.id;
      setContactDrawerOpen(false);
      setActiveConversation(conv);
      setActiveContact(conv.contact ?? null);
      setMessages([]);
      // Optimistically clear the unread badge for this conv. The
      // server-side reset is fired by the unread-reset effect inside
      // MessageThread (which reads activeConversation.unread_count, not
      // the list copy — so we deliberately leave that intact below to
      // keep the effect firing), and the realtime UPDATE that comes
      // back will sync to 0 again as a no-op. Zeroing the list copy
      // here means the user sees the badge disappear the instant they
      // click instead of waiting for the round-trip — and it persists
      // even if the realtime UPDATE is dropped.
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conv.id && c.unread_count > 0 ? { ...c, unread_count: 0 } : c
        )
      );
      // Record the selection on the deep-link ref BEFORE we update the URL.
      // Native history updates are integrated with Next's navigation hooks,
      // so this can still cause the deep-link value to change without
      // navigating the inbox route again. Without this line, the ref still
      // points at the previous value, the auto-select block sees
      // `ref !== deepLinkConvId`, fires a second time, and clobbers the
      // messages MessageThread just fetched.
      autoSelectedConversationRef.current = conv.id;
      rememberSelectedConversation(conv.id);
      // Reflect the selection in the URL so a refresh lands the user
      // back in the same thread, and so copy-paste links work. Use
      // replaceState() to avoid both route navigation and history entries.
      replaceInboxConversationUrl(conv.id, window.history);
    },
    [
      accountRole,
      activeConversation?.id,
      rememberSelectedConversation,
      user?.id,
    ]
  );

  // Deselect the conversation so the list pane comes back. Also clears
  // the ?c= param so a refresh lands on the list instead of re-opening it.
  const handleCloseConversation = useCallback(
    (expectedConversationId?: string) => {
      if (
        expectedConversationId &&
        activeConversationIdRef.current !== expectedConversationId
      ) {
        return;
      }
      activeConversationIdRef.current = null;
      setActiveConversation(null);
      setContactDrawerOpen(false);
      setActiveContact(null);
      setMessages([]);
      // Clearing the ref lets the deep-link auto-selector fire again if
      // the user later visits /inbox?c=<same-id> — desirable UX.
      autoSelectedConversationRef.current = null;
      clearRememberedConversation();
      router.replace('/inbox', { scroll: false });
    },
    [clearRememberedConversation, router]
  );

  const activeConversationId = activeConversation?.id;
  useEffect(() => {
    if (!activeConversationId) return;

    const handleEscape = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        event.isComposing ||
        (target instanceof Element &&
          target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]'))
      ) {
        return;
      }
      handleCloseConversation(activeConversationId);
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [activeConversationId, handleCloseConversation]);

  const handleMarkConversationUnread = useCallback(
    async (conversationId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from('conversations')
        .update({ unread_count: 1 })
        .eq('id', conversationId);

      if (error) {
        console.error('Failed to mark conversation as unread:', error);
        throw error;
      }

      setConversations((previous) =>
        previous.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, unread_count: 1 }
            : conversation
        )
      );
      handleCloseConversation(conversationId);
    },
    [handleCloseConversation]
  );

  const handleMessagesLoaded = useCallback((loaded: Message[]) => {
    setMessages(loaded);
  }, []);

  const handleNewMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  const handleUpdateMessage = useCallback(
    (id: string, updates: Partial<Message>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...updates } : m))
      );
    },
    []
  );

  const handleStatusChange = useCallback(
    (conversationId: string, status: ConversationStatus) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, status } : c))
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) => (prev ? { ...prev, status } : prev));
      }
    },
    [activeConversation]
  );

  const handleAssignChange = useCallback(
    (conversationId: string, assignedAgentId: string | null) => {
      const nextAssignment = assignedAgentId ?? undefined;
      setConversations((prev) =>
        prev.flatMap((c) => {
          if (c.id !== conversationId) return [c];
          const next = { ...c, assigned_agent_id: nextAssignment };
          return accountRole &&
            isConversationVisibleToUser(next, accountRole, user?.id ?? null)
            ? [next]
            : [];
        })
      );
      if (activeConversation?.id === conversationId) {
        const stillVisible =
          accountRole &&
          isConversationVisibleToUser(
            { ...activeConversation, assigned_agent_id: nextAssignment },
            accountRole,
            user?.id ?? null
          );
        if (stillVisible) {
          setActiveConversation((prev) =>
            prev ? { ...prev, assigned_agent_id: nextAssignment } : prev
          );
        } else {
          activeConversationIdRef.current = null;
          setActiveConversation(null);
          setContactDrawerOpen(false);
          setActiveContact(null);
          setMessages([]);
          router.replace('/inbox', { scroll: false });
        }
      }
    },
    [accountRole, activeConversation, router, user?.id]
  );

  const handleBulkAssignChange = useCallback(
    (conversationIds: string[], assignedAgentId: string) => {
      const transferredIds = new Set(conversationIds);
      setConversations((prev) =>
        prev.flatMap((c) => {
          if (!transferredIds.has(c.id)) return [c];
          const next = { ...c, assigned_agent_id: assignedAgentId };
          return accountRole &&
            isConversationVisibleToUser(next, accountRole, user?.id ?? null)
            ? [next]
            : [];
        })
      );
      setActiveConversation((prev) => {
        if (!prev || !transferredIds.has(prev.id)) return prev;
        const stillVisible =
          accountRole &&
          isConversationVisibleToUser(
            { ...prev, assigned_agent_id: assignedAgentId },
            accountRole,
            user?.id ?? null
          );
        return stillVisible
          ? { ...prev, assigned_agent_id: assignedAgentId }
          : null;
      });
      if (
        activeConversation &&
        transferredIds.has(activeConversation.id) &&
        (!accountRole ||
          !isConversationVisibleToUser(
            { ...activeConversation, assigned_agent_id: assignedAgentId },
            accountRole,
            user?.id ?? null
          ))
      ) {
        activeConversationIdRef.current = null;
        setActiveContact(null);
        setMessages([]);
        router.replace('/inbox', { scroll: false });
      }
    },
    [accountRole, activeConversation, router, user?.id]
  );

  const handleBulkStatusChange = useCallback(
    (conversationIds: string[], status: ConversationStatus) => {
      const updatedIds = new Set(conversationIds);
      setConversations((prev) =>
        prev.map((conversation) =>
          updatedIds.has(conversation.id)
            ? { ...conversation, status }
            : conversation
        )
      );
      setActiveConversation((prev) =>
        prev && updatedIds.has(prev.id) ? { ...prev, status } : prev
      );
    },
    []
  );

  // On narrower screens keep the inbox to one pane at a time. Opening a
  // thread covers the dashboard shell; the back button or Escape returns
  // to the full conversation list. Wide screens retain the split view.
  const hasActiveConv = !!activeConversation;

  return (
    <div
      className={cn(
        '-m-4 flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden sm:-m-6',
        hasActiveConv &&
          'fixed inset-0 z-40 m-0 h-dvh w-full bg-background sm:m-0 xl:relative xl:inset-auto xl:z-auto xl:-m-4 xl:h-[calc(100dvh-3.5rem)] xl:w-auto 2xl:-m-6'
      )}
    >
      {/* WhatsApp connection banner — in the flex column, not absolute,
          so it pushes the panels down instead of overlapping them. */}
      {whatsappConnected === false && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2">
          <WifiOff className="h-4 w-4 text-amber-400" />
          <p className="text-xs text-amber-400">{t('whatsappNotConnected')}</p>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Keep the conversation list full-width until there is room for a
            useful split view. */}
        <div
          className={cn(
            'flex h-full flex-1 xl:flex-none',
            hasActiveConv ? 'hidden xl:flex' : 'flex'
          )}
        >
          <ConversationList
            activeConversationId={activeConversation?.id ?? null}
            onSelect={handleSelectConversation}
            conversations={conversations}
            onConversationsLoaded={handleConversationsLoaded}
            onBulkAssignChange={handleBulkAssignChange}
            onBulkStatusChange={handleBulkStatusChange}
            resyncToken={resyncToken}
          />
        </div>

        {/* Center panel: Message thread. Hidden on narrow screens until a
            conversation is selected; wide screens keep the split view.

            `min-w-0` is load-bearing: without it, a single wide piece
            of content inside the thread (long quote preview, very
            long URL in a message body) forces the flex child past
            its share and pushes the contact-sidebar panel off-screen
            on the right. Issue #165. */}
        <div
          className={cn(
            'flex h-full min-w-0 flex-1 xl:flex',
            hasActiveConv ? 'flex' : 'hidden xl:flex'
          )}
        >
          <MessageThread
            conversation={activeConversation}
            contact={activeContact}
            messages={messages}
            onMessagesLoaded={handleMessagesLoaded}
            onNewMessage={handleNewMessage}
            onUpdateMessage={handleUpdateMessage}
            onStatusChange={handleStatusChange}
            onAssignChange={handleAssignChange}
            onMarkUnread={handleMarkConversationUnread}
            onBack={handleCloseConversation}
            resyncToken={resyncToken}
            onRefresh={handleManualRefresh}
            contactPanelOpen={contactPanelOpen}
            onToggleContactPanel={handleToggleContactPanel}
            contactDrawerOpen={contactDrawerOpen}
            onOpenContactPanel={handleOpenContactDrawer}
          />
        </div>

        {/* Reserve the contact panel for wide desktops so the list and
            message controls stay readable at laptop widths. */}
        {contactPanelOpen && (
          <div className="hidden 2xl:block">
            <ContactSidebar
              key={activeContact?.id ?? 'no-contact'}
              contact={activeContact}
              variant="details"
            />
          </div>
        )}
      </div>

      <Sheet
        open={contactDrawerOpen && Boolean(activeConversation)}
        onOpenChange={setContactDrawerOpen}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-[min(90vw,17.5rem)] gap-0 border-border bg-card p-0 sm:max-w-none"
        >
          <SheetHeader className="flex h-12 shrink-0 flex-row items-center justify-between gap-2 border-b border-border px-3 py-2">
            <SheetTitle className="min-w-0 truncate text-sm">
              {activeContact?.name || activeContact?.phone || tThread('showContact')}
            </SheetTitle>
            <SheetClose
              render={
                <button
                  type="button"
                  aria-label={tThread('hideContactPanel')}
                  title={tThread('hideContact')}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                />
              }
            >
              <X className="h-4 w-4" />
            </SheetClose>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            {contactDrawerOpen && (
              <ContactSidebar
                key={activeContact?.id ?? 'no-contact-drawer'}
                contact={activeContact}
                variant="details"
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
