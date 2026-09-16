import { NextResponse, after } from 'next/server';

import { decrypt } from '@/lib/whatsapp/encryption';
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature';
import { processNormalizedMetaMessage } from '@/lib/meta/inbound';
import { supabaseAdmin } from '@/lib/meta/admin-client';
import {
  parseMetaMessagingPayload,
  validateMetaChannelProvider,
  type MetaChannelProvider,
} from '@/lib/meta/messaging';
import type { MetaChannel } from '@/types';

export const maxDuration = 60;

interface StoredMetaChannel extends MetaChannel {
  access_token: string;
  app_secret: string;
  verify_token: string;
}

const CHANNEL_FIELDS =
  'id, account_id, user_id, provider, external_account_id, display_name, status, access_token, app_secret, verify_token, connected_at, created_at, updated_at';

async function loadChannels(): Promise<StoredMetaChannel[]> {
  const { data, error } = await supabaseAdmin()
    .from('meta_channels')
    .select(CHANNEL_FIELDS);
  if (error) throw error;

  return (data ?? [])
    .filter((row) => {
      const value = row as Record<string, unknown>;
      return (
        typeof value.id === 'string' &&
        typeof value.account_id === 'string' &&
        typeof value.user_id === 'string' &&
        validateMetaChannelProvider(value.provider) !== null &&
        typeof value.external_account_id === 'string' &&
        typeof value.access_token === 'string' &&
        typeof value.app_secret === 'string' &&
        typeof value.verify_token === 'string'
      );
    })
    .map((row) => row as unknown as StoredMetaChannel);
}

function decryptValue(value: string): string | null {
  try {
    const decrypted = decrypt(value);
    return decrypted || null;
  } catch {
    return null;
  }
}

function channelKey(provider: MetaChannelProvider, externalAccountId: string) {
  return `${provider}:${externalAccountId}`;
}

/** GET /api/meta/webhook — Meta's webhook verification handshake. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const challenge = searchParams.get('hub.challenge');
  const verifyToken = searchParams.get('hub.verify_token');

  if (mode !== 'subscribe' || !challenge || !verifyToken) {
    return NextResponse.json(
      { error: 'Missing verification parameters' },
      { status: 400 }
    );
  }

  try {
    const channels = await loadChannels();
    const matched = channels.some((channel) => {
      const configuredToken = decryptValue(channel.verify_token);
      return configuredToken !== null && configuredToken === verifyToken;
    });

    if (!matched) {
      return NextResponse.json(
        { error: 'Verification token mismatch' },
        { status: 403 }
      );
    }

    return new Response(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  } catch (error) {
    console.error('[meta/webhook GET] channel lookup failed:', error);
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}

/** POST /api/meta/webhook — signed inbound Instagram/Messenger events. */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');

  let channels: StoredMetaChannel[];
  try {
    channels = await loadChannels();
  } catch (error) {
    console.error('[meta/webhook POST] channel lookup failed:', error);
    return NextResponse.json(
      { error: 'Unable to verify webhook' },
      { status: 500 }
    );
  }

  // Authenticate the raw bytes before JSON parsing. The exact channel is
  // selected only after parsing, but no event is scheduled unless a secret
  // belonging to this installation authenticated the complete body.
  const authenticated = channels.some((channel) => {
    const appSecret = decryptValue(channel.app_secret);
    return (
      appSecret !== null &&
      verifyMetaWebhookSignature(rawBody, signature, appSecret)
    );
  });
  if (!authenticated) {
    console.warn('[meta/webhook POST] rejected request with invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const normalizedMessages = parseMetaMessagingPayload(payload);
  const channelsByKey = new Map<string, StoredMetaChannel>();
  const secretsByKey = new Map<string, string>();
  for (const channel of channels) {
    const provider = validateMetaChannelProvider(channel.provider);
    const appSecret = decryptValue(channel.app_secret);
    if (!provider || !appSecret) continue;
    const key = channelKey(provider, channel.external_account_id);
    channelsByKey.set(key, channel);
    secretsByKey.set(key, appSecret);
  }

  after(async () => {
    const db = supabaseAdmin();
    for (const message of normalizedMessages) {
      const key = channelKey(message.provider, message.externalAccountId);
      const channel = channelsByKey.get(key);
      const appSecret = secretsByKey.get(key);
      if (!channel || !appSecret) continue;

      // A valid signature for another configured channel must not authorize
      // this entry. This check binds the entry id to its own app secret.
      if (!verifyMetaWebhookSignature(rawBody, signature, appSecret)) continue;

      try {
        await processNormalizedMetaMessage(db, channel, message);
      } catch (error) {
        // The persistence helper is defensive itself; this guard keeps one
        // malformed event from preventing the rest of a Meta batch.
        console.error('[meta/webhook POST] inbound processing failed:', error);
      }
    }
  });

  return NextResponse.json({ status: 'received' }, { status: 200 });
}
