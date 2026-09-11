import { describe, expect, it } from 'vitest';

import {
  BulkTransferRequestError,
  parseBulkTransferRequest,
} from './bulk-transfer';

const conversationOne = '11111111-1111-4111-8111-111111111111';
const conversationTwo = '22222222-2222-4222-8222-222222222222';
const targetAgent = '33333333-3333-4333-8333-333333333333';

describe('parseBulkTransferRequest', () => {
  it('normalizes duplicate conversation ids and preserves the target agent', () => {
    expect(
      parseBulkTransferRequest({
        conversation_ids: [conversationOne, conversationTwo, conversationOne],
        target_agent_id: targetAgent,
      }),
    ).toEqual({
      conversationIds: [conversationOne, conversationTwo],
      targetAgentId: targetAgent,
    });
  });

  it('rejects an empty or malformed transfer request', () => {
    expect(() =>
      parseBulkTransferRequest({
        conversation_ids: [],
        target_agent_id: targetAgent,
      }),
    ).toThrow(BulkTransferRequestError);

    expect(() =>
      parseBulkTransferRequest({
        conversation_ids: [conversationOne],
        target_agent_id: 'not-a-uuid',
      }),
    ).toThrow(BulkTransferRequestError);
  });
});
