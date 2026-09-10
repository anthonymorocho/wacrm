import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const auth = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  toErrorResponse: vi.fn((error: { message?: string; status?: number }) =>
    NextResponse.json(
      { error: error.message ?? 'Internal server error' },
      { status: error.status ?? 500 }
    )
  ),
}));

vi.mock('@/lib/auth/account', () => auth);

import { POST } from './route';

describe('/api/account/availability', () => {
  const rpc = vi.fn();

  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: 'online', error: null });
    auth.getCurrentAccount.mockReset();
    auth.getCurrentAccount.mockResolvedValue({
      supabase: { rpc },
      userId: 'user-1',
      accountId: 'account-1',
      role: 'agent',
      account: { id: 'account-1', name: 'Acme' },
    });
  });

  it('changes only the authenticated member availability through the RPC', async () => {
    const response = await POST(
      new Request('http://localhost/api/account/availability', {
        method: 'POST',
        body: JSON.stringify({
          availability: 'online',
          user_id: 'someone-else',
        }),
        headers: { 'Content-Type': 'application/json' },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ availability: 'online' });
    expect(rpc).toHaveBeenCalledWith('set_agent_availability', {
      p_availability: 'online',
    });
  });

  it('rejects values outside the availability contract before calling Supabase', async () => {
    const response = await POST(
      new Request('http://localhost/api/account/availability', {
        method: 'POST',
        body: JSON.stringify({ availability: 'away' }),
        headers: { 'Content-Type': 'application/json' },
      })
    );

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns the RPC error without pretending the availability changed', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Only team agents can change availability' },
    });

    const response = await POST(
      new Request('http://localhost/api/account/availability', {
        method: 'POST',
        body: JSON.stringify({ availability: 'offline' }),
        headers: { 'Content-Type': 'application/json' },
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Only team agents can change availability',
    });
  });
});
