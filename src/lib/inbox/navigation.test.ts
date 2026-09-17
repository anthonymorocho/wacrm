import { describe, expect, it } from 'vitest';

import {
  clearRememberedInboxConversation,
  readRememberedInboxConversation,
  rememberInboxConversation,
  replaceInboxConversationUrl,
} from './navigation';

describe('replaceInboxConversationUrl', () => {
  it('updates the selected conversation without starting a route navigation', () => {
    const calls: Array<{
      state: unknown;
      title: string;
      url: string;
    }> = [];
    const history = {
      state: { routerState: true },
      replaceState: (state: unknown, title: string, url: string) => {
        calls.push({ state, title, url });
      },
    };

    replaceInboxConversationUrl('conversation/2', history);

    expect(calls).toEqual([
      {
        state: { routerState: true },
        title: '',
        url: '/inbox?c=conversation%2F2',
      },
    ]);
  });
});

describe('remembered Inbox conversation', () => {
  function createStorage() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
  }

  it('restores the last selected conversation from session storage', () => {
    const storage = createStorage();

    rememberInboxConversation('conversation-2', storage);

    expect(readRememberedInboxConversation(storage)).toBe('conversation-2');
  });

  it('clears a conversation that can no longer be restored', () => {
    const storage = createStorage();
    rememberInboxConversation('conversation-2', storage);

    clearRememberedInboxConversation(storage);

    expect(readRememberedInboxConversation(storage)).toBeNull();
  });
});
