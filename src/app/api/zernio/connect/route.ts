import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/meta/admin-client';
import {
  ZernioConfigurationError,
  ensureZernioWebhook,
  getZernioConnectUrl,
} from '@/lib/zernio/client';
import { getZernioCredentials, getZernioProfile } from '@/lib/zernio/profile';
import { publicOrigin } from '@/lib/zernio/public-origin';

/** GET /api/zernio/connect — start Zernio's hosted Facebook Page picker. */
export async function GET(request: Request) {
  try {
    const context = await requireRole('admin');
    const admin = supabaseAdmin();
    const profile = await getZernioProfile(admin, context.accountId);
    const credentials = await getZernioCredentials(admin, context.accountId);
    if (!profile || !credentials) {
      throw new ZernioConfigurationError(
        'Enter your Zernio API key and webhook secret before connecting'
      );
    }

    const origin = publicOrigin(request);
    const webhookUrl = `${origin}/api/zernio/webhook`;

    await ensureZernioWebhook({
      apiKey: credentials.apiKey,
      url: webhookUrl,
      secret: credentials.webhookSecret,
    });
    const authUrl = await getZernioConnectUrl({
      apiKey: credentials.apiKey,
      profileId: profile.zernio_profile_id,
      redirectUrl: `${origin}/api/zernio/callback`,
    });

    return NextResponse.json({ auth_url: authUrl });
  } catch (error) {
    if (error instanceof ZernioConfigurationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    return toErrorResponse(error);
  }
}
