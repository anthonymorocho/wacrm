import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  supabaseAdmin: vi.fn(),
  ensureZernioProfile: vi.fn(),
  hasZernioCredentials: vi.fn(),
  saveZernioCredentials: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((error: { message?: string; status?: number }) =>
    Response.json(
      { error: error.message ?? 'Internal server error' },
      { status: error.status ?? 500 }
    )
  ),
}));
vi.mock('@/lib/meta/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));
vi.mock('@/lib/zernio/profile', () => ({
  ensureZernioProfile: mocks.ensureZernioProfile,
  hasZernioCredentials: mocks.hasZernioCredentials,
  saveZernioCredentials: mocks.saveZernioCredentials,
}));

import { GET, POST } from './route';

describe('/api/zernio/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.supabaseAdmin.mockReturnValue({});
    mocks.requireRole.mockResolvedValue({
      userId: 'user-1',
      accountId: 'account-1',
      account: { id: 'account-1', name: 'Acme' },
      role: 'admin',
    });
    mocks.ensureZernioProfile.mockResolvedValue({
      zernio_profile_id: 'profile-1',
    });
    mocks.saveZernioCredentials.mockResolvedValue({
      zernio_profile_id: 'profile-1',
    });
    mocks.hasZernioCredentials.mockResolvedValue(true);
  });

  it('stores account credentials without returning either secret', async () => {
    const response = await POST(
      new Request('http://localhost/api/zernio/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: 'account-api-key',
          webhook_secret: 'account-webhook-secret',
        }),
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ configured: true });
    expect(JSON.stringify(body)).not.toContain('account-api-key');
    expect(JSON.stringify(body)).not.toContain('account-webhook-secret');
    expect(mocks.ensureZernioProfile).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        accountId: 'account-1',
        userId: 'user-1',
        apiKey: 'account-api-key',
      })
    );
    expect(mocks.saveZernioCredentials).toHaveBeenCalledWith(
      {},
      {
        accountId: 'account-1',
        apiKey: 'account-api-key',
        webhookSecret: 'account-webhook-secret',
      }
    );
  });

  it('rejects incomplete credentials', async () => {
    const response = await POST(
      new Request('http://localhost/api/zernio/config', {
        method: 'POST',
        body: JSON.stringify({ api_key: 'only-one' }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.ensureZernioProfile).not.toHaveBeenCalled();
    expect(mocks.saveZernioCredentials).not.toHaveBeenCalled();
  });

  it('returns only configured status on GET', async () => {
    mocks.requireRole.mockResolvedValue({
      accountId: 'account-1',
      role: 'viewer',
    });

    const response = await GET();

    expect(await response.json()).toEqual({ configured: true });
  });
});
