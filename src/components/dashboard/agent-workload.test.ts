import { describe, expect, it } from 'vitest';

import { getWorkloadIndicatorStatus } from './agent-workload';

describe('getWorkloadIndicatorStatus', () => {
  it('uses routing availability instead of heartbeat presence', () => {
    expect(getWorkloadIndicatorStatus('offline')).toBe('offline');
    expect(getWorkloadIndicatorStatus('online')).toBe('online');
  });
});
