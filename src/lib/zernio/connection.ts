import type { SupabaseClient } from '@supabase/supabase-js';

import type { ZernioProvider } from './client';

export interface ZernioConnectionRow {
  id: string;
  account_id: string;
  user_id: string;
  meta_channel_id: string;
  zernio_profile_id: string;
  zernio_account_id: string;
  provider: ZernioProvider;
  external_account_id: string;
  display_name: string | null;
  facebook_page_id: string | null;
  facebook_page_name: string | null;
  status: 'connected' | 'disconnected';
  connected_at: string;
  created_at: string;
  updated_at: string;
}

export class ZernioConnectionConflictError extends Error {
  readonly status = 409 as const;

  constructor(message = 'This Zernio account is already linked elsewhere') {
    super(message);
    this.name = 'ZernioConnectionConflictError';
  }
}

const CONNECTION_FIELDS =
  'id, account_id, user_id, meta_channel_id, zernio_profile_id, zernio_account_id, provider, external_account_id, display_name, facebook_page_id, facebook_page_name, status, connected_at, created_at, updated_at';

async function findByAccount(
  db: SupabaseClient,
  accountId: string,
  provider: ZernioProvider
): Promise<ZernioConnectionRow | null> {
  const { data, error } = await db
    .from('zernio_connections')
    .select(CONNECTION_FIELDS)
    .eq('account_id', accountId)
    .eq('provider', provider)
    .maybeSingle();
  if (error) throw error;
  return (data as ZernioConnectionRow | null) ?? null;
}

async function findByZernioAccount(
  db: SupabaseClient,
  zernioAccountId: string
): Promise<ZernioConnectionRow | null> {
  const { data, error } = await db
    .from('zernio_connections')
    .select(CONNECTION_FIELDS)
    .eq('zernio_account_id', zernioAccountId)
    .maybeSingle();
  if (error) throw error;
  return (data as ZernioConnectionRow | null) ?? null;
}

export async function getZernioConnection(
  db: SupabaseClient,
  accountId: string,
  provider: ZernioProvider = 'messenger'
): Promise<ZernioConnectionRow | null> {
  return findByAccount(db, accountId, provider);
}

export async function getZernioConnections(
  db: SupabaseClient,
  accountId: string
): Promise<ZernioConnectionRow[]> {
  const { data, error } = await db
    .from('zernio_connections')
    .select(CONNECTION_FIELDS)
    .eq('account_id', accountId)
    .order('provider', { ascending: true });
  if (error) throw error;
  return (data as ZernioConnectionRow[] | null) ?? [];
}

export async function getZernioConnectionForChannel(
  db: SupabaseClient,
  accountId: string,
  channelId: string
): Promise<ZernioConnectionRow | null> {
  const { data, error } = await db
    .from('zernio_connections')
    .select(CONNECTION_FIELDS)
    .eq('account_id', accountId)
    .eq('meta_channel_id', channelId)
    .maybeSingle();
  if (error) throw error;
  return (data as ZernioConnectionRow | null) ?? null;
}

/** Persist one provider account while keeping the CRM tenant's other channels. */
export async function saveZernioChannelConnection(
  db: SupabaseClient,
  args: {
    accountId: string;
    userId: string;
    profileId: string;
    zernioAccountId: string;
    provider: ZernioProvider;
    externalAccountId: string;
    displayName: string | null;
  }
): Promise<ZernioConnectionRow> {
  const [existingForProvider, existingForZernioAccount] = await Promise.all([
    findByAccount(db, args.accountId, args.provider),
    findByZernioAccount(db, args.zernioAccountId),
  ]);

  for (const existing of [existingForProvider, existingForZernioAccount]) {
    if (
      existing &&
      (existing.account_id !== args.accountId ||
        existing.zernio_profile_id !== args.profileId ||
        existing.zernio_account_id !== args.zernioAccountId ||
        existing.provider !== args.provider)
    ) {
      throw new ZernioConnectionConflictError();
    }
  }

  const channelPayload = {
    account_id: args.accountId,
    user_id: args.userId,
    integration_source: 'zernio',
    provider: args.provider,
    external_account_id: args.externalAccountId,
    zernio_profile_id: args.profileId,
    zernio_account_id: args.zernioAccountId,
    facebook_page_id:
      args.provider === 'messenger' ? args.externalAccountId : null,
    display_name: args.displayName,
    access_token: null,
    app_secret: null,
    verify_token: null,
    status: 'connected',
    connected_at: new Date().toISOString(),
  };

  let channelId: string;
  const sameExternalAccount =
    existingForProvider?.external_account_id === args.externalAccountId;
  if (existingForProvider && sameExternalAccount) {
    channelId = existingForProvider.meta_channel_id;
    const { data, error } = await db
      .from('meta_channels')
      .update(channelPayload)
      .eq('id', channelId)
      .eq('account_id', args.accountId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Zernio channel was not found');
  } else {
    const { data, error } = await db
      .from('meta_channels')
      .upsert(channelPayload, {
        onConflict: 'account_id,provider,external_account_id',
      })
      .select('id')
      .single();
    if (error || !data) {
      throw error ?? new Error('Zernio channel was not stored');
    }
    channelId = data.id as string;

    // Preserve old threads on the previous channel when a provider account changes.
    if (existingForProvider) {
      const { error: oldChannelError } = await db
        .from('meta_channels')
        .update({
          status: 'disconnected',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingForProvider.meta_channel_id)
        .eq('account_id', args.accountId);
      if (oldChannelError) throw oldChannelError;
    }
  }

  const { data, error } = await db
    .from('zernio_connections')
    .upsert(
      {
        account_id: args.accountId,
        user_id: args.userId,
        meta_channel_id: channelId,
        zernio_profile_id: args.profileId,
        zernio_account_id: args.zernioAccountId,
        provider: args.provider,
        external_account_id: args.externalAccountId,
        display_name: args.displayName,
        facebook_page_id:
          args.provider === 'messenger' ? args.externalAccountId : null,
        facebook_page_name:
          args.provider === 'messenger' ? args.displayName : null,
        status: 'connected',
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,provider' }
    )
    .select(CONNECTION_FIELDS)
    .single();
  if (error || !data) {
    throw error ?? new Error('Zernio connection was not stored');
  }

  return data as ZernioConnectionRow;
}
