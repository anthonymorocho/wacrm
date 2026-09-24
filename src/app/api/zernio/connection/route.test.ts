import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  supabaseAdmin: vi.fn(),
  getZernioConnections: vi.fn(),
  hasZernioCredentials: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'failed' }, { status: 500 })
  ),
}));
vi.mock('@/lib/meta/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));
vi.mock('@/lib/zernio/connection', () => ({
  getZernioConnections: mocks.getZernioConnections,
}));
vi.mock('@/lib/zernio/profile', () => ({
  hasZernioCredentials: mocks.hasZernioCredentials,
}));

import { GET } from './route';

describe('/api/zernio/connection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue({ accountId: 'account-1' });
    mocks.supabaseAdmin.mockReturnValue({});
    mocks.hasZernioCredentials.mockResolvedValue(true);
  });

  it('returns only safe connection metadata', async () => {
    mocks.getZernioConnections.mockResolvedValue([
      {
        id: 'connection-1',
        provider: 'messenger',
        display_name: 'Acme Page',
        status: 'connected',
        connected_at: '2026-09-17T12:00:00.000Z',
        zernio_account_id: 'secret-account-id',
      },
      {
        id: 'connection-2',
        provider: 'instagram',
        display_name: 'Acme IG',
        status: 'connected',
        connected_at: '2026-09-18T12:00:00.000Z',
        zernio_account_id: 'secret-instagram-account',
      },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      configured: true,
      connections: [
        {
          id: 'connection-1',
          provider: 'messenger',
          display_name: 'Acme Page',
          status: 'connected',
          connected_at: '2026-09-17T12:00:00.000Z',
        },
        {
          id: 'connection-2',
          provider: 'instagram',
          display_name: 'Acme IG',
          status: 'connected',
          connected_at: '2026-09-18T12:00:00.000Z',
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('secret-account-id');
    expect(JSON.stringify(body)).not.toContain('secret-instagram-account');
  });
});
