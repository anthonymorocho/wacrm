import type { SupabaseClient } from '@supabase/supabase-js';

export interface ZernioConnectionRow {
  id: string;
  account_id: string;
  user_id: string;
  meta_channel_id: string;
  zernio_profile_id: string;
  zernio_account_id: string;
  facebook_page_id: string;
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
  'id, account_id, user_id, meta_channel_id, zernio_profile_id, zernio_account_id, facebook_page_id, facebook_page_name, status, connected_at, created_at, updated_at';

async function findByAccount(
  db: SupabaseClient,
  accountId: string
): Promise<ZernioConnectionRow | null> {
  const { data, error } = await db
    .from('zernio_connections')
    .select(CONNECTION_FIELDS)
    .eq('account_id', accountId)
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
  accountId: string
): Promise<ZernioConnectionRow | null> {
  return findByAccount(db, accountId);
}

/**
 * Persist the selected Facebook Page only after both Zernio identifiers have
 * been checked against the same CRM account. The Meta channel remains the
 * Inbox identity, so the existing contact/conversation pipeline is reused.
 */
export async function saveZernioMessengerConnection(
  db: SupabaseClient,
  args: {
    accountId: string;
    userId: string;
    profileId: string;
    zernioAccountId: string;
    facebookPageId: string;
    facebookPageName: string | null;
  }
): Promise<ZernioConnectionRow> {
  const [existingForAccount, existingForZernioAccount] = await Promise.all([
    findByAccount(db, args.accountId),
    findByZernioAccount(db, args.zernioAccountId),
  ]);

  for (const existing of [existingForAccount, existingForZernioAccount]) {
    if (
      existing &&
      (existing.account_id !== args.accountId ||
        existing.zernio_profile_id !== args.profileId ||
        existing.zernio_account_id !== args.zernioAccountId)
    ) {
      throw new ZernioConnectionConflictError();
    }
  }

  const displayName = args.facebookPageName || 'Facebook Messenger';
  const channelPayload = {
    account_id: args.accountId,
    user_id: args.userId,
    integration_source: 'zernio',
    provider: 'messenger',
    external_account_id: args.facebookPageId,
    zernio_profile_id: args.profileId,
    zernio_account_id: args.zernioAccountId,
    facebook_page_id: args.facebookPageId,
    display_name: displayName,
    access_token: null,
    app_secret: null,
    verify_token: null,
    status: 'connected',
    connected_at: new Date().toISOString(),
  };

  let channelId: string | null = null;
  const samePage = existingForAccount?.facebook_page_id === args.facebookPageId;
  if (existingForAccount && samePage) {
    channelId = existingForAccount.meta_channel_id;
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

    // A page change gets a new Inbox channel. Keeping the old channel row
    // preserves historical message attribution instead of relabelling old
    // conversations as belonging to the newly selected Page.
    if (existingForAccount) {
      const { error: oldChannelError } = await db
        .from('meta_channels')
        .update({
          status: 'disconnected',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingForAccount.meta_channel_id)
        .eq('account_id', args.accountId);
      if (oldChannelError) throw oldChannelError;
    }
  }

  const connectionPayload = {
    account_id: args.accountId,
    user_id: args.userId,
    meta_channel_id: channelId,
    zernio_profile_id: args.profileId,
    zernio_account_id: args.zernioAccountId,
    facebook_page_id: args.facebookPageId,
    facebook_page_name: args.facebookPageName,
    status: 'connected',
    connected_at: new Date().toISOString(),
  };
  const { data, error } = await db
    .from('zernio_connections')
    .upsert(connectionPayload, { onConflict: 'account_id' })
    .select(CONNECTION_FIELDS)
    .single();
  if (error || !data) {
    throw error ?? new Error('Zernio connection was not stored');
  }

  return data as ZernioConnectionRow;
}
