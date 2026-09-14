import { describe, expect, it, vi } from 'vitest';

import {
  buildAgentWorkload,
  loadConversationsSeries,
  loadQueueCount,
} from './queries';

describe('buildAgentWorkload', () => {
  it('includes zero-load eligible agents and excludes closed conversations', () => {
    const result = buildAgentWorkload(
      [
        { user_id: 'agent-1', full_name: 'Ana', account_role: 'agent' },
        { user_id: 'agent-2', full_name: 'Bruno', account_role: 'admin' },
        { user_id: 'viewer-1', full_name: 'Viewer', account_role: 'viewer' },
      ],
      [
        {
          user_id: 'agent-1',
          status: 'online',
          availability: 'online',
          last_seen_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      [
        { assigned_agent_id: 'agent-1', status: 'open' },
        { assigned_agent_id: 'agent-1', status: 'closed' },
        { assigned_agent_id: null, status: 'pending' },
        { assigned_agent_id: 'viewer-1', status: 'open' },
      ],
      400,
      Date.parse('2026-01-01T00:00:30.000Z')
    );

    expect(result.queueCount).toBe(1);
    expect(result.agents).toEqual([
      expect.objectContaining({
        userId: 'agent-1',
        activeCount: 1,
        remaining: 399,
      }),
      expect.objectContaining({
        userId: 'agent-2',
        activeCount: 0,
        remaining: 400,
      }),
    ]);
  });
});

describe('loadQueueCount', () => {
  it('counts only unassigned open and pending conversations in the account', async () => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ count: 4, error: null }),
    };
    const db = {
      from: vi.fn(() => builder),
    };

    await expect(loadQueueCount(db as never, 'account-1')).resolves.toBe(4);
    expect(db.from).toHaveBeenCalledWith('conversations');
    expect(builder.select).toHaveBeenCalledWith('id', {
      count: 'exact',
      head: true,
    });
    expect(builder.eq).toHaveBeenCalledWith('account_id', 'account-1');
    expect(builder.is).toHaveBeenCalledWith('assigned_agent_id', null);
    expect(builder.in).toHaveBeenCalledWith('status', ['open', 'pending']);
  });
});

describe('loadConversationsSeries', () => {
  it('loads pre-aggregated daily message totals without fetching message rows', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 18, 13, 45, 22));

    const rpc = vi.fn().mockResolvedValue({
      data: [{ day: '2026-05-18', incoming: 2, outgoing: 3 }],
      error: null,
    });
    const db = { rpc };

    try {
      await expect(loadConversationsSeries(db as never, 1)).resolves.toEqual([
        { day: '2026-05-18', incoming: 2, outgoing: 3 },
      ]);

      expect(rpc).toHaveBeenCalledWith(
        'get_message_volume_by_day',
        expect.objectContaining({
          p_start: new Date(2026, 4, 18).toISOString(),
          p_end: expect.any(String),
          p_timezone: expect.any(String),
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
