import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  supabaseAdmin: vi.fn(),
  getZernioProfile: vi.fn(),
  getZernioCredentials: vi.fn(),
  getFacebookPageSelection: vi.fn(),
  listZernioAccounts: vi.fn(),
  saveZernioChannelConnection: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({ requireRole: mocks.requireRole }));
vi.mock('@/lib/meta/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));
vi.mock('@/lib/zernio/profile', () => ({
  getZernioProfile: mocks.getZernioProfile,
  getZernioCredentials: mocks.getZernioCredentials,
}));
vi.mock('@/lib/zernio/client', () => ({
  getFacebookPageSelection: mocks.getFacebookPageSelection,
  listZernioAccounts: mocks.listZernioAccounts,
}));
vi.mock('@/lib/zernio/connection', () => ({
  ZernioConnectionConflictError: class ZernioConnectionConflictError extends Error {},
  saveZernioChannelConnection: mocks.saveZernioChannelConnection,
}));

import { GET } from './route';

describe('/api/zernio/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue({
      userId: 'user-1',
      accountId: 'account-1',
      role: 'admin',
    });
    mocks.supabaseAdmin.mockReturnValue({});
    mocks.getZernioProfile.mockResolvedValue({
      zernio_profile_id: 'profile-1',
    });
    mocks.getZernioCredentials.mockResolvedValue({
      apiKey: 'zernio-key',
      webhookSecret: 'zernio-secret',
    });
    mocks.getFacebookPageSelection.mockResolvedValue({
      pageId: 'page-1',
      pageName: 'Acme Page',
    });
    mocks.listZernioAccounts.mockResolvedValue([
      {
        id: 'zernio-account-1',
        platform: 'facebook',
        username: 'acme',
        displayName: 'Acme',
        isActive: true,
      },
    ]);
    mocks.saveZernioChannelConnection.mockResolvedValue({});
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  it('stores the page selected in Zernio and returns to Meta settings', async () => {
    const response = await GET(
      new Request(
        'https://crm.example.com/api/zernio/callback?connected=facebook&profileId=profile-1&accountId=zernio-account-1&username=Ignored',
        { method: 'GET' }
      )
    );

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).search).toContain(
      'tab=meta'
    );
    expect(new URL(response.headers.get('location')!).search).toContain(
      'zernio=connected'
    );
    expect(mocks.getFacebookPageSelection).toHaveBeenCalledWith({
      apiKey: 'zernio-key',
      accountId: 'zernio-account-1',
    });
    expect(mocks.saveZernioChannelConnection).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        accountId: 'account-1',
        userId: 'user-1',
        profileId: 'profile-1',
        zernioAccountId: 'zernio-account-1',
        provider: 'messenger',
        externalAccountId: 'page-1',
        displayName: 'Acme Page',
      })
    );
  });

  it('rejects a callback for another CRM account profile', async () => {
    mocks.getZernioProfile.mockResolvedValue({
      zernio_profile_id: 'different-profile',
    });

    const response = await GET(
      new Request(
        'https://crm.example.com/api/zernio/callback?connected=facebook&profileId=profile-1&accountId=zernio-account-1',
        { method: 'GET' }
      )
    );

    expect(new URL(response.headers.get('location')!).search).toContain(
      'zernio=error'
    );
    expect(mocks.getFacebookPageSelection).not.toHaveBeenCalled();
    expect(mocks.saveZernioChannelConnection).not.toHaveBeenCalled();
  });

  it('stores Instagram under the existing profile without resolving a Facebook Page', async () => {
    mocks.listZernioAccounts.mockResolvedValue([
      {
        id: 'zernio-instagram-1',
        platform: 'instagram',
        username: 'acme.ig',
        displayName: 'Acme Instagram',
        isActive: true,
      },
    ]);
    const response = await GET(
      new Request(
        'https://crm.example.com/api/zernio/callback?connected=instagram&profileId=profile-1&accountId=zernio-instagram-1&username=acme.ig',
        { method: 'GET' }
      )
    );

    expect(new URL(response.headers.get('location')!).search).toContain(
      'zernio=connected'
    );
    expect(mocks.getFacebookPageSelection).not.toHaveBeenCalled();
    expect(mocks.saveZernioChannelConnection).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        accountId: 'account-1',
        userId: 'user-1',
        profileId: 'profile-1',
        zernioAccountId: 'zernio-instagram-1',
        provider: 'instagram',
        externalAccountId: 'zernio-instagram-1',
        displayName: 'Acme Instagram',
      })
    );
  });

  it('does not save an Instagram callback account that is absent from the profile', async () => {
    const response = await GET(
      new Request(
        'https://crm.example.com/api/zernio/callback?connected=instagram&profileId=profile-1&accountId=unlinked-instagram',
        { method: 'GET' }
      )
    );

    expect(new URL(response.headers.get('location')!).search).toContain(
      'zernio=error'
    );
    expect(mocks.saveZernioChannelConnection).not.toHaveBeenCalled();
  });

  it('handles a user cancelling Facebook consent', async () => {
    const response = await GET(
      new Request(
        'https://crm.example.com/api/zernio/callback?error=oauth_denied&platform=facebook',
        { method: 'GET' }
      )
    );

    expect(new URL(response.headers.get('location')!).search).toContain(
      'zernio=error'
    );
    expect(mocks.requireRole).not.toHaveBeenCalled();
  });

  it('uses the configured public origin when the callback request has an internal host', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://crm.example.com';

    const response = await GET(
      new Request(
        'http://0.0.0.0/api/zernio/callback?error=oauth_denied&platform=facebook',
        { method: 'GET' }
      )
    );

    expect(response.headers.get('location')).toMatch(
      /^https:\/\/crm\.example\.com\/settings\?/
    );
  });
});
