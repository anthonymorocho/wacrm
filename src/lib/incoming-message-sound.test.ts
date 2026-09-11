import { describe, expect, it } from 'vitest';

import { shouldPlayIncomingMessageSound } from './incoming-message-sound';

describe('shouldPlayIncomingMessageSound', () => {
  it('notifies for a customer message inserted while the tab is hidden', () => {
    expect(
      shouldPlayIncomingMessageSound({
        eventType: 'INSERT',
        senderType: 'customer',
        visibilityState: 'hidden',
      }),
    ).toBe(true);
  });

  it('does not notify for visible tabs or outbound messages', () => {
    expect(
      shouldPlayIncomingMessageSound({
        eventType: 'INSERT',
        senderType: 'customer',
        visibilityState: 'visible',
      }),
    ).toBe(false);
    expect(
      shouldPlayIncomingMessageSound({
        eventType: 'INSERT',
        senderType: 'agent',
        visibilityState: 'hidden',
      }),
    ).toBe(false);
  });
});
