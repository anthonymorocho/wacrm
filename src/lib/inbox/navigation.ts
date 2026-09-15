export interface InboxHistory {
  state: unknown;
  replaceState(data: unknown, unused: string, url: string): void;
}

/**
 * Keep the selected conversation linkable without asking Next to navigate
 * the inbox route again. The inbox owns the active thread in client state;
 * this only mirrors that state in the browser URL for refreshes and sharing.
 */
export function replaceInboxConversationUrl(
  conversationId: string,
  history: InboxHistory
): void {
  const params = new URLSearchParams({ c: conversationId });
  history.replaceState(history.state, '', `/inbox?${params.toString()}`);
}
