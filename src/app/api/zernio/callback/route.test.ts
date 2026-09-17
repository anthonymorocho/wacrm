import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  supabaseAdmin: vi.fn(),
  getZernioProfile: vi.fn(),
  getZernioCredentials: vi.fn(),
  getFacebookPageSelection: vi.fn(),
  saveZernioMessengerConnection: vi.fn(),
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
}));
vi.mock('@/lib/zernio/connection', () => ({
  ZernioConnectionConflictError: class ZernioConnectionConflictError extends Error {},
  saveZernioMessengerConnection: mocks.saveZernioMessengerConnection,
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
    mocks.saveZernioMessengerConnection.mockResolvedValue({});
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
    expect(mocks.saveZernioMessengerConnection).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        accountId: 'account-1',
        userId: 'user-1',
        profileId: 'profile-1',
        zernioAccountId: 'zernio-account-1',
        facebookPageId: 'page-1',
        facebookPageName: 'Acme Page',
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
    expect(mocks.saveZernioMessengerConnection).not.toHaveBeenCalled();
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
