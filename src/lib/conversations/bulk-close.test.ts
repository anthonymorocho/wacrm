import { describe, expect, it } from 'vitest';

import {
  BulkCloseRequestError,
  parseBulkCloseRequest,
} from './bulk-close';

const conversationOne = '11111111-1111-4111-8111-111111111111';
const conversationTwo = '22222222-2222-4222-8222-222222222222';

describe('parseBulkCloseRequest', () => {
  it('deduplicates a valid conversation selection', () => {
    expect(
      parseBulkCloseRequest({
        conversation_ids: [conversationOne, conversationTwo, conversationOne],
      }),
    ).toEqual({
      conversationIds: [conversationOne, conversationTwo],
    });
  });

  it('rejects an empty or invalid selection', () => {
    expect(() => parseBulkCloseRequest({ conversation_ids: [] })).toThrow(
      BulkCloseRequestError,
    );
    expect(() =>
      parseBulkCloseRequest({ conversation_ids: ['not-a-uuid'] }),
    ).toThrow('conversation_ids must contain at least one valid conversation id');
  });
});
