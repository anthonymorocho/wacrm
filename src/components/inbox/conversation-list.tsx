'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  CONVERSATION_SELECT,
  filterVisibleConversations,
  getConversationAssignmentKind,
  isActiveInboxConversation,
  isQueuedInboxConversation,
  matchesContactFilters,
  normalizeConversations,
} from '@/lib/inbox/conversations';
import type { AccountRole } from '@/lib/auth/roles';
import { cn } from '@/lib/utils';
import type { Conversation, ConversationStatus, Profile, Tag } from '@/types';
import { ArrowRight, CheckCheck, Search, ChevronDown, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BulkTransferDialog } from './bulk-transfer-dialog';
import { BulkCloseDialog } from './bulk-close-dialog';
import { getBulkDialogKey } from '@/lib/inbox/dialog-keys';
import { ConversationChannelBadge } from './channel-badge';

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  onBulkAssignChange: (
    conversationIds: string[],
    assignedAgentId: string
  ) => void;
  onBulkStatusChange: (
    conversationIds: string[],
    status: ConversationStatus
  ) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

type InboxFilter = ConversationStatus | 'active' | 'queue' | 'unread';
type AssignmentFilter = 'owned' | 'transferred';

export function getInboxFilterValues(): InboxFilter[] {
  return ['active', 'queue', 'unread', 'open', 'pending', 'closed'];
}

export function shouldApplyAssignmentFilter(
  accountRole: AccountRole | null,
  filter: InboxFilter
): boolean {
  return accountRole === 'agent' && filter !== 'queue';
}

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  onBulkAssignChange,
  onBulkStatusChange,
  resyncToken = 0,
}: ConversationListProps) {
  const t = useTranslations('Inbox.conversationList');
  const tTransfer = useTranslations('Inbox.bulkTransfer');
  const tClose = useTranslations('Inbox.bulkClose');
  const { user, accountRole, canSendMessages } = useAuth();

  const FILTER_OPTIONS: { label: string; value: InboxFilter }[] =
    useMemo(() => {
      const labels: Record<InboxFilter, string> = {
        active: t('filterActive'),
        queue: t('filterQueue'),
        unread: t('filterUnread'),
        open: t('filterOpen'),
        pending: t('filterPending'),
        closed: t('filterClosed'),
      };
      return getInboxFilterValues().map((value) => ({
        label: labels[value],
        value,
      }));
    }, [t]);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<InboxFilter>('active');
  const [assignmentFilter, setAssignmentFilter] =
    useState<AssignmentFilter>('owned');
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedConversationIds, setSelectedConversationIds] = useState<
    string[]
  >([]);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  // Contact-based filters (issue #272). Tags use OR logic (a conversation
  // matches if its contact carries any selected tag), consistent with
  // Broadcast audience filtering. Company is an exact match on the field.
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select(CONVERSATION_SELECT)
        .order('last_message_at', { ascending: false });

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error('Failed to fetch conversations:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(normalizeConversations(data ?? []));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  // Tag definitions for the filter picker — loaded once so labels/colours
  // stay stable regardless of which conversations happen to be loaded.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('tags').select('*').order('name');
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Company options are derived from the loaded conversations — there's no
  // separate companies table, and only companies with a live conversation
  // are worth offering as an inbox filter.
  // Profiles are account-scoped by RLS. Loading them once lets each row show
  // the assignee without adding a query per conversation.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    supabase
      .from('profiles')
      .select('*')
      .order('full_name')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('Failed to fetch Inbox assignees:', error);
          return;
        }
        setProfiles((data as Profile[]) ?? []);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  const filtered = useMemo(() => {
    let result = filterVisibleConversations(
      conversations,
      accountRole,
      user?.id ?? null
    );

    // The shared queue is independent of assignment history. A conversation
    // released after a transfer still belongs in "En cola" for every role.
    if (shouldApplyAssignmentFilter(accountRole, filter)) {
      result = result.filter(
        (conversation) =>
          getConversationAssignmentKind(conversation) === assignmentFilter
      );
    }

    if (filter === 'active') {
      result = result.filter(isActiveInboxConversation);
    } else if (filter === 'queue') {
      result = result.filter(isQueuedInboxConversation);
    } else if (filter === 'unread') {
      result = result.filter(
        (c) => isActiveInboxConversation(c) && c.unread_count > 0
      );
    } else if (filter === 'closed') {
      result = result.filter((c) => c.status === 'closed');
    } else {
      result = result.filter(
        (c) => c.status === filter && isActiveInboxConversation(c)
      );
    }

    // Contact-based filters (tags via OR logic, exact company match).
    if (selectedTagIds.length > 0 || selectedCompany !== null) {
      result = result.filter((c) =>
        matchesContactFilters(c, {
          tagIds: selectedTagIds,
          company: selectedCompany,
        })
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? '';
        const phone = c.contact?.phone?.toLowerCase() ?? '';
        const lastMsg = c.last_message_text?.toLowerCase() ?? '';
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
      });
    }

    return result;
  }, [
    accountRole,
    assignmentFilter,
    conversations,
    filter,
    search,
    selectedTagIds,
    selectedCompany,
    user?.id,
  ]);

  const profilesByUserId = useMemo(() => {
    const result = new Map<string, Profile>();
    for (const profile of profiles) result.set(profile.user_id, profile);
    return result;
  }, [profiles]);

  const selectableConversations = useMemo(
    () =>
      filtered.filter(
        (conversation) =>
          conversation.status !== 'closed' &&
          conversation.assigned_agent_id === user?.id
      ),
    [filtered, user?.id]
  );

  const selectableIds = useMemo(
    () =>
      new Set(selectableConversations.map((conversation) => conversation.id)),
    [selectableConversations]
  );
  const selectedVisibleCount = selectedConversationIds.filter((id) =>
    selectableIds.has(id)
  ).length;
  const selectedVisibleIds = selectedConversationIds.filter((id) =>
    selectableIds.has(id)
  );
  const allSelectableSelected =
    selectableConversations.length > 0 &&
    selectableConversations.every((conversation) =>
      selectedConversationIds.includes(conversation.id)
    );

  const toggleConversationSelection = useCallback((conversationId: string) => {
    setSelectedConversationIds((previous) =>
      previous.includes(conversationId)
        ? previous.filter((id) => id !== conversationId)
        : [...previous, conversationId]
    );
  }, []);

  const toggleSelectAll = useCallback(() => {
    const visibleIds = selectableConversations.map(
      (conversation) => conversation.id
    );
    setSelectedConversationIds((previous) => {
      if (visibleIds.every((id) => previous.includes(id))) {
        return previous.filter((id) => !selectableIds.has(id));
      }
      return Array.from(new Set([...previous, ...visibleIds]));
    });
  }, [selectableConversations, selectableIds]);

  const handleBulkTransfer = useCallback(
    async (targetAgentId: string) => {
      if (transferring || selectedVisibleIds.length === 0) return;

      setTransferring(true);
      try {
        const response = await fetch('/api/conversations/bulk-transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_ids: selectedVisibleIds,
            target_agent_id: targetAgentId,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error ?? `HTTP ${response.status}`);
        }

        const transferredIds = Array.isArray(payload?.conversation_ids)
          ? payload.conversation_ids.filter(
              (id: unknown): id is string => typeof id === 'string'
            )
          : [];
        onBulkAssignChange(transferredIds, targetAgentId);
        setSelectedConversationIds((previous) =>
          previous.filter((id) => !transferredIds.includes(id))
        );
        setTransferDialogOpen(false);

        if (transferredIds.length > 0) {
          toast.success(tTransfer('success', { count: transferredIds.length }));
        } else {
          toast.info(tTransfer('noChanges'));
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : tTransfer('error')
        );
      } finally {
        setTransferring(false);
      }
    },
    [onBulkAssignChange, selectedVisibleIds, tTransfer, transferring]
  );

  const handleBulkClose = useCallback(async () => {
    if (closing || selectedVisibleIds.length === 0) return;

    setClosing(true);
    try {
      const response = await fetch('/api/conversations/bulk-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_ids: selectedVisibleIds }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }

      const closedIds = Array.isArray(payload?.conversation_ids)
        ? payload.conversation_ids.filter(
            (id: unknown): id is string => typeof id === 'string'
          )
        : [];
      onBulkStatusChange(closedIds, 'closed');
      setSelectedConversationIds((previous) =>
        previous.filter((id) => !closedIds.includes(id))
      );
      setCloseDialogOpen(false);

      if (closedIds.length > 0) {
        toast.success(tClose('success', { count: closedIds.length }));
      } else {
        toast.info(tClose('noChanges'));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tClose('error'));
    } finally {
      setClosing(false);
    }
  }, [closing, onBulkStatusChange, selectedVisibleIds, tClose]);

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }, []);

  const clearContactFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSelectedCompany(null);
  }, []);

  const hasContactFilters =
    selectedTagIds.length > 0 || selectedCompany !== null;

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="border-border bg-card flex h-full w-full flex-col border-r lg:w-80">
      {/* Search + Filter */}
      <div className="border-border space-y-2 border-b p-3">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder={t('searchPlaceholder')}
            className="border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 pl-9 text-sm"
          />
        </div>

        {accountRole === 'agent' && (
          <div
            className="bg-muted flex items-center gap-1 rounded-md p-1"
            role="tablist"
            aria-label={t('assignmentGroups')}
          >
            {(['owned', 'transferred'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={assignmentFilter === kind}
                onClick={() => setAssignmentFilter(kind)}
                className={cn(
                  'flex-1 rounded px-2 py-1 text-xs transition-colors',
                  assignmentFilter === kind
                    ? 'bg-card text-foreground font-medium shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {kind === 'owned' ? t('owned') : t('transferred')}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs">
              {activeFilter?.label ?? t('filterActive')}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover"
            >
              {FILTER_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    'text-sm',
                    filter === opt.value
                      ? 'text-primary'
                      : 'text-popover-foreground'
                  )}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {tags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  'hover:bg-muted inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs',
                  selectedTagIds.length > 0
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t('tags')}
                {selectedTagIds.length > 0 && (
                  <span className="bg-primary text-primary-foreground flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold">
                    {selectedTagIds.length}
                  </span>
                )}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="border-border bg-popover max-h-64 w-56"
              >
                {tags.map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t.id}
                    checked={selectedTagIds.includes(t.id)}
                    onCheckedChange={() => toggleTag(t.id)}
                    className="text-popover-foreground text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="truncate">{t.name}</span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {companies.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  'hover:bg-muted inline-flex h-7 max-w-40 items-center justify-center gap-1 rounded-md px-2 text-xs',
                  selectedCompany
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span className="truncate">
                  {selectedCompany ?? t('company')}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="border-border bg-popover max-h-64 w-56"
              >
                <DropdownMenuItem
                  onClick={() => setSelectedCompany(null)}
                  className={cn(
                    'text-sm',
                    selectedCompany === null
                      ? 'text-primary'
                      : 'text-popover-foreground'
                  )}
                >
                  {t('allCompanies')}
                </DropdownMenuItem>
                {companies.map((co) => (
                  <DropdownMenuItem
                    key={co}
                    onClick={() => setSelectedCompany(co)}
                    className={cn(
                      'text-sm',
                      selectedCompany === co
                        ? 'text-primary'
                        : 'text-popover-foreground'
                    )}
                  >
                    <span className="truncate">{co}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {canSendMessages && selectableConversations.length > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <Checkbox
              checked={allSelectableSelected}
              indeterminate={selectedVisibleCount > 0 && !allSelectableSelected}
              onCheckedChange={toggleSelectAll}
              aria-label={
                allSelectableSelected
                  ? tTransfer('clearSelection')
                  : tTransfer('selectAll')
              }
            />
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
              {selectedVisibleCount > 0
                ? tTransfer('selectedCount', {
                    count: selectedVisibleCount,
                  })
                : tTransfer('selectMine')}
            </span>
            {selectedVisibleCount > 0 && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCloseDialogOpen(true)}
                  className="border-border text-popover-foreground hover:bg-muted text-xs"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  {tClose('action')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setTransferDialogOpen(true)}
                  className="border-border text-popover-foreground hover:bg-muted text-xs"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                  {tTransfer('transfer')}
                </Button>
              </>
            )}
          </div>
        )}

        {hasContactFilters && (
          <div className="flex flex-wrap items-center gap-1">
            {selectedTagIds.map((id) => {
              const tag = tagsById.get(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleTag(id)}
                  className="bg-muted text-foreground hover:bg-muted/70 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: tag?.color ?? 'var(--muted-foreground)',
                    }}
                  />
                  <span className="max-w-24 truncate">
                    {tag?.name ?? t('tags')}
                  </span>
                  <X className="h-3 w-3" />
                </button>
              );
            })}
            {selectedCompany && (
              <button
                onClick={() => setSelectedCompany(null)}
                className="bg-muted text-foreground hover:bg-muted/70 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
              >
                <span className="max-w-24 truncate">{selectedCompany}</span>
                <X className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={clearContactFilters}
              className="text-muted-foreground hover:text-foreground px-1 text-[11px]"
            >
              {t('clearAll')}
            </button>
          </div>
        )}
      </div>

      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="border-primary h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-muted-foreground text-sm">
              {t('noConversations')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                t={t}
                selectable={
                  canSendMessages &&
                  conv.status !== 'closed' &&
                  conv.assigned_agent_id === user?.id
                }
                selected={selectedConversationIds.includes(conv.id)}
                onToggleSelect={toggleConversationSelection}
                assignee={
                  conv.assigned_agent_id
                    ? profilesByUserId.get(conv.assigned_agent_id)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <BulkTransferDialog
        key={getBulkDialogKey('transfer', transferDialogOpen)}
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        selectedCount={selectedConversationIds.length}
        profiles={profiles}
        currentUserId={user?.id}
        submitting={transferring}
        onConfirm={(targetAgentId) => void handleBulkTransfer(targetAgentId)}
      />
      <BulkCloseDialog
        key={getBulkDialogKey('close', closeDialogOpen)}
        open={closeDialogOpen}
        onOpenChange={setCloseDialogOpen}
        selectedCount={selectedConversationIds.length}
        submitting={closing}
        onConfirm={() => void handleBulkClose()}
      />
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  t: ReturnType<typeof useTranslations>;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: (conversationId: string) => void;
  assignee?: Profile;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  t,
  selectable,
  selected,
  onToggleSelect,
  assignee,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || t('unknown');
  const initials = displayName.charAt(0).toUpperCase();
  const statusLabel: Record<ConversationStatus, string> = {
    open: t('statusOpen'),
    pending: t('statusPending'),
    closed: t('statusClosed'),
  };

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
      })
    : '';

  return (
    <div
      className={cn(
        'hover:bg-muted/50 flex w-full items-start gap-2 px-3 py-3 transition-colors',
        isActive && 'border-primary bg-muted/70 border-l-2'
      )}
    >
      {selectable && (
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect(conversation.id)}
          aria-label={displayName}
          className="mt-1.5"
        />
      )}

      <button
        type="button"
        onClick={handleClick}
        className="flex min-w-0 flex-1 items-start gap-3 text-left"
      >
        {/* Avatar */}
        <div className="bg-muted text-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-medium">
          {contact?.avatar_url ? (
            <img
              src={contact.avatar_url}
              alt={displayName}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            initials
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="text-foreground truncate text-sm font-medium">
                {displayName}
              </span>
              <ConversationChannelBadge channel={conversation.channel} />
            </div>
            <span className="text-muted-foreground shrink-0 text-[10px]">
              {timeAgo}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className="text-muted-foreground truncate text-xs">
              {conversation.last_message_text || t('noMessagesYet')}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {conversation.unread_count > 0 && (
                <span className="bg-primary text-primary-foreground flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold">
                  {conversation.unread_count}
                </span>
              )}
            </div>
          </div>
          <p className="text-muted-foreground/80 mt-1 flex min-w-0 items-center gap-1 truncate text-[10px]">
            <span className="shrink-0">{statusLabel[conversation.status]}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">
              {conversation.assigned_agent_id
                ? t('assignedTo') + ': ' + (assignee?.full_name ?? t('unknown'))
                : t('inQueue')}
            </span>
          </p>
          {getConversationAssignmentKind(conversation) === 'transferred' && (
            <span className="mt-1 inline-flex rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
              {t('transferred')}
            </span>
          )}
        </div>
      </button>
    </div>
  );
}
