import { describe, expect, it, vi } from 'vitest';

import { routeAfterInboundMessage } from './route-event';

describe('routeAfterInboundMessage', () => {
  it('calls the account allocator and does not throw when routing fails', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'function is not deployed' },
    });
    const report = vi.fn();

    await expect(
      routeAfterInboundMessage({ rpc }, 'account-1', report)
    ).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledWith('route_account_conversations', {
      p_account_id: 'account-1',
    });
    expect(report).toHaveBeenCalledWith('function is not deployed');
  });
});
