import { describe, expect, it } from 'vitest';

import { replaceInboxConversationUrl } from './navigation';

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
