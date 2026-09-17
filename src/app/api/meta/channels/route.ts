import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { encrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/meta/admin-client';
import {
  validateMetaChannelConfig,
  type MetaChannelConfigInput,
} from '@/lib/meta/messaging';

const PUBLIC_CHANNEL_FIELDS =
  'id, provider, external_account_id, display_name, status, connected_at, created_at, updated_at';

function publicChannel(row: Record<string, unknown>) {
  return {
    id: row.id,
    provider: row.provider,
    external_account_id: row.external_account_id,
    display_name: row.display_name ?? null,
    status: row.status,
    connected_at: row.connected_at ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

/** GET /api/meta/channels — list the current account's social channels. */
export async function GET() {
  try {
    const { accountId } = await requireRole('viewer');
    const { data, error } = await supabaseAdmin()
      .from('meta_channels')
      .select(PUBLIC_CHANNEL_FIELDS)
      .eq('account_id', accountId)
      // Rows created before the source discriminator was introduced are
      // direct Meta channels too. Keep them visible so they can be cleaned up
      // from this screen; Zernio rows always carry an explicit `zernio` value.
      .or('integration_source.eq.meta,integration_source.is.null')
      .order('provider', { ascending: true })
      .order('display_name', { ascending: true });

    if (error) {
      console.error('[meta/channels GET] lookup failed:', error.message);
      return NextResponse.json(
        { error: 'Failed to load Meta channel configuration' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      channels: (data ?? []).map((row) => publicChannel(row)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** POST /api/meta/channels — create or replace one social channel. */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin');

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    let config: MetaChannelConfigInput;
    try {
      config = validateMetaChannelConfig(body);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : 'Invalid configuration',
        },
        { status: 400 }
      );
    }

    let encrypted: {
      access_token: string;
      app_secret: string;
      verify_token: string;
    };
    try {
      encrypted = {
        access_token: encrypt(config.access_token),
        app_secret: encrypt(config.app_secret),
        verify_token: encrypt(config.verify_token),
      };
    } catch {
      return NextResponse.json(
        { error: 'Failed to encrypt Meta credentials' },
        { status: 500 }
      );
    }

    const { data, error } = await supabaseAdmin()
      .from('meta_channels')
      .upsert(
        {
          account_id: accountId,
          user_id: userId,
          integration_source: 'meta',
          provider: config.provider,
          external_account_id: config.external_account_id,
          display_name: config.display_name ?? null,
          ...encrypted,
          status: 'connected',
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'account_id,provider,external_account_id' }
      )
      .select(PUBLIC_CHANNEL_FIELDS)
      .single();

    if (error || !data) {
      console.error('[meta/channels POST] persistence failed:', error?.message);
      return NextResponse.json(
        { error: 'Failed to save Meta channel configuration' },
        { status: 500 }
      );
    }

    return NextResponse.json({ channel: publicChannel(data) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** DELETE /api/meta/channels?id=<channel-id> — remove one account channel. */
export async function DELETE(request: Request) {
  try {
    const { accountId } = await requireRole('admin');
    const channelId = new URL(request.url).searchParams.get('id')?.trim();
    if (!channelId) {
      return NextResponse.json(
        { error: 'Channel id is required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin()
      .from('meta_channels')
      .delete()
      .eq('account_id', accountId)
      // Include legacy direct-Meta rows whose source is still NULL, but never
      // allow this route to delete a channel owned by the Zernio flow.
      .or('integration_source.eq.meta,integration_source.is.null')
      .eq('id', channelId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[meta/channels DELETE] removal failed:', error.message);
      return NextResponse.json(
        { error: 'Failed to remove Meta channel configuration' },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: 'Meta channel not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
