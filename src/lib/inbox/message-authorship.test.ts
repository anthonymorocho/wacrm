import { describe, expect, it } from 'vitest';

import { messageAuthorLabel } from './message-authorship';

describe('messageAuthorLabel', () => {
  it('resolves a human agent name from sender_id', () => {
    expect(
      messageAuthorLabel(
        'agent',
        'agent-2',
        [
          { user_id: 'agent-1', full_name: 'Ana' },
          { user_id: 'agent-2', full_name: 'Anthony' },
        ],
        'user-1',
        'Current User'
      )
    ).toBe('Anthony');
  });

  it('uses a neutral label when a legacy human message has no known sender', () => {
    expect(
      messageAuthorLabel('agent', null, [], 'user-1', 'Current User')
    ).toBe('Agent');
    expect(
      messageAuthorLabel('agent', 'removed', [], 'user-1', 'Current User')
    ).toBe('Agent');
  });

  it('keeps bot messages distinct from human agent labels', () => {
    expect(messageAuthorLabel('bot', null, [], 'user-1', 'Current User')).toBe(
      'AI'
    );
    expect(
      messageAuthorLabel('customer', null, [], 'user-1', 'Current User')
    ).toBeNull();
  });
});
