import type { SupabaseClient } from '@supabase/supabase-js';

import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

import { createZernioProfile } from './client';

export interface ZernioProfileRow {
  id?: string;
  account_id: string;
  user_id: string;
  zernio_profile_id: string;
  profile_name: string;
  created_at?: string;
  updated_at?: string;
}

export interface ZernioCredentials {
  apiKey: string;
  webhookSecret: string;
}

export interface ZernioWebhookSecret {
  profileId: string;
  webhookSecret: string;
}

const PROFILE_FIELDS =
  'id, account_id, user_id, zernio_profile_id, profile_name, created_at, updated_at';
const CREDENTIAL_FIELDS = 'api_key_encrypted, webhook_secret_encrypted';
const WEBHOOK_SECRET_FIELDS = 'zernio_profile_id, webhook_secret_encrypted';

async function findStoredProfile(
  db: SupabaseClient,
  accountId: string
): Promise<ZernioProfileRow | null> {
  const { data, error } = await db
    .from('zernio_profiles')
    .select(PROFILE_FIELDS)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  return (data as ZernioProfileRow | null) ?? null;
}

export async function getZernioProfile(
  db: SupabaseClient,
  accountId: string
): Promise<ZernioProfileRow | null> {
  return findStoredProfile(db, accountId);
}

/** Read credentials only on the server; callers must never serialize them. */
export async function getZernioCredentials(
  db: SupabaseClient,
  accountId: string
): Promise<ZernioCredentials | null> {
  const { data, error } = await db
    .from('zernio_profiles')
    .select(CREDENTIAL_FIELDS)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  if (
    !data ||
    typeof data.api_key_encrypted !== 'string' ||
    typeof data.webhook_secret_encrypted !== 'string' ||
    !data.api_key_encrypted ||
    !data.webhook_secret_encrypted
  ) {
    return null;
  }

  return {
    apiKey: decrypt(data.api_key_encrypted),
    webhookSecret: decrypt(data.webhook_secret_encrypted),
  };
}

/** Return only whether both encrypted credentials exist. */
export async function hasZernioCredentials(
  db: SupabaseClient,
  accountId: string
): Promise<boolean> {
  const { data, error } = await db
    .from('zernio_profiles')
    .select(CREDENTIAL_FIELDS)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(
    data &&
    typeof data.api_key_encrypted === 'string' &&
    data.api_key_encrypted &&
    typeof data.webhook_secret_encrypted === 'string' &&
    data.webhook_secret_encrypted
  );
}

/** Resolve all webhook secrets without exposing encrypted values to routes. */
export async function listZernioWebhookSecrets(
  db: SupabaseClient
): Promise<ZernioWebhookSecret[]> {
  const { data, error } = await db
    .from('zernio_profiles')
    .select(WEBHOOK_SECRET_FIELDS);
  if (error) throw error;

  const secrets: ZernioWebhookSecret[] = [];
  for (const row of data ?? []) {
    if (
      typeof row.zernio_profile_id !== 'string' ||
      typeof row.webhook_secret_encrypted !== 'string' ||
      !row.zernio_profile_id ||
      !row.webhook_secret_encrypted
    ) {
      continue;
    }
    try {
      secrets.push({
        profileId: row.zernio_profile_id,
        webhookSecret: decrypt(row.webhook_secret_encrypted),
      });
    } catch {
      // A rotated ENCRYPTION_KEY or corrupt row must not take down all
      // tenants' webhooks. The affected account can re-enter its credentials.
      console.error(
        '[zernio/profile] could not decrypt webhook secret for profile',
        row.zernio_profile_id
      );
    }
  }
  return secrets;
}

/** Store a new pair of account-owned Zernio credentials encrypted at rest. */
export async function saveZernioCredentials(
  db: SupabaseClient,
  args: {
    accountId: string;
    apiKey: string;
    webhookSecret: string;
  }
): Promise<ZernioProfileRow> {
  const { data, error } = await db
    .from('zernio_profiles')
    .update({
      api_key_encrypted: encrypt(args.apiKey),
      webhook_secret_encrypted: encrypt(args.webhookSecret),
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', args.accountId)
    .select(PROFILE_FIELDS)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Zernio profile was not found');
  return data as ZernioProfileRow;
}

/** Return the account's existing Zernio profile or create it exactly once. */
export async function ensureZernioProfile(
  db: SupabaseClient,
  args: {
    accountId: string;
    userId: string;
    accountName: string;
    apiKey: string;
  }
): Promise<ZernioProfileRow> {
  const existing = await findStoredProfile(db, args.accountId);
  if (existing) return existing;

  const profileName = `wacrm-${args.accountId}`;
  const profile = await createZernioProfile({
    apiKey: args.apiKey,
    name: profileName,
    description: args.accountName,
    idempotencyKey: `wacrm-profile-${args.accountId}`,
  });

  const { data, error } = await db
    .from('zernio_profiles')
    .upsert(
      {
        account_id: args.accountId,
        user_id: args.userId,
        zernio_profile_id: profile._id,
        profile_name: profileName,
      },
      { onConflict: 'account_id' }
    )
    .select(PROFILE_FIELDS)
    .single();

  if (!error && data) return data as ZernioProfileRow;

  if (isUniqueViolation(error)) {
    const raced = await findStoredProfile(db, args.accountId);
    if (raced) return raced;
  }

  throw error ?? new Error('Zernio profile was not stored');
}
