import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/meta/admin-client';
import {
  ZernioConnectionConflictError,
  saveZernioChannelConnection,
} from '@/lib/zernio/connection';
import {
  getFacebookPageSelection,
  listZernioAccounts,
  type ZernioProvider,
} from '@/lib/zernio/client';
import { getZernioCredentials, getZernioProfile } from '@/lib/zernio/profile';
import { publicOrigin } from '@/lib/zernio/public-origin';

function settingsRedirect(request: Request, result: 'connected' | 'error') {
  const url = new URL('/settings', publicOrigin(request));
  url.searchParams.set('tab', 'meta');
  url.searchParams.set('zernio', result);
  return NextResponse.redirect(url);
}

/** GET /api/zernio/callback — finalize Zernio's hosted Page selection. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.get('error')) return settingsRedirect(request, 'error');
  const connectedPlatform = params.get('connected');
  const provider: ZernioProvider | null =
    connectedPlatform === 'facebook'
      ? 'messenger'
      : connectedPlatform === 'instagram'
        ? 'instagram'
        : null;
  if (!provider || !connectedPlatform) {
    return settingsRedirect(request, 'error');
  }

  const profileId = params.get('profileId')?.trim();
  const zernioAccountId = params.get('accountId')?.trim();
  if (!profileId || !zernioAccountId) {
    return settingsRedirect(request, 'error');
  }

  try {
    const context = await requireRole('admin');
    const admin = supabaseAdmin();
    const profile = await getZernioProfile(admin, context.accountId);
    const credentials = await getZernioCredentials(admin, context.accountId);
    if (!profile || !credentials || profile.zernio_profile_id !== profileId) {
      return settingsRedirect(request, 'error');
    }

    const connectedAccounts = await listZernioAccounts({
      apiKey: credentials.apiKey,
      profileId,
    });
    const connectedAccount = connectedAccounts.find(
      (account) =>
        account.id === zernioAccountId &&
        account.platform === connectedPlatform &&
        account.isActive
    );
    if (!connectedAccount) return settingsRedirect(request, 'error');

    const selectedPage =
      provider === 'messenger'
        ? await getFacebookPageSelection({
            apiKey: credentials.apiKey,
            accountId: zernioAccountId,
          })
        : null;
    await saveZernioChannelConnection(admin, {
      accountId: context.accountId,
      userId: context.userId,
      profileId,
      zernioAccountId,
      provider,
      externalAccountId: selectedPage?.pageId ?? connectedAccount.id,
      displayName:
        selectedPage?.pageName ??
        connectedAccount.displayName ??
        params.get('username')?.trim() ??
        connectedAccount.username,
    });

    return settingsRedirect(request, 'connected');
  } catch (error) {
    if (error instanceof ZernioConnectionConflictError) {
      console.warn('[zernio/callback] connection conflict:', error.message);
    } else {
      console.error(
        '[zernio/callback] finalization failed:',
        error instanceof Error ? error.message : 'unknown error'
      );
    }
    return settingsRedirect(request, 'error');
  }
}
