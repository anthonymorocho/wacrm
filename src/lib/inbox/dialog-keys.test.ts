import { describe, expect, it } from 'vitest';

import { getBulkDialogKey } from './dialog-keys';

describe('getBulkDialogKey', () => {
  it('keeps sibling bulk dialogs uniquely keyed in every state', () => {
    expect(getBulkDialogKey('transfer', false)).not.toBe(
      getBulkDialogKey('close', false),
    );
    expect(getBulkDialogKey('transfer', true)).not.toBe(
      getBulkDialogKey('close', true),
    );
  });
});
