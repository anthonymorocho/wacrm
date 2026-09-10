import { describe, expect, it } from 'vitest';

import { buildAgentWorkload } from './queries';

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
