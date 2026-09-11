const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BulkCloseRequest {
  conversationIds: string[];
}

export class BulkCloseRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BulkCloseRequestError';
  }
}

/** Validate and normalize the public bulk-close payload. */
export function parseBulkCloseRequest(body: unknown): BulkCloseRequest {
  if (!body || typeof body !== 'object') {
    throw new BulkCloseRequestError('Invalid close request');
  }

  const rawConversationIds = (body as Record<string, unknown>).conversation_ids;
  if (
    !Array.isArray(rawConversationIds) ||
    rawConversationIds.length === 0 ||
    rawConversationIds.some(
      (id) => typeof id !== 'string' || !UUID_RE.test(id),
    )
  ) {
    throw new BulkCloseRequestError(
      'conversation_ids must contain at least one valid conversation id',
    );
  }

  return {
    conversationIds: [...new Set(rawConversationIds as string[])],
  };
}
