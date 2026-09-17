'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { THEMES } from '@/lib/themes';
import { CURRENCIES } from '@/lib/currency';
import type { MetaChannelProvider } from '@/lib/meta/messaging';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { SECTION_META, type SettingsSection } from './settings-sections';
import { SettingsChip, StatusDot } from './settings-chip';
import { ROLE_META } from './role-meta';

interface OverviewCounts {
  members: number | null;
  pendingInvites: number | null;
  templates: number | null;
  templatesPending: number | null;
  tags: number | null;
  customFields: number | null;
}

interface WhatsAppStatus {
  configured: boolean;
  connected: boolean;
}

interface SocialChannelStatus {
  configured: boolean;
  connected: boolean;
}

type SocialChannelStatuses = Record<MetaChannelProvider, SocialChannelStatus>;

function emptySocialChannelStatuses(): SocialChannelStatuses {
  return {
    instagram: { configured: false, connected: false },
    messenger: { configured: false, connected: false },
  };
}

export function SettingsOverview({
  onSelect,
}: {
  onSelect: (section: SettingsSection) => void;
}) {
  const {
    user,
    profile,
    accountId,
    accountRole,
    defaultCurrency,
    canManageMembers,
  } = useAuth();
  const { mode, theme } = useTheme();
  const t = useTranslations('Settings.overview');
  const tRoles = useTranslations('Settings.roles');
  const tSections = useTranslations('Settings.sections');

  const [counts, setCounts] = useState<OverviewCounts | null>(null);
  const [countsLoading, setCountsLoading] = useState(true);
  // WhatsApp status is tracked separately: its health check decrypts the
  // token and pings Meta, which is far slower than the cheap count
  // queries. Gating it independently keeps a slow/flaky Meta round-trip
  // from blanking the rest of the landing.
  const [whatsapp, setWhatsapp] = useState<WhatsAppStatus | null>(null);
  const [whatsappLoading, setWhatsappLoading] = useState(true);
  const [socialChannels, setSocialChannels] =
    useState<SocialChannelStatuses | null>(null);
  const [socialChannelsLoading, setSocialChannelsLoading] = useState(true);

  useEffect(() => {
    if (!user || !accountId) return;
    let cancelled = false;
    const supabase = createClient();
    const userId = user.id;
    const acctId = accountId;

    // Cheap counts — resolve fast, render immediately.
    (async () => {
      setCountsLoading(true);
      const [
        membersRes,
        invitesRes,
        templatesTotal,
        templatesPending,
        tagsRes,
        fieldsRes,
      ] = await Promise.allSettled([
        fetch('/api/account/members', { cache: 'no-store' }).then((r) =>
          r.json()
        ),
        canManageMembers
          ? fetch('/api/account/invitations', { cache: 'no-store' }).then((r) =>
              r.json()
            )
          : Promise.resolve(null),
        supabase
          .from('message_templates')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId),
        supabase
          .from('message_templates')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'PENDING'),
        supabase
          .from('tags')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId),
        supabase
          .from('custom_fields')
          .select('id', { count: 'exact', head: true }),
      ]);

      if (cancelled) return;

      const members =
        membersRes.status === 'fulfilled' &&
        Array.isArray(membersRes.value?.members)
          ? membersRes.value.members.length
          : null;
      const pendingInvites =
        invitesRes.status === 'fulfilled' &&
        invitesRes.value &&
        Array.isArray(invitesRes.value.invitations)
          ? invitesRes.value.invitations.length
          : null;

      setCounts({
        members,
        pendingInvites,
        templates:
          templatesTotal.status === 'fulfilled'
            ? (templatesTotal.value.count ?? null)
            : null,
        templatesPending:
          templatesPending.status === 'fulfilled'
            ? (templatesPending.value.count ?? null)
            : null,
        tags:
          tagsRes.status === 'fulfilled' ? (tagsRes.value.count ?? null) : null,
        customFields:
          fieldsRes.status === 'fulfilled'
            ? (fieldsRes.value.count ?? null)
            : null,
      });
      setCountsLoading(false);
    })();

    // WhatsApp connection status — slower, independent.
    (async () => {
      setWhatsappLoading(true);
      const [row, health] = await Promise.allSettled([
        supabase
          .from('whatsapp_config')
          .select('phone_number_id')
          .eq('account_id', acctId)
          .maybeSingle(),
        fetch('/api/whatsapp/config', { cache: 'no-store' }).then((r) =>
          r.json()
        ),
      ]);
      if (cancelled) return;
      setWhatsapp({
        configured:
          row.status === 'fulfilled' && !!row.value.data?.phone_number_id,
        connected: health.status === 'fulfilled' && !!health.value?.connected,
      });
      setWhatsappLoading(false);
    })();

    // Instagram and Messenger use their own account-scoped configuration.
    // Keep this request independent from WhatsApp so a social channel cannot
    // delay or change the existing WhatsApp status tile.
    (async () => {
      setSocialChannelsLoading(true);
      const [metaResult, zernioResult] = await Promise.allSettled([
        fetch('/api/meta/channels', { cache: 'no-store' }).then(
          async (response) => ({
            ok: response.ok,
            body: (await response.json()) as unknown,
          })
        ),
        fetch('/api/zernio/connection', { cache: 'no-store' }).then(
          async (response) => ({
            ok: response.ok,
            body: (await response.json()) as unknown,
          })
        ),
      ]);
      if (cancelled) return;

      const next = emptySocialChannelStatuses();
      if (metaResult.status === 'fulfilled' && metaResult.value.ok) {
        const body = metaResult.value.body;
        const bodyRecord =
          body && typeof body === 'object' && !Array.isArray(body)
            ? (body as { channels?: unknown })
            : null;
        const channels = Array.isArray(bodyRecord?.channels)
          ? bodyRecord.channels
          : [];

        for (const rawChannel of channels) {
          const channel =
            rawChannel &&
            typeof rawChannel === 'object' &&
            !Array.isArray(rawChannel)
              ? (rawChannel as { provider?: unknown; status?: unknown })
              : null;
          if (
            channel?.provider !== 'instagram' &&
            channel?.provider !== 'messenger'
          ) {
            continue;
          }
          next[channel.provider] = {
            configured: true,
            connected: channel.status === 'connected',
          };
        }
      }

      if (zernioResult.status === 'fulfilled' && zernioResult.value.ok) {
        const body = zernioResult.value.body;
        const connection =
          body && typeof body === 'object' && !Array.isArray(body)
            ? (body as { connection?: { status?: unknown } | null }).connection
            : null;
        if (connection) {
          next.messenger = {
            configured: true,
            connected: connection.status === 'connected',
          };
        }
      }

      setSocialChannels(next);
      setSocialChannelsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, accountId, canManageMembers]);

  const displayName = profile?.full_name || profile?.email || t('yourAccount');
  const initial = (profile?.full_name || profile?.email || 'U')
    .charAt(0)
    .toUpperCase();
  const roleMeta = accountRole ? ROLE_META[accountRole] : null;
  const RoleIcon = roleMeta?.icon;

  const currencyLabel =
    CURRENCIES.find((c) => c.code === defaultCurrency)?.label ??
    defaultCurrency;
  const themeName = THEMES.find((t) => t.id === theme)?.name ?? theme;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  // Per-tile loading + subtitle. `null` counts render as a graceful
  // fallback so a single failed query never blanks a tile.
  const tiles: {
    section: SettingsSection;
    title?: ReactNode;
    loading: boolean;
    subtitle: ReactNode;
  }[] = [
    {
      section: 'whatsapp',
      loading: whatsappLoading,
      subtitle: !whatsapp?.configured ? (
        t('notSetup')
      ) : whatsapp.connected ? (
        <>
          <StatusDot tone="ok" /> {t('connected')}
        </>
      ) : (
        <>
          <StatusDot tone="muted" /> {t('needsReconnecting')}
        </>
      ),
    },
    {
      section: 'meta',
      title: t('instagram'),
      loading: socialChannelsLoading,
      subtitle: !socialChannels?.instagram.configured ? (
        t('notSetup')
      ) : socialChannels.instagram.connected ? (
        <>
          <StatusDot tone="ok" /> {t('connected')}
        </>
      ) : (
        <>
          <StatusDot tone="muted" /> {t('needsReconnecting')}
        </>
      ),
    },
    {
      section: 'meta',
      title: t('messenger'),
      loading: socialChannelsLoading,
      subtitle: !socialChannels?.messenger.configured ? (
        t('notSetup')
      ) : socialChannels.messenger.connected ? (
        <>
          <StatusDot tone="ok" /> {t('connected')}
        </>
      ) : (
        <>
          <StatusDot tone="muted" /> {t('needsReconnecting')}
        </>
      ),
    },
    {
      section: 'members',
      loading: countsLoading,
      subtitle:
        counts?.members == null
          ? t('viewTeamMembers')
          : `${t('membersCount', { count: counts.members })}${
              counts.pendingInvites
                ? ` · ${t('pendingInvites', { count: counts.pendingInvites })}`
                : ''
            }`,
    },
    {
      section: 'routing',
      loading: false,
      subtitle: 'Automatic assignment capacity',
    },
    {
      section: 'templates',
      loading: countsLoading,
      subtitle:
        counts?.templates == null
          ? t('manageTemplates')
          : `${t('templatesCount', { count: counts.templates })}${
              counts.templatesPending
                ? ` · ${t('pendingReview', { count: counts.templatesPending })}`
                : ''
            }`,
    },
    {
      section: 'deals',
      loading: false,
      subtitle: `${defaultCurrency} — ${currencyLabel}`,
    },
    {
      section: 'fields',
      loading: countsLoading,
      subtitle:
        counts?.tags == null && counts?.customFields == null
          ? t('tagsAndFields')
          : `${t('tagsCount', { count: counts?.tags ?? 0 })} · ${t(
              'fieldsCount',
              { count: counts?.customFields ?? 0 }
            )}`,
    },
    {
      section: 'appearance',
      loading: false,
      subtitle: t('appearance', { mode: cap(mode), theme: themeName }),
    },
  ];

  return (
    <section className="animate-in fade-in-50 duration-200">
      {/* Identity */}
      <Card className="flex-row items-center gap-4 px-5 py-5">
        <Avatar size="lg" className="size-14">
          {profile?.avatar_url ? (
            <AvatarImage src={profile.avatar_url} alt={displayName} />
          ) : null}
          <AvatarFallback className="bg-primary/10 text-primary text-xl">
            {initial}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="text-foreground truncate text-base font-semibold">
            {displayName}
          </div>
          {profile?.email ? (
            <div className="text-muted-foreground truncate text-sm">
              {profile.email}
            </div>
          ) : null}
        </div>
        {roleMeta && RoleIcon ? (
          <SettingsChip variant={roleMeta.variant}>
            <RoleIcon />
            {tRoles(accountRole!)}
          </SettingsChip>
        ) : null}
      </Card>

      {/* Status tiles */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map(({ section, title, loading, subtitle }, index) => {
          const meta = SECTION_META[section];
          const Icon = meta.icon;
          return (
            <button
              key={`${section}-${index}`}
              type="button"
              onClick={() => onSelect(section)}
              className={cn(
                'group border-border bg-card flex items-start gap-3.5 rounded-xl border p-4 text-left transition-colors',
                'hover:border-primary-soft-2 hover:bg-card-2'
              )}
            >
              <span className="bg-primary-soft text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground block text-sm font-semibold">
                  {title ?? tSections(section)}
                </span>
                <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                  {loading ? (
                    <>
                      <Loader2 className="size-3 animate-spin" /> {t('loading')}
                    </>
                  ) : (
                    subtitle
                  )}
                </span>
              </span>
              <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
