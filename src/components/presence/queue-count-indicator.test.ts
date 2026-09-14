import { describe, expect, it } from 'vitest';

import { shouldShowQueueCount } from './queue-count-indicator';

describe('shouldShowQueueCount', () => {
  it('shows the queue count for read-only members with a loaded account', () => {
    expect(shouldShowQueueCount(false, 'account-1')).toBe(true);
  });

  it('waits until the account profile is loaded', () => {
    expect(shouldShowQueueCount(true, 'account-1')).toBe(false);
    expect(shouldShowQueueCount(false, null)).toBe(false);
  });
});
