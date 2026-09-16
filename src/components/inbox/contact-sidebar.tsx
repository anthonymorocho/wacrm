'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { cn } from '@/lib/utils';
import { addContactTag, deleteContactTag } from '@/lib/contacts/tag-api';
import {
  moveDealToPipeline,
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
  DollarSign,
  StickyNote,
  Plus,
  GitBranch,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { format } from 'date-fns';
import { useTranslations } from 'next-intl';

interface ContactSidebarProps {
  contact: Contact | null;
  onContactUpdated?: (contact: Contact) => void;
}

export function ContactSidebar({
  contact,
  onContactUpdated,
}: ContactSidebarProps) {
  const tSidebar = useTranslations('Inbox.sidebar');
  const tThread = useTranslations('Inbox.messageThread');

  const { accountId } = useAuth();
  const canEditContact = useCan('send-messages');
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stagesByPipeline, setStagesByPipeline] = useState<
    Record<string, PipelineStage[]>
  >({});
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [updatingTagId, setUpdatingTagId] = useState<string | null>(null);
  const [savingDealId, setSavingDealId] = useState<string | null>(null);
  const [addPipelineId, setAddPipelineId] = useState('');
  const [addStageId, setAddStageId] = useState('');
  const [addingDeal, setAddingDeal] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch contact data and account-scoped options in parallel. RLS keeps
    // tags and pipelines limited to this workspace.
    const [dealsRes, notesRes, tagsRes, allTagsRes, pipelinesRes] =
      await Promise.all([
        supabase
          .from('deals')
          .select('*, stage:pipeline_stages(*)')
          .eq('contact_id', contact.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('contact_notes')
          .select('*')
          .eq('contact_id', contact.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('contact_tags')
          .select('id, tag_id, tags(*)')
          .eq('contact_id', contact.id),
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
    const loadedStages = (stagesRes.data ?? []) as PipelineStage[];
    const stagesMap: Record<string, PipelineStage[]> = {};
    for (const stage of loadedStages) {
      (stagesMap[stage.pipeline_id] ??= []).push(stage);
    }

    if (dealsRes.data) setDeals(dealsRes.data as Deal[]);
    setPipelines(loadedPipelines);
    setStagesByPipeline(stagesMap);
    const nextAddPipelineId = loadedPipelines[0]?.id ?? '';
    setAddPipelineId(nextAddPipelineId);
    setAddStageId((previous) => {
      const currentStages = stagesMap[nextAddPipelineId] ?? [];
      return currentStages.some((stage) => stage.id === previous)
        ? previous
        : (currentStages[0]?.id ?? '');
    });
    if (notesRes.data) setNotes(notesRes.data);
    if (allTagsRes.data) setAllTags(allTagsRes.data as Tag[]);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    fetchContactData();
  }, [fetchContactData]);

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
        onContactUpdated?.({ ...contact, tags: nextTags });
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
    [
      allTags,
      canEditContact,
      contact,
      onContactUpdated,
      tags,
      tSidebar,
      updatingTagId,
    ]
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
      !addPipelineId ||
      !addStageId ||
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
        pipeline_id: addPipelineId,
        stage_id: addStageId,
        title: contact.name || contact.phone,
        value: 0,
        status: 'open',
      });
    if (error) toast.error(tSidebar('dealCreateFailed'));
    else {
      toast.success(tSidebar('dealCreated'));
      await fetchContactData();
    }
    setAddingDeal(false);
  }, [
    accountId,
    addPipelineId,
    addStageId,
    canEditContact,
    contact,
    fetchContactData,
    tSidebar,
  ]);

  if (!contact) {
    return (
      <div className="border-border bg-card flex h-full w-70 items-center justify-center border-l">
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
    <div className="border-border bg-card flex h-full w-70 flex-col border-l">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
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
          <div className="mt-4 space-y-2">
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
          <div className="border-border my-4 border-t" />

          {/* Tags */}
          <div>
            <div className="flex items-center justify-between px-1">
              <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wider uppercase">
                <TagIcon className="h-3 w-3" />
                {tSidebar('tags')}
              </div>
              <Popover open={tagsOpen} onOpenChange={setTagsOpen}>
                <PopoverTrigger
                  disabled={!canEditContact || allTags.length === 0}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-5 w-5 items-center justify-center rounded disabled:pointer-events-none disabled:opacity-40"
                  aria-label={tSidebar('addTag')}
                  title={tSidebar('addTag')}
                >
                  <Plus className="h-3.5 w-3.5" />
                </PopoverTrigger>
                <PopoverContent side="left" align="start" className="w-56">
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
                          className="text-popover-foreground hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs disabled:opacity-50"
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
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="text-muted-foreground px-1 text-xs">
                  {tSidebar('noTags')}
                </p>
              ) : (
                tags.map((tag) => (
                  <button
                    key={tag.contact_tag_id}
                    type="button"
                    onClick={() => void handleToggleTag(tag.id)}
                    disabled={!canEditContact || updatingTagId === tag.id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Funnel and deals */}
          <div>
            <div className="flex items-center justify-between px-1">
              <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wider uppercase">
                <GitBranch className="h-3 w-3" />
                {tSidebar('funnels')}
              </div>
              {deals.length > 0 && (
                <DollarSign className="text-muted-foreground h-3 w-3" />
              )}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-muted-foreground px-1 text-xs">
                    {tSidebar('noDeals')}
                  </p>
                  {canEditContact && pipelines.length > 0 && (
                    <PipelineAssignment
                      pipelines={pipelines}
                      stagesByPipeline={stagesByPipeline}
                      pipelineId={addPipelineId}
                      stageId={addStageId}
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
                    />
                  )}
                </div>
              ) : (
                deals.map((deal) => (
                  <div key={deal.id} className="bg-muted rounded-lg px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-foreground min-w-0 truncate text-sm font-medium">
                        {deal.title}
                      </p>
                      <span>
                        {deal.currency ?? '$'}
                        {deal.value.toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-1.5">
                      <select
                        value={deal.pipeline_id}
                        disabled={!canEditContact || savingDealId === deal.id}
                        onChange={(event) => {
                          const pipelineId = event.target.value;
                          const stageId = stagesByPipeline[pipelineId]?.[0]?.id;
                          if (stageId)
                            void updateDeal(deal, pipelineId, stageId);
                        }}
                        className="border-border bg-background text-foreground focus:border-primary h-7 w-full rounded-md border px-2 text-[11px] outline-none disabled:opacity-50"
                      >
                        {pipelines.map((pipeline) => (
                          <option key={pipeline.id} value={pipeline.id}>
                            {pipeline.name}
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={deal.stage_id}
                          disabled={!canEditContact || savingDealId === deal.id}
                          onChange={(event) =>
                            void updateDeal(
                              deal,
                              deal.pipeline_id,
                              event.target.value
                            )
                          }
                          className="border-border bg-background text-foreground focus:border-primary h-7 min-w-0 flex-1 rounded-md border px-2 text-[11px] outline-none disabled:opacity-50"
                        >
                          {(stagesByPipeline[deal.pipeline_id] ?? []).map(
                            (stage) => (
                              <option key={stage.id} value={stage.id}>
                                {stage.name}
                              </option>
                            )
                          )}
                        </select>
                        {savingDealId === deal.id && (
                          <Loader2 className="text-primary h-3.5 w-3.5 animate-spin" />
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
              {deals.length > 0 && canEditContact && pipelines.length > 0 && (
                <PipelineAssignment
                  pipelines={pipelines}
                  stagesByPipeline={stagesByPipeline}
                  pipelineId={addPipelineId}
                  stageId={addStageId}
                  onPipelineChange={(pipelineId) => {
                    setAddPipelineId(pipelineId);
                    setAddStageId(stagesByPipeline[pipelineId]?.[0]?.id ?? '');
                  }}
                  onStageChange={setAddStageId}
                  onAdd={() => void handleAddToPipeline()}
                  disabled={addingDeal}
                  t={tSidebar}
                />
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Notes */}
          <div>
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
}) {
  const stages = stagesByPipeline[pipelineId] ?? [];
  return (
    <div
      className={cn(
        'border-border rounded-lg border border-dashed p-2',
        disabled && 'opacity-60'
      )}
    >
      <div className="grid gap-1.5">
        <select
          value={pipelineId}
          onChange={(event) => onPipelineChange(event.target.value)}
          disabled={disabled}
          className="border-border bg-muted text-foreground focus:border-primary h-7 w-full rounded-md border px-2 text-[11px] outline-none disabled:cursor-not-allowed"
        >
          {pipelines.map((pipeline) => (
            <option key={pipeline.id} value={pipeline.id}>
              {pipeline.name}
            </option>
          ))}
        </select>
        <select
          value={stageId}
          onChange={(event) => onStageChange(event.target.value)}
          disabled={disabled || stages.length === 0}
          className="border-border bg-muted text-foreground focus:border-primary h-7 w-full rounded-md border px-2 text-[11px] outline-none disabled:cursor-not-allowed"
        >
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          onClick={onAdd}
          disabled={disabled || !pipelineId || !stageId}
          className="bg-primary text-primary-foreground hover:bg-primary/90 h-7 px-2 text-[11px]"
        >
          {disabled ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Plus className="mr-1 h-3 w-3" />
          )}
          {t('addToFunnel')}
        </Button>
      </div>
    </div>
  );
}
