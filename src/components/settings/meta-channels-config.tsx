'use client';

import { useEffect, useState } from 'react';
import {
  Check,
  Camera,
  Copy,
  Link2,
  Loader2,
  MessageCircle,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import type { MetaChannelProvider } from '@/lib/meta/messaging';
import {
  indexZernioConnections,
  type ZernioPublicConnection,
  type ZernioUiProvider,
} from '@/lib/zernio/client-contract';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsPanelHead } from './settings-panel-head';

interface PublicChannel {
  id: string;
  provider: MetaChannelProvider;
  external_account_id: string;
  display_name: string | null;
  status: 'connected' | 'disconnected';
}

type ZernioProvider = ZernioUiProvider;
const ZERNIO_PROVIDERS: ZernioProvider[] = ['facebook', 'instagram'];

interface ZernioCredentialsForm {
  apiKey: string;
  webhookSecret: string;
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

function emptyZernioCredentials(): ZernioCredentialsForm {
  return { apiKey: '', webhookSecret: '' };
}

function emptyChannels(): Record<MetaChannelProvider, PublicChannel | null> {
  return { instagram: null, messenger: null };
}

export function MetaChannelsConfig() {
  const t = useTranslations('Settings.meta');
  const tz = useTranslations('Settings.zernio');
  const searchParams = useSearchParams();
  const { canEditSettings, profileLoading } = useAuth();
  const [forms, setForms] = useState(emptyForms);
  const [channels, setChannels] = useState(emptyChannels);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<MetaChannelProvider | null>(null);
  const [removing, setRemoving] = useState<MetaChannelProvider | null>(null);
  const [removeTarget, setRemoveTarget] = useState<MetaChannelProvider | null>(
    null
  );
  const [copied, setCopied] = useState(false);
  const [zernio, setZernio] = useState<{
    configured: boolean;
    connections: Record<ZernioProvider, ZernioPublicConnection | null>;
  } | null>(null);
  const [zernioLoading, setZernioLoading] = useState(true);
  const [zernioConnecting, setZernioConnecting] =
    useState<ZernioProvider | null>(null);
  const [zernioSaving, setZernioSaving] = useState(false);
  const [zernioCredentials, setZernioCredentials] = useState(
    emptyZernioCredentials
  );

  useEffect(() => {
    const result = searchParams.get('zernio');
    if (!result) return;
    if (result === 'connected') toast.success(tz('zernioConnectSuccess'));
    else toast.error(tz('zernioConnectFailed'));

    const url = new URL(window.location.href);
    url.searchParams.delete('zernio');
    window.history.replaceState({}, '', url.toString());
  }, [searchParams, t, tz]);

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

  useEffect(() => {
    if (profileLoading) return;
    let cancelled = false;

    (async () => {
      setZernioLoading(true);
      try {
        const response = await fetch('/api/zernio/connection', {
          cache: 'no-store',
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || tz('zernioLoadFailed'));
        if (!cancelled) {
          setZernio({
            configured: body.configured === true,
            connections: indexZernioConnections(body.connections ?? []),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setZernio(null);
          toast.error(
            error instanceof Error ? error.message : tz('zernioLoadFailed')
          );
        }
      } finally {
        if (!cancelled) setZernioLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profileLoading, t, tz]);

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

  function requestRemove(provider: MetaChannelProvider) {
    if (!canEditSettings) return;
    const channel = channels[provider];
    if (!channel) return;
    setRemoveTarget(provider);
  }

  async function remove() {
    if (!canEditSettings || !removeTarget) return;
    const provider = removeTarget;
    const channel = channels[provider];
    if (!channel) {
      setRemoveTarget(null);
      return;
    }

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
      setRemoveTarget(null);
      toast.success(t('removeSuccess'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('removeFailed'));
    } finally {
      setRemoving(null);
    }
  }

  async function connectZernio(provider: ZernioProvider) {
    if (!canEditSettings) return;
    setZernioConnecting(provider);
    try {
      const response = await fetch(`/api/zernio/connect?platform=${provider}`, {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok || typeof body.auth_url !== 'string') {
        throw new Error(body.error || tz('zernioConnectFailed'));
      }
      window.location.assign(body.auth_url);
    } catch (error) {
      setZernioConnecting(null);
      toast.error(
        error instanceof Error ? error.message : tz('zernioConnectFailed')
      );
    }
  }

  async function saveZernioConfig() {
    if (!canEditSettings) return;
    const apiKey = zernioCredentials.apiKey.trim();
    const webhookSecret = zernioCredentials.webhookSecret.trim();
    if (!apiKey || !webhookSecret) {
      toast.error(tz('zernioCredentialsRequired'));
      return;
    }

    setZernioSaving(true);
    try {
      const response = await fetch('/api/zernio/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          webhook_secret: webhookSecret,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || tz('zernioSaveFailed'));
      }

      setZernio((current) => ({
        configured: true,
        connections: current?.connections ?? {
          facebook: null,
          instagram: null,
        },
      }));
      // Do not retain private credentials in React state after saving.
      setZernioCredentials(emptyZernioCredentials());
      toast.success(tz('zernioCredentialsSaved'));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : tz('zernioSaveFailed')
      );
    } finally {
      setZernioSaving(false);
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

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Link2 className="text-primary size-4" />
            {tz('zernioTitle')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {tz('zernioDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm leading-relaxed">
            {tz('zernioCredentialsHint')}
          </p>
          <div className="space-y-2">
            <Label htmlFor="zernio-api-key" className="text-muted-foreground">
              {tz('zernioApiKey')}
            </Label>
            <Input
              id="zernio-api-key"
              type="password"
              value={zernioCredentials.apiKey}
              onChange={(event) =>
                setZernioCredentials((current) => ({
                  ...current,
                  apiKey: event.target.value,
                }))
              }
              disabled={!canEditSettings || zernioSaving}
              placeholder={tz('zernioApiKeyPlaceholder')}
              autoComplete="new-password"
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div className="space-y-2">
            <Label
              htmlFor="zernio-webhook-secret"
              className="text-muted-foreground"
            >
              {tz('zernioWebhookSecret')}
            </Label>
            <Input
              id="zernio-webhook-secret"
              type="password"
              value={zernioCredentials.webhookSecret}
              onChange={(event) =>
                setZernioCredentials((current) => ({
                  ...current,
                  webhookSecret: event.target.value,
                }))
              }
              disabled={!canEditSettings || zernioSaving}
              placeholder={tz('zernioWebhookSecretPlaceholder')}
              autoComplete="new-password"
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void saveZernioConfig()}
            disabled={
              profileLoading ||
              zernioLoading ||
              zernioSaving ||
              !canEditSettings
            }
            className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {zernioSaving ? <Loader2 className="size-4 animate-spin" /> : null}
            {zernioSaving ? tz('zernioSaving') : tz('zernioSaveCredentials')}
          </Button>
          {zernioLoading ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" /> {tz('zernioLoading')}
            </p>
          ) : !zernio?.configured ? (
            <p className="text-muted-foreground text-sm">
              {tz('zernioNotConfigured')}
            </p>
          ) : null}
          <p className="text-muted-foreground text-xs leading-relaxed">
            {tz('zernioSelectorHint')}
          </p>
          {!canEditSettings ? (
            <p className="text-muted-foreground text-xs">{t('adminOnly')}</p>
          ) : null}
          {ZERNIO_PROVIDERS.map((provider) => {
            const connection = zernio?.connections[provider];
            const providerName = tz(
              provider === 'facebook' ? 'zernioFacebook' : 'zernioInstagram'
            );
            return (
              <div
                key={provider}
                className="border-border space-y-2 rounded-lg border p-3"
              >
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-foreground font-medium">
                    {providerName}
                  </span>
                  <span className="text-muted-foreground">
                    {connection?.status === 'connected'
                      ? tz('zernioConnected')
                      : t('disconnected')}
                  </span>
                </div>
                {connection?.display_name ? (
                  <p className="text-muted-foreground text-sm">
                    {connection.display_name}
                  </p>
                ) : null}
                <Button
                  type="button"
                  onClick={() => void connectZernio(provider)}
                  disabled={
                    profileLoading ||
                    zernioLoading ||
                    zernioConnecting !== null ||
                    zernioSaving ||
                    !zernio?.configured ||
                    !canEditSettings
                  }
                >
                  {zernioConnecting === provider ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {zernioConnecting === provider
                    ? tz('zernioConnecting')
                    : tz(connection ? 'zernioReconnect' : 'zernioConnect', {
                        provider: providerName,
                      })}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

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
                      onClick={() => requestRemove(id)}
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

      <Dialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open && removing === null) setRemoveTarget(null);
        }}
      >
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('removeDialogTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {removeTarget
                ? t('removeDialogDescription', {
                    channel: t(removeTarget),
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRemoveTarget(null)}
              disabled={removing !== null}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void remove()}
              disabled={removing !== null || removeTarget === null}
            >
              {removing !== null ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {removing !== null ? t('removing') : t('remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
