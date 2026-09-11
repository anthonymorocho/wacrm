'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsPanelHead } from './settings-panel-head';
import {
  InteractiveBuilder,
  blankButtonsPayload,
} from '@/components/interactive/interactive-builder';
import {
  interactivePayloadPreviewText,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive';
import {
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
  uploadAccountMedia,
} from '@/lib/storage/upload-media';
import { shouldDeleteQuickReplyMedia } from '@/lib/inbox/quick-reply-media';
import type { QuickReply, QuickReplyKind } from '@/types';

const QUICK_REPLY_MEDIA_BUCKET = 'chat-media';

interface DraftState {
  id?: string;
  title: string;
  kind: QuickReplyKind;
  content_text: string;
  interactive_payload: InteractiveMessagePayload;
  media_url: string | null;
  media_path: string | null;
  media_filename: string | null;
  original_media_path: string | null;
}

function emptyDraft(): DraftState {
  return {
    title: '',
    kind: 'text',
    content_text: '',
    interactive_payload: blankButtonsPayload(),
    media_url: null,
    media_path: null,
    media_filename: null,
    original_media_path: null,
  };
}

export function QuickRepliesManager() {
  const t = useTranslations('Settings.quickReplies');
  const [items, setItems] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<DraftState | null>(null);
  const draftSessionRef = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/quick-replies', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setItems((data.quick_replies as QuickReply[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const openCreate = () => {
    draftSessionRef.current += 1;
    const next = emptyDraft();
    draftRef.current = next;
    setDraft(next);
  };
  const openEdit = (qr: QuickReply) => {
    draftSessionRef.current += 1;
    const next = {
      id: qr.id,
      title: qr.title,
      kind: qr.kind,
      content_text: qr.content_text ?? '',
      interactive_payload: qr.interactive_payload ?? blankButtonsPayload(),
      media_url: qr.media_url ?? null,
      media_path: qr.media_path ?? null,
      media_filename: qr.media_filename ?? null,
      original_media_path: qr.media_path ?? null,
    };
    draftRef.current = next;
    setDraft(next);
  };

  const discardDraft = useCallback(() => {
    const current = draftRef.current;
    draftSessionRef.current += 1;
    draftRef.current = null;
    if (
      current?.media_path &&
      current.media_path !== current.original_media_path
    ) {
      void deleteAccountMedia(QUICK_REPLY_MEDIA_BUCKET, current.media_path).catch(
        () => {}
      );
    }
    setDraft(null);
  }, []);

  // If the settings panel unmounts while a newly uploaded image is still
  // attached to an unsaved draft, release that temporary object. Persisted
  // images are safe because they equal `original_media_path`.
  useEffect(() => {
    return () => {
      draftSessionRef.current += 1;
      const current = draftRef.current;
      if (
        current?.media_path &&
        current.media_path !== current.original_media_path
      ) {
        void deleteAccountMedia(
          QUICK_REPLY_MEDIA_BUCKET,
          current.media_path
        ).catch(() => {});
      }
    };
  }, []);

  const changeKind = useCallback(
    (kind: QuickReplyKind) => {
      if (!draft) return;
      draftSessionRef.current += 1;
      if (
        kind === 'interactive' &&
        draft.media_path &&
        draft.media_path !== draft.original_media_path
      ) {
        void deleteAccountMedia(
          QUICK_REPLY_MEDIA_BUCKET,
          draft.media_path
        ).catch(() => {});
      }
      const next = {
        ...draft,
        kind,
        ...(kind === 'interactive'
          ? { media_url: null, media_path: null, media_filename: null }
          : {}),
      };
      draftRef.current = next;
      setDraft(next);
    },
    [draft]
  );

  const uploadImage = useCallback(
    async (file: File | undefined) => {
      if (!file || !draft) return;
      const draftSession = draftSessionRef.current;
      if (!file.type.startsWith('image/')) {
        toast.error(t('imageUploadError'));
        return;
      }
      if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
        toast.error(t('imageTooLarge'));
        return;
      }

      setUploadingImage(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(
          QUICK_REPLY_MEDIA_BUCKET,
          file
        );
        const current = draftRef.current;
        if (draftSessionRef.current !== draftSession || !current) {
          void deleteAccountMedia(QUICK_REPLY_MEDIA_BUCKET, path).catch(
            () => {}
          );
          return;
        }
        if (
          current.media_path &&
          current.media_path !== current.original_media_path
        ) {
          void deleteAccountMedia(
            QUICK_REPLY_MEDIA_BUCKET,
            current.media_path
          ).catch(() => {});
        }
        const next = {
          ...current,
          media_url: publicUrl,
          media_path: path,
          media_filename: file.name,
        };
        draftRef.current = next;
        setDraft(next);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t('imageUploadError')
        );
      } finally {
        setUploadingImage(false);
      }
    },
    [draft, t]
  );

  const removeImage = useCallback(() => {
    const current = draftRef.current;
    if (!current) return;
    if (
      current.media_path &&
      current.media_path !== current.original_media_path
    ) {
      void deleteAccountMedia(QUICK_REPLY_MEDIA_BUCKET, current.media_path).catch(
        () => {}
      );
    }
    const next = {
      ...current,
      media_url: null,
      media_path: null,
      media_filename: null,
    };
    draftRef.current = next;
    setDraft(next);
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    if (!draft.title.trim()) {
      toast.error(t('nameRequired'));
      return;
    }
    const payload =
      draft.kind === 'interactive'
        ? {
            title: draft.title,
            kind: 'interactive',
            interactive_payload: draft.interactive_payload,
          }
        : {
            title: draft.title,
            kind: 'text',
            content_text: draft.content_text,
            media_url: draft.media_url,
            media_path: draft.media_path,
            media_filename: draft.media_filename,
          };

    setSaving(true);
    try {
      const res = await fetch(
        draft.id ? `/api/quick-replies/${draft.id}` : '/api/quick-replies',
        {
          method: draft.id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('saveError'));
        return;
      }
      const oldMediaPath = draft.original_media_path;
      const mediaPathToDelete = shouldDeleteQuickReplyMedia(
        oldMediaPath ?? undefined,
        draft.media_path ?? undefined
      )
        ? oldMediaPath
        : undefined;
      toast.success(draft.id ? t('updated') : t('created'));
      draftSessionRef.current += 1;
      draftRef.current = null;
      setDraft(null);
      await load();
      if (mediaPathToDelete) {
        void deleteAccountMedia(
          QUICK_REPLY_MEDIA_BUCKET,
          mediaPathToDelete
        ).catch(() => {});
      }
    } catch {
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }, [draft, load, t]);

  const remove = useCallback(
    async (id: string) => {
      if (!window.confirm(t('deleteConfirm'))) return;
      const res = await fetch(`/api/quick-replies/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error(t('deleteError'));
        return;
      }
      const quickReply = items.find((item) => item.id === id);
      await load();
      if (quickReply?.media_path) {
        void deleteAccountMedia(
          QUICK_REPLY_MEDIA_BUCKET,
          quickReply.media_path
        ).catch(() => {});
      }
    },
    [items, load, t]
  );

  return (
    <div>
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <Button onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            {t('new')}
          </Button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <p className="border-border text-muted-foreground rounded-lg border border-dashed py-10 text-center text-sm">
          {t('empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((qr) => (
            <li
              key={qr.id}
              className="border-border bg-card flex items-start gap-3 rounded-lg border p-3"
            >
              {qr.media_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qr.media_url}
                  alt={qr.media_filename || t('image')}
                  className="mt-0.5 h-8 w-8 shrink-0 rounded object-cover"
                />
              ) : qr.kind === 'interactive' ? (
                <Zap className="text-primary mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <MessageSquare className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-sm font-medium">
                  {qr.title}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {qr.kind === 'interactive' && qr.interactive_payload
                    ? interactivePayloadPreviewText(qr.interactive_payload)
                    : qr.content_text}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => openEdit(qr)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(qr.id)}
                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && discardDraft()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? t('edit') : t('create')}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="max-h-[70vh] space-y-3 overflow-y-auto">
              <div>
                <label className="text-muted-foreground mb-1 block text-xs">
                  {t('name')}
                </label>
                <Input
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                  placeholder={t('namePlaceholder')}
                  className="bg-muted text-foreground"
                />
              </div>
              <div className="flex gap-2">
                <KindTab
                  active={draft.kind === 'text'}
                  label={t('text')}
                  onClick={() => changeKind('text')}
                />
                <KindTab
                  active={draft.kind === 'interactive'}
                  label={t('interactive')}
                  onClick={() => changeKind('interactive')}
                />
              </div>
              {draft.kind === 'text' ? (
                <>
                  <Textarea
                    value={draft.content_text}
                    onChange={(e) =>
                      setDraft({ ...draft, content_text: e.target.value })
                    }
                    placeholder={t('textPlaceholder')}
                    className="bg-muted text-foreground min-h-28"
                  />
                  <div className="border-border bg-muted/40 rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-foreground flex items-center gap-2 text-xs font-medium">
                        <ImageIcon className="text-primary h-4 w-4" />
                        {t('image')}
                      </div>
                      {draft.media_url && (
                        <button
                          type="button"
                          onClick={removeImage}
                          className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1"
                          aria-label={t('removeImage')}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    {draft.media_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={draft.media_url}
                        alt={draft.media_filename || t('image')}
                        className="mt-2 max-h-36 rounded-lg object-cover"
                      />
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => imageInputRef.current?.click()}
                        disabled={uploadingImage}
                        className="border-border text-muted-foreground hover:bg-muted hover:text-foreground mt-2 bg-transparent text-xs"
                      >
                        {uploadingImage ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plus className="mr-1 h-3.5 w-3.5" />
                        )}
                        {t('addImage')}
                      </Button>
                    )}
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        void uploadImage(file);
                      }}
                    />
                    <p className="text-muted-foreground mt-2 text-[11px]">
                      {t('imageHint')}
                    </p>
                  </div>
                </>
              ) : (
                <InteractiveBuilder
                  value={draft.interactive_payload}
                  onChange={(p) =>
                    setDraft({ ...draft, interactive_payload: p })
                  }
                />
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={discardDraft}
              disabled={saving || uploadingImage}
            >
              {t('cancel')}
            </Button>
            <Button onClick={save} disabled={saving || uploadingImage}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {saving ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KindTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'border-primary bg-primary/10 text-primary flex-1 rounded-md border px-3 py-1.5 text-sm font-medium'
          : 'border-border bg-muted text-muted-foreground hover:text-foreground flex-1 rounded-md border px-3 py-1.5 text-sm font-medium'
      }
    >
      {label}
    </button>
  );
}
