import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  supabaseAdmin: vi.fn(),
  getZernioConnection: vi.fn(),
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
  getZernioConnection: mocks.getZernioConnection,
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
    mocks.getZernioConnection.mockResolvedValue({
      id: 'connection-1',
      facebook_page_id: 'page-1',
      facebook_page_name: 'Acme Page',
      status: 'connected',
      connected_at: '2026-09-17T12:00:00.000Z',
      zernio_account_id: 'secret-account-id',
    });

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      configured: true,
      connection: {
        id: 'connection-1',
        page_id: 'page-1',
        page_name: 'Acme Page',
        status: 'connected',
        connected_at: '2026-09-17T12:00:00.000Z',
      },
    });
    expect(JSON.stringify(body)).not.toContain('secret-account-id');
  });
});
