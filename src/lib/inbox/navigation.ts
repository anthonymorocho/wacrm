export interface InboxHistory {
  state: unknown;
  replaceState(data: unknown, unused: string, url: string): void;
}

export interface InboxStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const INBOX_CONVERSATION_STORAGE_KEY = 'wacrm:inbox:active-conversation';

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

/**
 * Keep the selected conversation across dashboard route changes. The id is
 * only a candidate: the Inbox revalidates it against the user's visible
 * conversations before opening the thread.
 */
export function rememberInboxConversation(
  conversationId: string,
  storage: InboxStorage
): void {
  if (!conversationId.trim()) return;
  try {
    storage.setItem(INBOX_CONVERSATION_STORAGE_KEY, conversationId);
  } catch {
    // Storage is best-effort (private browsing and embedded contexts may
    // deny access). The in-memory Inbox state still remains authoritative.
  }
}

export function readRememberedInboxConversation(
  storage: InboxStorage
): string | null {
  try {
    const value = storage.getItem(INBOX_CONVERSATION_STORAGE_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export function clearRememberedInboxConversation(storage: InboxStorage): void {
  try {
    storage.removeItem(INBOX_CONVERSATION_STORAGE_KEY);
  } catch {
    // Storage is best-effort; there is nothing else to clean up here.
  }
}
