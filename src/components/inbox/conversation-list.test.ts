import { describe, expect, it } from 'vitest';

import {
  getInboxFilterValues,
  shouldApplyAssignmentFilter,
} from './conversation-list';

describe('getInboxFilterValues', () => {
  it('includes the shared queue for every role', () => {
    expect(getInboxFilterValues()).toContain('queue');
  });

  it('does not apply assignment history filters to the shared queue', () => {
    expect(shouldApplyAssignmentFilter('agent', 'queue')).toBe(false);
    expect(shouldApplyAssignmentFilter('agent', 'active')).toBe(true);
    expect(shouldApplyAssignmentFilter('viewer', 'queue')).toBe(false);
  });
});
