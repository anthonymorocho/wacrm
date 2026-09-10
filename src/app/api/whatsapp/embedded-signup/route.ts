import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
} from '@/lib/rate-limit';
import {
  exchangeEmbeddedSignupCode,
  validateEmbeddedSignupMetaData,
  validateEmbeddedSignupPayload,
} from '@/lib/whatsapp/embedded-signup';
import {
  finalizeWhatsAppConfiguration,
  WhatsAppConfigurationError,
} from '@/lib/whatsapp/configure';

function embeddedSignupConfig(): {
  appId: string;
  configId: string;
  appSecret: string;
} | null {
  const appId = process.env.META_APP_ID?.trim();
  const configId = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !configId || !appSecret) return null;
  return { appId, configId, appSecret };
}

// The route only needs the service-role client to perform the global phone
// ownership check inside finalizeWhatsAppConfiguration.
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

/** GET /api/whatsapp/embedded-signup — safe browser configuration only. */
export async function GET() {
  try {
    await requireRole('admin');
  } catch (error) {
    return toErrorResponse(error);
  }

  const config = embeddedSignupConfig();
  if (!config) {
    return NextResponse.json(
      { error: 'WhatsApp Embedded Signup is not configured on this server' },
      { status: 503 }
    );
  }

  return NextResponse.json({
    app_id: config.appId,
    config_id: config.configId,
  });
}

/** POST /api/whatsapp/embedded-signup — exchange and persist a signup. */
export async function POST(request: Request) {
  let context: Awaited<ReturnType<typeof requireRole>>;
  try {
    context = await requireRole('admin');
  } catch (error) {
    return toErrorResponse(error);
  }

  const rate = checkRateLimit(
    `whatsapp-embedded-signup:${context.userId}`,
    RATE_LIMITS.adminAction
  );
  if (!rate.success) return rateLimitResponse(rate);

  const config = embeddedSignupConfig();
  if (!config) {
    return NextResponse.json(
      { error: 'WhatsApp Embedded Signup is not configured on this server' },
      { status: 503 }
    );
  }

  let payload;
  try {
    payload = validateEmbeddedSignupPayload(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Invalid request body',
      },
      { status: 400 }
    );
  }

  let exchanged;
  try {
    exchanged = await exchangeEmbeddedSignupCode({
      code: payload.code,
      appId: config.appId,
      appSecret: config.appSecret,
    });
  } catch (error) {
    const message =
      error instanceof Error &&
      /^Meta (rejected|returned no)/i.test(error.message)
        ? error.message
        : 'Meta rejected the Embedded Signup authorization';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  let selected;
  try {
    selected = await validateEmbeddedSignupMetaData({
      accessToken: exchanged.accessToken,
      wabaId: payload.wabaId,
      phoneNumberId: payload.phoneNumberId,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Meta rejected the selected WhatsApp account';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const finalized = await finalizeWhatsAppConfiguration({
      supabase: context.supabase,
      supabaseAdmin: supabaseAdmin(),
      accountId: context.accountId,
      userId: context.userId,
      phoneNumberId: selected.phoneNumberId,
      wabaId: selected.wabaId,
      accessToken: exchanged.accessToken,
      verifyToken: payload.verifyToken ?? undefined,
      pin: payload.pin,
      tokenExpiresAt: exchanged.tokenExpiresAt?.toISOString() ?? null,
      // The installation-level App Secret remains in META_APP_SECRET and
      // is used by the webhook fallback. It never enters this row or JSON.
      appSecret: undefined,
    });

    if (finalized.registrationError) {
      return NextResponse.json({
        success: false,
        saved: true,
        registered: false,
        registration_error: finalized.registrationError,
        registration_skipped: finalized.registrationSkipped,
        phone_info: finalized.phoneInfo,
        token_expires_at: exchanged.tokenExpiresAt?.toISOString() ?? null,
      });
    }

    return NextResponse.json({
      success: true,
      saved: true,
      registered: finalized.registered,
      registration_skipped: finalized.registrationSkipped,
      phone_info: finalized.phoneInfo,
      token_expires_at: exchanged.tokenExpiresAt?.toISOString() ?? null,
    });
  } catch (error) {
    if (error instanceof WhatsAppConfigurationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    console.error(
      '[whatsapp/embedded-signup] persistence failed:',
      error instanceof Error ? error.message : 'unknown error'
    );
    return NextResponse.json(
      { error: 'Failed to save WhatsApp configuration' },
      { status: 500 }
    );
  }
}
