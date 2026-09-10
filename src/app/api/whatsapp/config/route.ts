import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  finalizeWhatsAppConfiguration,
  WhatsAppConfigurationError,
} from '@/lib/whatsapp/configure';

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data?.account_id) return null;
  return data.account_id as string;
}

// Lazy service-role client. RLS hides other accounts from the caller, but
// phone ownership must be global to this CRM installation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

/** GET /api/whatsapp/config — health check for the current account. */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_account',
          message: 'Your profile is not linked to an account.',
        },
        { status: 200 }
      );
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select(
        'phone_number_id, access_token, status, app_secret, token_expires_at'
      )
      .eq('account_id', accountId)
      .maybeSingle();

    if (configError) {
      console.error('[whatsapp/config GET] configuration lookup failed');
      return NextResponse.json(
        {
          connected: false,
          reason: 'db_error',
          message: 'Failed to fetch configuration',
        },
        { status: 200 }
      );
    }

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message:
            'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
        },
        { status: 200 }
      );
    }

    let accessToken: string;
    try {
      accessToken = decrypt(config.access_token);
    } catch {
      console.error('[whatsapp/config GET] token decryption failed');
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          app_secret_configured: Boolean(config.app_secret),
          message:
            'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. Click "Reset Configuration", then reconnect.',
        },
        { status: 200 }
      );
    }

    const tokenExpiresAt = config.token_expires_at ?? null;
    if (tokenExpiresAt && new Date(tokenExpiresAt).getTime() <= Date.now()) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_expired',
          token_expires_at: tokenExpiresAt,
          app_secret_configured: Boolean(config.app_secret),
          message:
            'The Meta access token has expired. Reconnect this WhatsApp account through Embedded Signup.',
        },
        { status: 200 }
      );
    }

    try {
      const phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
      });
      return NextResponse.json({
        connected: true,
        phone_info: phoneInfo,
        app_secret_configured: Boolean(config.app_secret),
        token_expires_at: tokenExpiresAt,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown Meta API error';
      console.error(
        '[whatsapp/config GET] Meta API verification failed:',
        message
      );
      return NextResponse.json(
        {
          connected: false,
          reason: 'meta_api_error',
          app_secret_configured: Boolean(config.app_secret),
          token_expires_at: tokenExpiresAt,
          message: `Meta API rejected the credentials: ${message}`,
        },
        { status: 200 }
      );
    }
  } catch {
    console.error('[whatsapp/config GET] unexpected error');
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    );
  }
}

/** POST /api/whatsapp/config — preserves the original manual setup path. */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      phone_number_id,
      waba_id,
      access_token,
      app_secret,
      verify_token,
      pin,
    } = body;

    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id, app_secret')
      .eq('account_id', accountId)
      .maybeSingle();

    if (!access_token || !phone_number_id) {
      return NextResponse.json(
        { error: 'access_token and phone_number_id are required' },
        { status: 400 }
      );
    }

    const appSecretProvided =
      typeof app_secret === 'string' && app_secret.trim().length > 0;
    if (!existing && !appSecretProvided) {
      return NextResponse.json(
        { error: 'app_secret is required for initial setup' },
        { status: 400 }
      );
    }

    if (pin !== undefined && pin !== null && pin !== '') {
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
        return NextResponse.json(
          { error: 'PIN must be exactly 6 digits.' },
          { status: 400 }
        );
      }
    }

    let finalized;
    try {
      finalized = await finalizeWhatsAppConfiguration({
        supabase,
        supabaseAdmin: supabaseAdmin(),
        accountId,
        userId: user.id,
        phoneNumberId: phone_number_id,
        wabaId: waba_id || null,
        accessToken: access_token,
        verifyToken: verify_token,
        pin: pin || null,
        // A manually supplied token has no reliable expiry metadata.
        tokenExpiresAt: null,
        appSecret: appSecretProvided ? app_secret.trim() : undefined,
      });
    } catch (error) {
      if (error instanceof WhatsAppConfigurationError) {
        return NextResponse.json(
          { error: error.message },
          { status: error.status }
        );
      }
      throw error;
    }

    if (finalized.registrationError) {
      return NextResponse.json({
        success: false,
        saved: true,
        registered: false,
        registration_error: finalized.registrationError,
        phone_info: finalized.phoneInfo,
      });
    }

    return NextResponse.json({
      success: true,
      saved: true,
      registered: finalized.registered,
      registration_skipped: finalized.registrationSkipped,
      phone_info: finalized.phoneInfo,
    });
  } catch {
    console.error('[whatsapp/config POST] unexpected error');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/** DELETE /api/whatsapp/config — removes the current account's config. */
export async function DELETE() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      );
    }

    const { error: deleteError } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('account_id', accountId);

    if (deleteError) {
      console.error('[whatsapp/config DELETE] deletion failed');
      return NextResponse.json(
        { error: 'Failed to delete configuration' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    console.error('[whatsapp/config DELETE] unexpected error');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
