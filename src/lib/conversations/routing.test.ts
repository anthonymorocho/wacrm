import { describe, expect, it } from 'vitest';

import {
  countActiveAssignments,
  getInboundConversationUpdate,
  isCapacityAvailable,
  needsHumanReply,
  selectLeastLoadedAgent,
  sortQueuedConversations,
  type RoutingAgent,
  type RoutingConversation,
} from './routing';

describe('conversation routing rules', () => {
  it('counts only open and pending assignments against an agent', () => {
    const conversations: RoutingConversation[] = [
      {
        id: 'open',
        status: 'open',
        assignedAgentId: 'agent-1',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'pending',
        status: 'pending',
        assignedAgentId: 'agent-1',
        createdAt: '2026-01-02T00:00:00Z',
      },
      {
        id: 'closed',
        status: 'closed',
        assignedAgentId: 'agent-1',
        createdAt: '2026-01-03T00:00:00Z',
      },
      {
        id: 'other',
        status: 'open',
        assignedAgentId: 'agent-2',
        createdAt: '2026-01-04T00:00:00Z',
      },
    ];

    expect(countActiveAssignments(conversations, 'agent-1')).toBe(2);
    expect(isCapacityAvailable(2, 2)).toBe(false);
    expect(isCapacityAvailable(1, 2)).toBe(true);
  });

  it('sorts the unassigned queue oldest first with a stable id tie-breaker', () => {
    const conversations: RoutingConversation[] = [
      {
        id: 'newer',
        status: 'open',
        assignedAgentId: null,
        createdAt: '2026-01-02T00:00:00Z',
      },
      {
        id: 'same-b',
        status: 'open',
        assignedAgentId: null,
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'same-a',
        status: 'open',
        assignedAgentId: null,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];

    expect(
      sortQueuedConversations(conversations).map(
        (conversation) => conversation.id
      )
    ).toEqual(['same-a', 'same-b', 'newer']);
  });

  it('selects the least loaded eligible agent and rotates ties by oldest assignment', () => {
    const agents: RoutingAgent[] = [
      {
        id: 'busy',
        activeCount: 2,
        lastAssignedAt: '2026-01-01T00:00:00Z',
        available: true,
      },
      {
        id: 'recent-tie',
        activeCount: 1,
        lastAssignedAt: '2026-01-04T00:00:00Z',
        available: true,
      },
      {
        id: 'old-tie',
        activeCount: 1,
        lastAssignedAt: '2026-01-02T00:00:00Z',
        available: true,
      },
      { id: 'offline', activeCount: 0, lastAssignedAt: null, available: false },
    ];

    expect(selectLeastLoadedAgent(agents, 2)?.id).toBe('old-tie');
  });

  it('detects whether the latest customer message still needs a human reply', () => {
    expect(needsHumanReply('2026-01-02T10:00:00Z', null)).toBe(true);
    expect(
      needsHumanReply('2026-01-02T10:00:00Z', '2026-01-02T09:00:00Z')
    ).toBe(true);
    expect(
      needsHumanReply('2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z')
    ).toBe(false);
    expect(needsHumanReply(null, null)).toBe(false);
  });

  it('reopens a closed conversation and clears its previous assignment on inbound activity', () => {
    expect(getInboundConversationUpdate('closed')).toEqual({
      status: 'open',
      assignedAgentId: null,
    });
  });

  it('does not change an already active conversation on inbound activity', () => {
    expect(getInboundConversationUpdate('open')).toEqual({});
    expect(getInboundConversationUpdate('pending')).toEqual({});
  });
});
