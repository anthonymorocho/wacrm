// Pure conversation-routing rules. Database code owns the concurrent claim;
// these helpers keep the selection and release invariants explicit and
// independently testable.

export type RoutingConversationStatus = 'open' | 'pending' | 'closed';

export interface RoutingConversation {
  id: string;
  status: RoutingConversationStatus;
  assignedAgentId: string | null | undefined;
  createdAt: string;
}

export interface RoutingAgent {
  id: string;
  activeCount: number;
  lastAssignedAt: string | null | undefined;
  available: boolean;
}

export function countActiveAssignments(
  conversations: readonly RoutingConversation[],
  agentId: string
): number {
  return conversations.filter(
    (conversation) =>
      conversation.assignedAgentId === agentId &&
      (conversation.status === 'open' || conversation.status === 'pending')
  ).length;
}

export function isCapacityAvailable(
  activeCount: number,
  capacity: number
): boolean {
  return capacity > 0 && activeCount < capacity;
}

export function sortQueuedConversations(
  conversations: readonly RoutingConversation[]
): RoutingConversation[] {
  return [...conversations].sort((a, b) => {
    const byCreatedAt = a.createdAt.localeCompare(b.createdAt);
    return byCreatedAt || a.id.localeCompare(b.id);
  });
}

export function selectLeastLoadedAgent(
  agents: readonly RoutingAgent[],
  capacity: number
): RoutingAgent | null {
  const eligible = agents.filter(
    (agent) =>
      agent.available && isCapacityAvailable(agent.activeCount, capacity)
  );

  eligible.sort((a, b) => {
    const byLoad = a.activeCount - b.activeCount;
    if (byLoad !== 0) return byLoad;

    // A missing timestamp means the member has never received an automatic
    // assignment, so let that member go first in a tie.
    if (!a.lastAssignedAt && b.lastAssignedAt) return -1;
    if (a.lastAssignedAt && !b.lastAssignedAt) return 1;
    const byLastAssignment = (a.lastAssignedAt ?? '').localeCompare(
      b.lastAssignedAt ?? ''
    );
    return byLastAssignment || a.id.localeCompare(b.id);
  });

  return eligible[0] ?? null;
}

export function needsHumanReply(
  latestCustomerAt: string | null | undefined,
  latestHumanAgentAt: string | null | undefined
): boolean {
  if (!latestCustomerAt) return false;
  if (!latestHumanAgentAt) return true;

  return (
    new Date(latestCustomerAt).getTime() >
    new Date(latestHumanAgentAt).getTime()
  );
}
