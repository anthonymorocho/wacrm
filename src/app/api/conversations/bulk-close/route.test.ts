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
      { status: error.status ?? 500 },
    ),
  ),
}));

import { POST } from './route';

const conversationOne = '11111111-1111-4111-8111-111111111111';
const conversationTwo = '22222222-2222-4222-8222-222222222222';

function query(result: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    then: (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function request(body: unknown) {
  return new Request('http://localhost/api/conversations/bulk-close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/conversations/bulk-close', () => {
  const updateQuery = query({
    data: [{ id: conversationOne }, { id: conversationTwo }],
    error: null,
  });
  const supabase = { from: mocks.from };

  beforeEach(() => {
    mocks.requireRole.mockReset();
    mocks.from.mockReset();
    mocks.requireRole.mockResolvedValue({
      supabase,
      userId: '44444444-4444-4444-8444-444444444444',
      accountId: '55555555-5555-4555-8555-555555555555',
      role: 'agent',
      account: { id: '55555555-5555-4555-8555-555555555555', name: 'Acme' },
    });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'conversations') return updateQuery;
      throw new Error(`Unexpected table: ${table}`);
    });
    updateQuery.then = (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) =>
      Promise.resolve({
        data: [{ id: conversationOne }, { id: conversationTwo }],
        error: null,
      }).then(resolve, reject);
  });

  it('closes all selected active conversations owned by the current agent', async () => {
    const response = await POST(
      request({
        conversation_ids: [conversationOne, conversationTwo],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      closed: 2,
      conversation_ids: [conversationOne, conversationTwo],
    });
    expect(mocks.requireRole).toHaveBeenCalledWith('agent');
    expect(mocks.from).toHaveBeenCalledWith('conversations');
    expect(updateQuery.update).toHaveBeenCalledWith({ status: 'closed' });
    expect(updateQuery.eq).toHaveBeenCalledWith(
      'account_id',
      '55555555-5555-4555-8555-555555555555',
    );
    expect(updateQuery.eq).toHaveBeenCalledWith(
      'assigned_agent_id',
      '44444444-4444-4444-8444-444444444444',
    );
    expect(updateQuery.in).toHaveBeenCalledWith('status', ['open', 'pending']);
    expect(updateQuery.in).toHaveBeenCalledWith('id', [
      conversationOne,
      conversationTwo,
    ]);
  });

  it('rejects an empty selection without touching Supabase', async () => {
    const response = await POST(request({ conversation_ids: [] }));

    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
