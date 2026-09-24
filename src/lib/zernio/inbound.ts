import type { SupabaseClient } from '@supabase/supabase-js';

import { processNormalizedMetaMessage } from '@/lib/meta/inbound';
import type { MetaChannel } from '@/types';

import { supabaseAdmin } from '@/lib/meta/admin-client';

import { parseZernioMessage } from './messaging';
import { persistZernioCommentEvent, parseZernioCommentEvent } from './comments';

interface ZernioAccountRef {
  accountId: string;
  profileId: string;
}

interface ZernioConnectionRow {
  account_id: string;
  meta_channel_id: string;
  provider: 'messenger' | 'instagram';
  status: 'connected' | 'disconnected';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readAccountRef(payload: unknown): ZernioAccountRef | null {
  if (!isRecord(payload) || !isRecord(payload.account)) return null;
  const accountId = payload.account.accountId ?? payload.account.id;
  const profileId = payload.account.profileId;
  if (typeof accountId !== 'string' || typeof profileId !== 'string') {
    return null;
  }
  if (!accountId.trim() || !profileId.trim()) return null;
  return { accountId: accountId.trim(), profileId: profileId.trim() };
}

async function findConnection(
  db: SupabaseClient,
  account: ZernioAccountRef
): Promise<ZernioConnectionRow | null> {
  const { data, error } = await db
    .from('zernio_connections')
    .select('account_id, meta_channel_id, provider, status')
    .eq('zernio_account_id', account.accountId)
    .eq('zernio_profile_id', account.profileId)
    .maybeSingle();
  if (error) throw error;
  return (data as ZernioConnectionRow | null) ?? null;
}

async function markDisconnected(
  db: SupabaseClient,
  connection: ZernioConnectionRow
): Promise<void> {
  const { error: connectionError } = await db
    .from('zernio_connections')
    .update({ status: 'disconnected', updated_at: new Date().toISOString() })
    .eq('account_id', connection.account_id)
    .eq('meta_channel_id', connection.meta_channel_id);
  if (connectionError) throw connectionError;

  const { error: channelError } = await db
    .from('meta_channels')
    .update({ status: 'disconnected', updated_at: new Date().toISOString() })
    .eq('id', connection.meta_channel_id)
    .eq('account_id', connection.account_id);
  if (channelError) throw channelError;
}

/** Process a persisted Zernio webhook event using the shared CRM pipeline. */
export async function processZernioEvent(
  payload: unknown
): Promise<'inserted' | 'duplicate' | 'ignored' | 'disconnected' | 'failed'> {
  const account = readAccountRef(payload);
  if (!account) return 'ignored';

  const db = supabaseAdmin();
  const connection = await findConnection(db, account);
  if (!connection) return 'ignored';

  if (isRecord(payload) && payload.event === 'account.disconnected') {
    await markDisconnected(db, connection);
    return 'disconnected';
  }

  if (isRecord(payload) && payload.event === 'comment.received') {
    const comment = parseZernioCommentEvent(payload);
    if (
      !comment ||
      connection.status !== 'connected' ||
      comment.platform !==
        (connection.provider === 'instagram' ? 'instagram' : 'facebook')
    )
      return 'ignored';
    await persistZernioCommentEvent(db, {
      accountId: connection.account_id,
      zernioAccountId: account.accountId,
      metaChannelId: connection.meta_channel_id,
      event: comment,
    });
    return 'inserted';
  }

  const message = parseZernioMessage(payload);
  if (
    !message ||
    connection.status !== 'connected' ||
    message.provider !== connection.provider
  )
    return 'ignored';

  const { data: channel, error } = await db
    .from('meta_channels')
    .select(
      'id, account_id, user_id, provider, integration_source, external_account_id, display_name, status, connected_at, created_at, updated_at'
    )
    .eq('id', connection.meta_channel_id)
    .eq('account_id', connection.account_id)
    .maybeSingle();
  if (error) throw error;
  if (
    !channel ||
    channel.provider !== message.provider ||
    channel.integration_source !== 'zernio'
  )
    return 'ignored';

  return processNormalizedMetaMessage(db, channel as MetaChannel, message);
}
