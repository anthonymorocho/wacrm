const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BulkTransferRequest {
  conversationIds: string[];
  targetAgentId: string;
}

export class BulkTransferRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BulkTransferRequestError';
  }
}

/** Validate and normalize the public bulk-transfer payload. */
export function parseBulkTransferRequest(
  body: unknown,
): BulkTransferRequest {
  if (!body || typeof body !== 'object') {
    throw new BulkTransferRequestError('Invalid transfer request');
  }

  const payload = body as Record<string, unknown>;
  const rawConversationIds = payload.conversation_ids;
  const targetAgentId = payload.target_agent_id;

  if (
    !Array.isArray(rawConversationIds) ||
    rawConversationIds.length === 0 ||
    rawConversationIds.some(
      (id) => typeof id !== 'string' || !UUID_RE.test(id),
    )
  ) {
    throw new BulkTransferRequestError(
      'conversation_ids must contain at least one valid conversation id',
    );
  }

  if (typeof targetAgentId !== 'string' || !UUID_RE.test(targetAgentId)) {
    throw new BulkTransferRequestError('target_agent_id must be a valid agent id');
  }

  return {
    conversationIds: [...new Set(rawConversationIds as string[])],
    targetAgentId,
  };
}
