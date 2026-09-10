export interface RoutingRpcClient {
  rpc(
    functionName: string,
    args: Record<string, unknown>
  ): PromiseLike<{ error: { message: string } | null }>;
}

/** Best-effort routing hook used after an inbound message is persisted. */
export async function routeAfterInboundMessage(
  db: RoutingRpcClient,
  accountId: string,
  onError: (message: string) => void = (message) =>
    console.error('[conversation-routing] inbound allocator failed:', message)
): Promise<void> {
  try {
    const { error } = await db.rpc('route_account_conversations', {
      p_account_id: accountId,
    });
    if (error) onError(error.message);
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error));
  }
}
