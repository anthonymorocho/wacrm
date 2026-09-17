import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  supabaseAdmin: vi.fn(),
  getZernioProfile: vi.fn(),
  getZernioCredentials: vi.fn(),
  ensureZernioWebhook: vi.fn(),
  getZernioConnectUrl: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((error: { message?: string; status?: number }) =>
    NextResponse.json(
      { error: error.message ?? 'Internal server error' },
      { status: error.status ?? 500 }
    )
  ),
}));
vi.mock('@/lib/meta/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));
vi.mock('@/lib/zernio/profile', () => ({
  getZernioProfile: mocks.getZernioProfile,
  getZernioCredentials: mocks.getZernioCredentials,
}));
vi.mock('@/lib/zernio/client', () => ({
  ZernioConfigurationError: class ZernioConfigurationError extends Error {
    readonly status = 503 as const;
  },
  ensureZernioWebhook: mocks.ensureZernioWebhook,
  getZernioConnectUrl: mocks.getZernioConnectUrl,
}));

import { GET } from './route';

describe('/api/zernio/connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = 'https://crm.example.com';
    mocks.requireRole.mockResolvedValue({
      userId: 'user-1',
      accountId: 'account-1',
      role: 'admin',
      account: { id: 'account-1', name: 'Acme' },
    });
    mocks.supabaseAdmin.mockReturnValue({});
    mocks.getZernioProfile.mockResolvedValue({
      zernio_profile_id: 'profile-1',
    });
    mocks.getZernioCredentials.mockResolvedValue({
      apiKey: 'zernio-key',
      webhookSecret: 'zernio-secret',
    });
    mocks.ensureZernioWebhook.mockResolvedValue('webhook-1');
    mocks.getZernioConnectUrl.mockResolvedValue('https://zernio.com/oauth');
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  it("returns Zernio's hosted OAuth URL after registering the webhook", async () => {
    const response = await GET(
      new Request('http://localhost/api/zernio/connect', { method: 'GET' })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      auth_url: 'https://zernio.com/oauth',
    });
    expect(mocks.ensureZernioWebhook).toHaveBeenCalledWith({
      apiKey: 'zernio-key',
      url: 'https://crm.example.com/api/zernio/webhook',
      secret: 'zernio-secret',
    });
    expect(mocks.getZernioConnectUrl).toHaveBeenCalledWith({
      apiKey: 'zernio-key',
      profileId: 'profile-1',
      redirectUrl: 'https://crm.example.com/api/zernio/callback',
    });
  });

  it('refuses to start when account credentials are missing', async () => {
    mocks.getZernioCredentials.mockResolvedValue(null);

    const response = await GET(
      new Request('http://localhost/api/zernio/connect', { method: 'GET' })
    );

    expect(response.status).toBe(503);
    expect(mocks.getZernioProfile).toHaveBeenCalled();
    expect(mocks.getZernioConnectUrl).not.toHaveBeenCalled();
  });
});
