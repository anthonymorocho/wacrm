'use client';

import { useEffect, useState } from 'react';
import {
  Check,
  Camera,
  Copy,
  Loader2,
  MessageCircle,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import type { MetaChannelProvider } from '@/lib/meta/messaging';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsPanelHead } from './settings-panel-head';

interface PublicChannel {
  id: string;
  provider: MetaChannelProvider;
  external_account_id: string;
  display_name: string | null;
  status: 'connected' | 'disconnected';
}

interface ChannelForm {
  externalAccountId: string;
  displayName: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
}

const PROVIDERS: {
  id: MetaChannelProvider;
  icon: typeof MessageCircle;
}[] = [
  { id: 'instagram', icon: Camera },
  { id: 'messenger', icon: MessageCircle },
];

function emptyForm(): ChannelForm {
  return {
    externalAccountId: '',
    displayName: '',
    accessToken: '',
    appSecret: '',
    verifyToken: '',
  };
}

function emptyForms(): Record<MetaChannelProvider, ChannelForm> {
  return { instagram: emptyForm(), messenger: emptyForm() };
}

function emptyChannels(): Record<MetaChannelProvider, PublicChannel | null> {
  return { instagram: null, messenger: null };
}

export function MetaChannelsConfig() {
  const t = useTranslations('Settings.meta');
  const { canEditSettings, profileLoading } = useAuth();
  const [forms, setForms] = useState(emptyForms);
  const [channels, setChannels] = useState(emptyChannels);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<MetaChannelProvider | null>(null);
  const [removing, setRemoving] = useState<MetaChannelProvider | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (profileLoading) return;
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch('/api/meta/channels', {
          cache: 'no-store',
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || t('loadFailed'));

        const nextChannels = emptyChannels();
        const nextForms = emptyForms();
        for (const channel of body.channels ?? []) {
          if (
            channel.provider !== 'instagram' &&
            channel.provider !== 'messenger'
          ) {
            continue;
          }
          const provider = channel.provider as MetaChannelProvider;
          nextChannels[provider] = channel as PublicChannel;
          nextForms[provider] = {
            ...nextForms[provider],
            externalAccountId: channel.external_account_id ?? '',
            displayName: channel.display_name ?? '',
          };
        }
        if (!cancelled) {
          setChannels(nextChannels);
          setForms(nextForms);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : t('loadFailed'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profileLoading, t]);

  function updateForm(
    provider: MetaChannelProvider,
    patch: Partial<ChannelForm>
  ) {
    setForms((current) => ({
      ...current,
      [provider]: { ...current[provider], ...patch },
    }));
  }

  async function save(provider: MetaChannelProvider) {
    if (!canEditSettings) return;
    const form = forms[provider];
    if (
      !form.externalAccountId.trim() ||
      !form.accessToken.trim() ||
      !form.appSecret.trim() ||
      !form.verifyToken.trim()
    ) {
      toast.error(t('allFieldsRequired'));
      return;
    }

    setSaving(provider);
    try {
      const response = await fetch('/api/meta/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          external_account_id: form.externalAccountId.trim(),
          display_name: form.displayName.trim() || undefined,
          access_token: form.accessToken,
          app_secret: form.appSecret,
          verify_token: form.verifyToken,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t('saveFailed'));

      setChannels((current) => ({ ...current, [provider]: body.channel }));
      // Never keep credentials in component state after a successful save.
      updateForm(provider, {
        accessToken: '',
        appSecret: '',
        verifyToken: '',
      });
      toast.success(t('saveSuccess'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('saveFailed'));
    } finally {
      setSaving(null);
    }
  }

  async function remove(provider: MetaChannelProvider) {
    if (!canEditSettings) return;
    const channel = channels[provider];
    if (!channel || !window.confirm(t('removeConfirm'))) return;

    setRemoving(provider);
    try {
      const response = await fetch(
        `/api/meta/channels?id=${encodeURIComponent(channel.id)}`,
        {
          method: 'DELETE',
        }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t('removeFailed'));

      setChannels((current) => ({ ...current, [provider]: null }));
      updateForm(provider, emptyForm());
      toast.success(t('removeSuccess'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('removeFailed'));
    } finally {
      setRemoving(null);
    }
  }

  async function copyWebhook() {
    const url = `${window.location.origin}/api/meta/webhook`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  const webhookUrl =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}/api/meta/webhook`;

  return (
    <section className="animate-in fade-in-50 max-w-3xl duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <MessageCircle className="text-primary size-4" />
            {t('webhookTitle')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('webhookDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="meta-webhook-url" className="text-muted-foreground">
            {t('webhookUrl')}
          </Label>
          <div className="flex gap-2">
            <Input
              id="meta-webhook-url"
              readOnly
              value={webhookUrl}
              className="bg-muted border-border text-muted-foreground font-mono text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => void copyWebhook()}
              aria-label={t('copyWebhook')}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground shrink-0"
            >
              {copied ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {PROVIDERS.map(({ id, icon: Icon }) => {
          const form = forms[id];
          const channel = channels[id];
          const busy = saving === id || removing === id;
          const disabled =
            loading || profileLoading || !canEditSettings || busy;
          return (
            <Card key={id}>
              <CardHeader>
                <CardTitle className="text-foreground flex items-center gap-2">
                  <Icon className="text-primary size-4" />
                  {t(id)}
                  {channel ? (
                    <span className="text-primary ml-auto text-xs font-normal">
                      {channel.status === 'connected'
                        ? t('configured')
                        : t('disconnected')}
                    </span>
                  ) : null}
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                  {t(`${id}Description`)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label
                    htmlFor={`${id}-account-id`}
                    className="text-muted-foreground"
                  >
                    {t('externalAccountId')}
                  </Label>
                  <Input
                    id={`${id}-account-id`}
                    value={form.externalAccountId}
                    onChange={(event) =>
                      updateForm(id, { externalAccountId: event.target.value })
                    }
                    disabled={disabled}
                    placeholder={t('externalAccountIdPlaceholder')}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <Label
                    htmlFor={`${id}-display-name`}
                    className="text-muted-foreground"
                  >
                    {t('displayName')}
                  </Label>
                  <Input
                    id={`${id}-display-name`}
                    value={form.displayName}
                    onChange={(event) =>
                      updateForm(id, { displayName: event.target.value })
                    }
                    disabled={disabled}
                    placeholder={t('displayNamePlaceholder')}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <Label
                    htmlFor={`${id}-access-token`}
                    className="text-muted-foreground"
                  >
                    {t('accessToken')}
                  </Label>
                  <Input
                    id={`${id}-access-token`}
                    type="password"
                    value={form.accessToken}
                    onChange={(event) =>
                      updateForm(id, { accessToken: event.target.value })
                    }
                    disabled={disabled}
                    placeholder={t('accessTokenPlaceholder')}
                    autoComplete="new-password"
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <Label
                    htmlFor={`${id}-app-secret`}
                    className="text-muted-foreground"
                  >
                    {t('appSecret')}
                  </Label>
                  <Input
                    id={`${id}-app-secret`}
                    type="password"
                    value={form.appSecret}
                    onChange={(event) =>
                      updateForm(id, { appSecret: event.target.value })
                    }
                    disabled={disabled}
                    placeholder={t('appSecretPlaceholder')}
                    autoComplete="new-password"
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <Label
                    htmlFor={`${id}-verify-token`}
                    className="text-muted-foreground"
                  >
                    {t('verifyToken')}
                  </Label>
                  <Input
                    id={`${id}-verify-token`}
                    type="password"
                    value={form.verifyToken}
                    onChange={(event) =>
                      updateForm(id, { verifyToken: event.target.value })
                    }
                    disabled={disabled}
                    placeholder={t('verifyTokenPlaceholder')}
                    autoComplete="new-password"
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {t('credentialsHint')}
                </p>
                {!canEditSettings ? (
                  <p className="text-muted-foreground text-xs">
                    {t('adminOnly')}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => void save(id)}
                    disabled={disabled}
                  >
                    {saving === id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    {saving === id ? t('saving') : t('save')}
                  </Button>
                  {channel ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void remove(id)}
                      disabled={disabled}
                      className="border-red-900 text-red-400 hover:bg-red-950/40 hover:text-red-300"
                    >
                      {removing === id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                      {removing === id ? t('removing') : t('remove')}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
