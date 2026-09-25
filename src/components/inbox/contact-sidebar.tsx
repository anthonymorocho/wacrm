'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { cn } from '@/lib/utils';
import { addContactTag, deleteContactTag } from '@/lib/contacts/tag-api';
import {
  moveDealToPipeline,
  shouldShowAdditionalPipelineAssignment,
  toggleTagId,
} from '@/lib/inbox/contact-sidebar-state';
import { toast } from 'sonner';
import type {
  Contact,
  Deal,
  ContactNote,
  Tag,
  Pipeline,
  PipelineStage,
} from '@/types';
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  StickyNote,
  Plus,
  ChevronRight,
  GitBranch,
  Loader2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format } from 'date-fns';
import { useTranslations } from 'next-intl';

interface ContactSidebarProps {
  contact: Contact | null;
  variant?: 'details' | 'quick-actions';
}

type ContactTag = Tag & { contact_tag_id: string };

interface ContactSidebarData {
  deals: Deal[];
  setDeals: Dispatch<SetStateAction<Deal[]>>;
  pipelines: Pipeline[];
  stagesByPipeline: Record<string, PipelineStage[]>;
  tags: ContactTag[];
  setTags: Dispatch<SetStateAction<ContactTag[]>>;
  allTags: Tag[];
  updatingTagId: string | null;
  setUpdatingTagId: Dispatch<SetStateAction<string | null>>;
  savingDealId: string | null;
  setSavingDealId: Dispatch<SetStateAction<string | null>>;
  addingDeal: boolean;
  setAddingDeal: Dispatch<SetStateAction<boolean>>;
  refresh: () => Promise<void>;
}

const ContactSidebarDataContext = createContext<ContactSidebarData | null>(
  null
);

export function ContactSidebarDataProvider({
  contact,
  children,
}: {
  contact: Contact | null;
  children: ReactNode;
}) {
  const contactId = contact?.id;
  const requestIdRef = useRef(0);
  const currentContactIdRef = useRef(contactId);
  const [loadedContactId, setLoadedContactId] = useState<string | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stagesByPipeline, setStagesByPipeline] = useState<
    Record<string, PipelineStage[]>
  >({});
  const [tags, setTags] = useState<ContactTag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [updatingTagId, setUpdatingTagId] = useState<string | null>(null);
  const [savingDealId, setSavingDealId] = useState<string | null>(null);
  const [addingDeal, setAddingDeal] = useState(false);

  useEffect(() => {
    currentContactIdRef.current = contactId;
  }, [contactId]);

  const refresh = useCallback(async () => {
    if (currentContactIdRef.current !== contactId) return;
    const requestId = ++requestIdRef.current;
    if (!contactId) {
      setLoadedContactId(null);
      setDeals([]);
      setPipelines([]);
      setStagesByPipeline({});
      setTags([]);
      setAllTags([]);
      return;
    }

    const supabase = createClient();
    const [dealsRes, tagsRes, allTagsRes, pipelinesRes] = await Promise.all([
      supabase
        .from('deals')
        .select('*, stage:pipeline_stages(*)')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false }),
      supabase
        .from('contact_tags')
        .select('id, tag_id, tags(*)')
        .eq('contact_id', contactId),
      supabase.from('tags').select('*').order('name'),
      supabase.from('pipelines').select('*').order('created_at'),
    ]);

    const loadedPipelines = (pipelinesRes.data ?? []) as Pipeline[];
    const pipelineIds = loadedPipelines.map((pipeline) => pipeline.id);
    const stagesRes = pipelineIds.length
      ? await supabase
          .from('pipeline_stages')
          .select('*')
          .in('pipeline_id', pipelineIds)
          .order('position')
      : { data: [] as PipelineStage[] };
    const stagesMap: Record<string, PipelineStage[]> = {};
    for (const stage of (stagesRes.data ?? []) as PipelineStage[]) {
      (stagesMap[stage.pipeline_id] ??= []).push(stage);
    }
    const mappedTags = (tagsRes.data ?? [])
      .filter((row: Record<string, unknown>) => row.tags)
      .map((row: Record<string, unknown>) => ({
        ...(row.tags as Tag),
        contact_tag_id: row.id as string,
      }));

    if (
      requestId !== requestIdRef.current ||
      currentContactIdRef.current !== contactId
    )
      return;

    setDeals((dealsRes.data ?? []) as Deal[]);
    setPipelines(loadedPipelines);
    setStagesByPipeline(stagesMap);
    setTags(mappedTags);
    setAllTags((allTagsRes.data ?? []) as Tag[]);
    setLoadedContactId(contactId);
  }, [contactId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setCurrentDeals = useCallback<Dispatch<SetStateAction<Deal[]>>>(
    (update) => {
      if (currentContactIdRef.current === contactId) setDeals(update);
    },
    [contactId]
  );
  const setCurrentTags = useCallback<Dispatch<SetStateAction<ContactTag[]>>>(
    (update) => {
      if (currentContactIdRef.current === contactId) setTags(update);
    },
    [contactId]
  );

  const hasCurrentContactData =
    Boolean(contactId) && loadedContactId === contactId;
  const value: ContactSidebarData = {
    deals: hasCurrentContactData ? deals : [],
    setDeals: setCurrentDeals,
    pipelines: hasCurrentContactData ? pipelines : [],
    stagesByPipeline: hasCurrentContactData ? stagesByPipeline : {},
    tags: hasCurrentContactData ? tags : [],
    setTags: setCurrentTags,
    allTags: hasCurrentContactData ? allTags : [],
    updatingTagId,
    setUpdatingTagId,
    savingDealId,
    setSavingDealId,
    addingDeal,
    setAddingDeal,
    refresh,
  };

  return (
    <ContactSidebarDataContext.Provider value={value}>
      {children}
    </ContactSidebarDataContext.Provider>
  );
}

function useContactSidebarData() {
  const data = useContext(ContactSidebarDataContext);
  if (!data) {
    throw new Error(
      'ContactSidebar must be rendered inside ContactSidebarDataProvider'
    );
  }
  return data;
}

export function ContactSidebar({
  contact,
  variant = 'details',
}: ContactSidebarProps) {
  const tSidebar = useTranslations('Inbox.sidebar');
  const tThread = useTranslations('Inbox.messageThread');
  const tAutomation = useTranslations('Automations');

  const { accountId } = useAuth();
  const canEditContact = useCan('send-messages');
  const instanceId = useId();
  const {
    deals,
    setDeals,
    pipelines,
    stagesByPipeline,
    tags,
    setTags,
    allTags,
    updatingTagId,
    setUpdatingTagId,
    savingDealId,
    setSavingDealId,
    addingDeal,
    setAddingDeal,
    refresh: refreshContactData,
  } = useContactSidebarData();
  const [copied, setCopied] = useState(false);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [addPipelineId, setAddPipelineId] = useState('');
  const [addStageId, setAddStageId] = useState('');
  const [addPipelineOpen, setAddPipelineOpen] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const isQuickActions = variant === 'quick-actions';

  const contactId = contact?.id;
  const addPipelineElementId = `contact-sidebar-add-pipeline-${instanceId}`;
  const addFunnelPipelineId = addPipelineId || pipelines[0]?.id || '';
  const addFunnelStageId =
    addStageId || stagesByPipeline[addFunnelPipelineId]?.[0]?.id || '';

  useEffect(() => {
    if (!contactId || isQuickActions) return;

    let active = true;
    const loadNotes = async () => {
      const { data } = await createClient()
        .from('contact_notes')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false });
      if (active && data) setNotes(data);
    };
    void loadNotes();

    return () => {
      active = false;
    };
  }, [contactId, isQuickActions]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from('contact_notes')
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote('');
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  const handleToggleTag = useCallback(
    async (tagId: string) => {
      if (!contact || !canEditContact || updatingTagId) return;
      const currentTagIds = tags.map((tag) => tag.id);
      const isSelected = currentTagIds.includes(tagId);
      const tag = allTags.find((item) => item.id === tagId);
      if (!tag) return;

      const nextTagIds = toggleTagId(currentTagIds, tagId);
      const nextTags = nextTagIds.flatMap((id) => {
        const existing = tags.find((item) => item.id === id);
        return existing
          ? [existing]
          : id === tag.id
            ? [{ ...tag, contact_tag_id: `local-${tag.id}` }]
            : [];
      });
      setUpdatingTagId(tagId);
      setTags(nextTags);

      try {
        if (isSelected) await deleteContactTag(contact.id, tagId);
        else await addContactTag(contact.id, tagId);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : tSidebar('tagUpdateFailed');
        // A failed request must not leave the optimistic chip visible.
        console.error('Failed to update contact tag:', error);
        setTags(tags);
        toast.error(message);
      } finally {
        setUpdatingTagId(null);
      }
    },
    [allTags, canEditContact, contact, tags, tSidebar, updatingTagId]
  );

  const updateDeal = useCallback(
    async (deal: Deal, pipelineId: string, stageId: string) => {
      if (!contact || !canEditContact || savingDealId) return;
      const targetStage = (stagesByPipeline[pipelineId] ?? []).find(
        (stage) => stage.id === stageId
      );
      if (!targetStage) return;

      const previousDeals = deals;
      const movedDeals = moveDealToPipeline(
        deals,
        deal.id,
        pipelineId,
        stageId
      ).map((item) =>
        item.id === deal.id ? { ...item, stage: targetStage } : item
      );
      setDeals(movedDeals);
      setSavingDealId(deal.id);
      const { error } = await createClient()
        .from('deals')
        .update({ pipeline_id: pipelineId, stage_id: stageId })
        .eq('id', deal.id)
        .eq('contact_id', contact.id);
      if (error) {
        setDeals(previousDeals);
        toast.error(tSidebar('dealUpdateFailed'));
      } else {
        toast.success(tSidebar('dealUpdated'));
      }
      setSavingDealId(null);
    },
    [canEditContact, contact, deals, savingDealId, stagesByPipeline, tSidebar]
  );

  const handleAddToPipeline = useCallback(async () => {
    if (
      !contact ||
      !accountId ||
      !addFunnelPipelineId ||
      !addFunnelStageId ||
      !canEditContact
    )
      return;
    setAddingDeal(true);
    const {
      data: { session },
    } = await createClient().auth.getSession();
    const user = session?.user;
    if (!user) {
      setAddingDeal(false);
      return;
    }

    const { error } = await createClient()
      .from('deals')
      .insert({
        account_id: accountId,
        user_id: user.id,
        contact_id: contact.id,
        pipeline_id: addFunnelPipelineId,
        stage_id: addFunnelStageId,
        title: contact.name || contact.phone,
        value: 0,
        status: 'open',
      });
    if (error) toast.error(tSidebar('dealCreateFailed'));
    else {
      toast.success(tSidebar('dealCreated'));
      await refreshContactData();
    }
    setAddingDeal(false);
  }, [
    accountId,
    addFunnelPipelineId,
    addFunnelStageId,
    canEditContact,
    contact,
    refreshContactData,
    tSidebar,
  ]);

  if (!contact) {
    return (
      <div className="border-border bg-card flex h-full w-full items-center justify-center border-l 2xl:w-70">
        <p className="text-muted-foreground text-sm">
          {tThread('selectConversation')}
        </p>
      </div>
    );
  }

  const displayName =
    contact.name || contact.phone || tThread('unknownContact');
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div
      className={cn(
        'border-border bg-card flex w-full flex-col',
        isQuickActions
          ? 'bg-card/85 shrink-0 border-b shadow-[0_1px_0_rgba(255,255,255,0.025)]'
          : 'h-full border-l 2xl:w-70'
      )}
    >
      <ScrollArea className={isQuickActions ? 'shrink-0' : 'min-h-0 flex-1'}>
        <div
          className={cn(
            'p-4',
            isQuickActions &&
              'flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2.5 md:flex-nowrap md:px-4'
          )}
        >
          {/* Contact Info */}
          <div
            className={cn(
              'flex flex-col items-center text-center',
              isQuickActions && 'hidden'
            )}
          >
            <div className="bg-muted text-foreground flex h-16 w-16 items-center justify-center rounded-full text-lg font-semibold">
              {contact.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="text-foreground mt-3 text-sm font-semibold">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-muted-foreground text-xs">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className={cn('mt-4 space-y-2', isQuickActions && 'hidden')}>
            <button
              onClick={handleCopyPhone}
              className="text-muted-foreground hover:bg-muted flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors"
            >
              <Phone className="text-muted-foreground h-4 w-4" />
              <span className="flex-1 text-left">
                {contact.phone ?? tThread('phoneUnavailable')}
              </span>
              {copied ? (
                <Check className="text-primary h-3 w-3" />
              ) : (
                <Copy className="text-muted-foreground h-3 w-3" />
              )}
            </button>

            {contact.email && (
              <div className="text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
                <Mail className="text-muted-foreground h-4 w-4" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div
            className={cn(
              'border-border my-4 border-t',
              isQuickActions && 'hidden'
            )}
          />

          {/* Tags */}
          <div
            className={cn(
              isQuickActions &&
                'flex min-w-0 basis-full items-center gap-2.5 md:w-fit md:max-w-[40%] md:flex-none md:basis-auto'
            )}
          >
            <div
              className={cn(
                'flex items-center justify-between px-1',
                isQuickActions && 'shrink-0 gap-2 px-0'
              )}
            >
              <div className="flex items-center gap-2">
                <span className="bg-primary/10 grid size-8 place-items-center rounded-lg">
                  <TagIcon className="text-primary/85 h-3.5 w-3.5" />
                </span>
                <span className="text-muted-foreground text-[11px] font-semibold tracking-[0.1em] uppercase">
                  {tSidebar('tags')}
                </span>
              </div>
              <Popover open={tagsOpen} onOpenChange={setTagsOpen}>
                <PopoverTrigger
                  disabled={!canEditContact || allTags.length === 0}
                  className={cn(
                    'text-muted-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-primary border-border/70 bg-background/55 flex size-10 shrink-0 items-center justify-center rounded-xl border shadow-sm transition-[background-color,border-color,color,transform] active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40'
                  )}
                  aria-label={tSidebar('addTag')}
                  title={tSidebar('addTag')}
                >
                  <Plus className="h-3.5 w-3.5" />
                </PopoverTrigger>
                <PopoverContent side="bottom" align="start" className="w-56">
                  <p className="text-popover-foreground px-1 text-xs font-medium">
                    {tSidebar('chooseTags')}
                  </p>
                  <div className="mt-1 max-h-52 overflow-y-auto">
                    {allTags.map((tag) => {
                      const selected = tags.some((item) => item.id === tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => void handleToggleTag(tag.id)}
                          disabled={updatingTagId === tag.id}
                          className="text-popover-foreground hover:bg-muted flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs disabled:opacity-50"
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {tag.name}
                          </span>
                          {selected && (
                            <Check className="text-primary h-3.5 w-3.5" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <div
              className={cn(
                'mt-2 flex flex-wrap gap-1',
                isQuickActions && 'mt-0 min-w-0 flex-1 items-center gap-1.5'
              )}
            >
              {tags.length === 0 ? (
                <p className="text-muted-foreground px-1 text-xs italic">
                  {tSidebar('noTags')}
                </p>
              ) : (
                tags.map((tag) => (
                  <button
                    key={tag.contact_tag_id}
                    type="button"
                    onClick={() => void handleToggleTag(tag.id)}
                    disabled={!canEditContact || updatingTagId === tag.id}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium',
                      isQuickActions &&
                        'inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium shadow-sm transition-[filter,transform] hover:brightness-110 active:scale-[0.96] disabled:cursor-not-allowed'
                    )}
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                      ...(isQuickActions
                        ? { borderColor: `${tag.color}45` }
                        : {}),
                    }}
                  >
                    {isQuickActions && (
                      <span
                        aria-hidden="true"
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                    )}
                    {tag.name}
                    {isQuickActions && canEditContact && (
                      <X className="ml-1 inline h-3 w-3 opacity-70" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Funnel and deals */}
          <div
            className={cn(
              !isQuickActions && 'border-border mt-4 border-t pt-4',
              isQuickActions &&
                'border-border flex min-w-0 basis-full flex-wrap items-center gap-2.5 md:flex-1 md:basis-0 md:flex-nowrap md:border-l md:pl-4'
            )}
          >
            <div
              className={cn(
                'flex shrink-0 items-center gap-2',
                !isQuickActions && 'w-full justify-between'
              )}
            >
              <div className="flex items-center gap-2">
                <span className="bg-primary/10 grid size-8 place-items-center rounded-lg">
                  <GitBranch className="text-primary/85 h-3.5 w-3.5" />
                </span>
                <span className="text-muted-foreground text-[11px] font-semibold tracking-[0.1em] uppercase">
                  {tSidebar('funnels')}
                </span>
              </div>
              {deals.length > 0 && canEditContact && pipelines.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAddPipelineOpen((previous) => !previous)}
                  aria-expanded={addPipelineOpen}
                  aria-controls={addPipelineElementId}
                  aria-label={tSidebar(
                    addPipelineOpen ? 'cancelAddFunnel' : 'addAnotherFunnel'
                  )}
                  title={tSidebar(
                    addPipelineOpen ? 'cancelAddFunnel' : 'addAnotherFunnel'
                  )}
                  className="text-muted-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-primary border-border/70 bg-background/55 flex size-10 items-center justify-center rounded-xl border shadow-sm transition-[background-color,border-color,color,transform] active:scale-[0.96]"
                >
                  {addPipelineOpen ? (
                    <X className="h-4 w-4" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
            <div
              className={cn(
                isQuickActions
                  ? 'flex min-w-0 flex-1 basis-full flex-wrap items-center justify-start gap-2 md:basis-auto'
                  : 'mt-3 space-y-2'
              )}
            >
              {deals.length === 0 ? (
                <div
                  className={cn(
                    'flex min-w-0 flex-wrap items-center gap-2',
                    !isQuickActions && 'flex-col items-stretch'
                  )}
                >
                  {(!canEditContact || pipelines.length === 0) && (
                    <span className="text-muted-foreground px-1 text-xs italic">
                      {tSidebar('noDeals')}
                    </span>
                  )}
                  {canEditContact && pipelines.length > 0 && (
                    <PipelineAssignment
                      pipelines={pipelines}
                      stagesByPipeline={stagesByPipeline}
                      pipelineId={addFunnelPipelineId}
                      stageId={addFunnelStageId}
                      onPipelineChange={(pipelineId) => {
                        setAddPipelineId(pipelineId);
                        setAddStageId(
                          stagesByPipeline[pipelineId]?.[0]?.id ?? ''
                        );
                      }}
                      onStageChange={setAddStageId}
                      onAdd={() => void handleAddToPipeline()}
                      disabled={addingDeal}
                      t={tSidebar}
                      compact={isQuickActions}
                    />
                  )}
                </div>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className={cn(
                      'max-w-full',
                      isQuickActions
                        ? 'flex shrink-0 items-center'
                        : 'bg-muted rounded-lg p-3'
                    )}
                  >
                    {!isQuickActions && (
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <p className="text-foreground min-w-0 truncate text-sm font-medium">
                          {deal.title}
                        </p>
                        <span className="text-muted-foreground shrink-0 text-xs">
                          {deal.currency ?? '$'}
                          {deal.value.toLocaleString()}
                        </span>
                      </div>
                    )}
                    <div
                      className={cn(
                        'flex min-w-0 flex-wrap items-center gap-1.5',
                        !isQuickActions && 'mt-2 flex-col items-stretch'
                      )}
                    >
                      <PipelineStageFields
                        pipelines={pipelines}
                        stages={stagesByPipeline[deal.pipeline_id] ?? []}
                        pipelineId={deal.pipeline_id}
                        stageId={deal.stage_id}
                        compact={isQuickActions}
                        disabled={!canEditContact || savingDealId === deal.id}
                        pipelineLabel={`${tAutomation('pipelines.pipelineLabel')}: ${deal.title}`}
                        stageLabel={`${tAutomation('pipelines.stageLabel')}: ${deal.title}`}
                        onPipelineChange={(pipelineId) => {
                          const stageId = stagesByPipeline[pipelineId]?.[0]?.id;
                          if (stageId)
                            void updateDeal(deal, pipelineId, stageId);
                        }}
                        onStageChange={(stageId) =>
                          void updateDeal(deal, deal.pipeline_id, stageId)
                        }
                      />
                      {savingDealId === deal.id && (
                        <Loader2 className="text-primary h-3.5 w-3.5 animate-spin" />
                      )}
                    </div>
                  </div>
                ))
              )}
              {shouldShowAdditionalPipelineAssignment(
                deals.length,
                canEditContact,
                pipelines.length,
                addPipelineOpen
              ) && (
                <div
                  id={addPipelineElementId}
                  className={cn(!isQuickActions && 'mt-2')}
                >
                  <PipelineAssignment
                    pipelines={pipelines}
                    stagesByPipeline={stagesByPipeline}
                    pipelineId={addFunnelPipelineId}
                    stageId={addFunnelStageId}
                    onPipelineChange={(pipelineId) => {
                      setAddPipelineId(pipelineId);
                      setAddStageId(
                        stagesByPipeline[pipelineId]?.[0]?.id ?? ''
                      );
                    }}
                    onStageChange={setAddStageId}
                    onAdd={() => void handleAddToPipeline()}
                    disabled={addingDeal}
                    t={tSidebar}
                    compact={isQuickActions}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className={cn(isQuickActions && 'hidden')}>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <StickyNote className="h-3 w-3" />
              {tSidebar('notes')}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar('addNotePlaceholder')}
                  rows={2}
                  className="border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 flex-1 resize-none rounded-lg border px-3 py-2 text-xs outline-none"
                />
                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary/90 h-auto px-2"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div key={note.id} className="bg-muted rounded-lg px-3 py-2">
                    <p className="text-muted-foreground text-xs whitespace-pre-wrap">
                      {note.note_text}
                    </p>
                    <p className="text-muted-foreground mt-1 text-[10px]">
                      {format(new Date(note.created_at), 'MMM d, yyyy HH:mm')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function PipelineAssignment({
  pipelines,
  stagesByPipeline,
  pipelineId,
  stageId,
  onPipelineChange,
  onStageChange,
  onAdd,
  disabled,
  t,
  compact,
}: {
  pipelines: Pipeline[];
  stagesByPipeline: Record<string, PipelineStage[]>;
  pipelineId: string;
  stageId: string;
  onPipelineChange: (pipelineId: string) => void;
  onStageChange: (stageId: string) => void;
  onAdd: () => void;
  disabled: boolean;
  t: ReturnType<typeof useTranslations>;
  compact: boolean;
}) {
  return (
    <div
      className={cn(
        compact
          ? 'flex max-w-full min-w-0 flex-wrap items-center gap-2'
          : 'grid w-full min-w-0 gap-2',
        disabled && 'opacity-60'
      )}
    >
      <PipelineStageFields
        pipelines={pipelines}
        stages={stagesByPipeline[pipelineId] ?? []}
        pipelineId={pipelineId}
        stageId={stageId}
        compact={compact}
        disabled={disabled}
        onPipelineChange={onPipelineChange}
        onStageChange={onStageChange}
      />
      <Button
        type="button"
        size={compact ? 'icon' : 'sm'}
        aria-label={t('addToFunnel')}
        title={t('addToFunnel')}
        onClick={onAdd}
        disabled={disabled || !pipelineId || !stageId}
        className={cn(
          'bg-primary text-primary-foreground shadow-primary/15 hover:bg-primary/90 shadow-sm transition-[background-color,transform] active:scale-[0.96]',
          compact ? 'size-10 shrink-0 rounded-xl' : 'h-9 w-full rounded-lg'
        )}
      >
        {disabled ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        {!compact && t('addToFunnel')}
      </Button>
    </div>
  );
}

function PipelineStageFields({
  pipelines,
  stages,
  pipelineId,
  stageId,
  disabled,
  compact,
  pipelineLabel,
  stageLabel,
  onPipelineChange,
  onStageChange,
}: {
  pipelines: Pipeline[];
  stages: PipelineStage[];
  pipelineId: string;
  stageId: string;
  disabled: boolean;
  compact: boolean;
  pipelineLabel?: string;
  stageLabel?: string;
  onPipelineChange: (pipelineId: string) => void;
  onStageChange: (stageId: string) => void;
}) {
  const tAutomation = useTranslations('Automations');

  return (
    <div
      className={cn(
        'min-w-0',
        compact
          ? 'bg-background/45 ring-border/60 flex max-w-full items-center gap-0.5 rounded-xl p-1 shadow-sm ring-1 ring-inset'
          : 'grid w-full gap-1.5'
      )}
    >
      <Select
        value={pipelineId}
        items={pipelines.map((pipeline) => ({
          value: pipeline.id,
          label: pipeline.name,
        }))}
        onValueChange={(value) => value && onPipelineChange(value)}
        disabled={disabled}
      >
        <SelectTrigger
          aria-label={pipelineLabel ?? tAutomation('pipelines.pipelineLabel')}
          className={cn(
            'hover:bg-muted/70 focus-visible:ring-primary/30 h-10 min-w-0 rounded-lg px-2.5 text-xs font-medium focus-visible:ring-2 data-[size=default]:h-10',
            compact
              ? 'w-36 max-w-[32vw] min-w-24 border-transparent bg-transparent'
              : 'border-border bg-muted/60 w-full'
          )}
        >
          <SelectValue className="min-w-0 truncate" />
        </SelectTrigger>
        <SelectContent align="start" className="border-border bg-popover">
          {pipelines.map((pipeline) => (
            <SelectItem
              key={pipeline.id}
              value={pipeline.id}
              className="min-h-10"
            >
              {pipeline.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {compact && (
        <ChevronRight
          aria-hidden="true"
          className="text-muted-foreground/55 h-3.5 w-3.5 shrink-0"
        />
      )}
      <Select
        value={stageId}
        items={stages.map((stage) => ({
          value: stage.id,
          label: (
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: stage.color }}
              />
              <span className="truncate">{stage.name}</span>
            </span>
          ),
        }))}
        onValueChange={(value) => value && onStageChange(value)}
        disabled={disabled || stages.length === 0}
      >
        <SelectTrigger
          aria-label={stageLabel ?? tAutomation('pipelines.stageLabel')}
          className={cn(
            'focus-visible:ring-primary/30 h-10 min-w-0 rounded-lg px-2.5 text-xs font-medium focus-visible:ring-2 data-[size=default]:h-10',
            compact
              ? 'bg-primary/5 hover:bg-primary/10 w-32 max-w-[28vw] min-w-20 border-transparent'
              : 'border-primary/20 bg-primary/5 hover:bg-primary/10 w-full'
          )}
        >
          <SelectValue className="min-w-0 truncate" />
        </SelectTrigger>
        <SelectContent align="end" className="border-border bg-popover">
          {stages.map((stage) => (
            <SelectItem key={stage.id} value={stage.id} className="min-h-10">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: stage.color }}
              />
              {stage.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
