import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  from: vi.fn(),
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
  supabaseAdmin: () => ({ from: mocks.from }),
}));

import { decrypt } from '@/lib/whatsapp/encryption';
import { DELETE, GET, POST } from './route';

function request(body?: unknown, url = 'http://localhost/api/meta/channels') {
  return new Request(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('/api/meta/channels', () => {
  const builder = {
    select: vi.fn(),
    order: vi.fn(),
    upsert: vi.fn(),
    single: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    or: vi.fn(),
    maybeSingle: vi.fn(),
    then: vi.fn(),
  };
  beforeEach(() => {
    vi.clearAllMocks();
    for (const method of [
      'select',
      'order',
      'upsert',
      'single',
      'delete',
      'eq',
      'or',
      'maybeSingle',
    ] as const) {
      builder[method].mockReturnValue(builder);
    }
    builder.then.mockImplementation((resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve)
    );
    mocks.from.mockReturnValue(builder);
    mocks.requireRole.mockResolvedValue({
      userId: 'user-1',
      accountId: 'account-1',
      role: 'admin',
      account: { id: 'account-1', name: 'Acme' },
    });
  });

  it('returns channel metadata without returning secrets', async () => {
    builder.then.mockImplementationOnce(
      (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: [
            {
              id: 'channel-1',
              provider: 'instagram',
              external_account_id: 'ig-1',
              display_name: 'Acme IG',
              status: 'connected',
              access_token: 'encrypted-token',
              app_secret: 'encrypted-secret',
              verify_token: 'encrypted-verify',
            },
          ],
          error: null,
        }).then(resolve)
    );

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      channels: [
        {
          id: 'channel-1',
          provider: 'instagram',
          external_account_id: 'ig-1',
          display_name: 'Acme IG',
          status: 'connected',
          connected_at: null,
          created_at: null,
          updated_at: null,
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('encrypted-token');
    expect(mocks.requireRole).toHaveBeenCalledWith('viewer');
    expect(builder.eq).toHaveBeenCalledWith('account_id', 'account-1');
    expect(builder.or).toHaveBeenCalledWith(
      'integration_source.eq.meta,integration_source.is.null'
    );
  });

  it('rejects unsupported providers before writing', async () => {
    const response = await POST(
      request({
        provider: 'whatsapp',
        external_account_id: 'x',
        access_token: 'token',
        app_secret: 'secret',
        verify_token: 'verify',
      })
    );

    expect(response.status).toBe(400);
    expect(builder.upsert).not.toHaveBeenCalled();
  });

  it('requires all credentials when saving a channel', async () => {
    const response = await POST(
      request({
        provider: 'messenger',
        external_account_id: 'page-1',
        access_token: 'token',
        app_secret: 'secret',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('verify_token'),
    });
    expect(builder.upsert).not.toHaveBeenCalled();
  });

  it('encrypts credentials and scopes the upsert to the current account', async () => {
    const saved = {
      id: 'channel-1',
      provider: 'messenger',
      external_account_id: 'page-1',
      display_name: 'Acme Page',
      status: 'connected',
    };
    builder.single.mockResolvedValueOnce({ data: saved, error: null });

    const response = await POST(
      request({
        provider: 'messenger',
        external_account_id: ' page-1 ',
        display_name: ' Acme Page ',
        access_token: 'access-token',
        app_secret: 'app-secret',
        verify_token: 'verify-token',
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      channel: {
        ...saved,
        connected_at: null,
        created_at: null,
        updated_at: null,
      },
    });
    const [payload, options] = builder.upsert.mock.calls[0];
    expect(payload).toMatchObject({
      account_id: 'account-1',
      user_id: 'user-1',
      provider: 'messenger',
      external_account_id: 'page-1',
      display_name: 'Acme Page',
    });
    expect(options).toEqual({
      onConflict: 'account_id,provider,external_account_id',
    });
    expect(payload.access_token).not.toBe('access-token');
    expect(payload.app_secret).not.toBe('app-secret');
    expect(payload.verify_token).not.toBe('verify-token');
    expect(decrypt(payload.access_token)).toBe('access-token');
    expect(decrypt(payload.app_secret)).toBe('app-secret');
    expect(decrypt(payload.verify_token)).toBe('verify-token');
  });

  it('deletes only a channel from the current account', async () => {
    builder.maybeSingle.mockResolvedValueOnce({
      data: { id: 'channel-1' },
      error: null,
    });

    const response = await DELETE(
      new Request('http://localhost/api/meta/channels?id=channel-1', {
        method: 'DELETE',
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(builder.eq).toHaveBeenCalledWith('account_id', 'account-1');
    expect(builder.eq).toHaveBeenCalledWith('id', 'channel-1');
    expect(builder.or).toHaveBeenCalledWith(
      'integration_source.eq.meta,integration_source.is.null'
    );
  });
});
